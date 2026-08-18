// A4 (Prayas) — one shelf as a full, paginated listing.
//
// Replaces the navigation stub that landed on main as scaffolding for this work
// ("renders the shelfId so Prayas can verify navigation is wired"). Its route
// contract is kept exactly: `Shelf` with `{ shelfId, title }`, so the navigator
// entry and every caller on main keep working unchanged.
//
// THE APP BAR OWNS THE TITLE. RootNavigator sets it from `route.params.title`,
// so this screen renders no heading of its own — a SectionHeader here would
// print the shelf name twice, once in the bar and once under it.
//
// Reached by tapping a CategoryCard on CatalogueScreen, which pushes
// ShelfDetail with the tapped nav entry's `shelfId`. This screen fetches that
// shelf on its own (getShelf) rather than receiving it as a route param: the
// home feed only carries previews, and a listing is a different document.
//
// PAGING IS "LOAD MORE", NOT INFINITE SCROLL. The app has no FlatList anywhere
// yet — every list is a ScrollView + map — so `onEndReached` would introduce a
// new list primitive and a scroll threshold to tune. An explicit button reuses
// the Pressable pattern already here for retry, and it is honest about cost on
// a metered connection. Swap it for onEndReached later if the design asks; the
// state below does not change, only what calls `loadMore`.
//
// THE CURSOR COMES OFF THE RESPONSE, never `page + 1`. normalize.ts derives
// `nextPage` from the feed's `next` link and throws MALFORMED_FEED if that link
// has no page parameter, so arithmetic here would be a second, silently wrong
// source of truth the day wokay switch to cursor paging.
//
// A LOAD-MORE FAILURE MUST NOT WIPE THE SCREEN. `failed` is first-page-only and
// still renders the full-screen error; a later page failing shows an inline
// retry under the rows the user already has.
//
// `institutionId` IS HARDCODED to the one id the mock fixtures serve. CAP-3
// (institution selection) has not landed, so there is no real value to read yet.
// Replace this constant with whatever CAP-3 hands the screen; nothing else here
// should need to change.
//
// NO ACCESS BADGE YET, AND `resolveAccess` IS NO LONGER THE REASON — it landed
// and is on main. `ContentCard`'s `badge` slot takes already-resolved UI (Design
// Spec §5.1 — the UI must never calculate access rights), and reaching into
// `publication.acquisition` here to fake one is still exactly the violation that
// rule exists to prevent. What is left is the wiring, and nothing blocks it —
// see the same note in `CatalogueScreen`.
//
// 'ebooks' IS THE ONLY SHELF THAT PAGES on mock data today: it is the one with
// both a page-0 and a page-1 fixture. 'audiobooks' and 'open-access' have no
// standalone feed at all and so never reach this screen (MockAdapter returns
// NOT_FOUND and the error state above renders). Nothing here is shelf-specific —
// they will page the moment their fixtures land.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { ContentCard } from '../components/ContentCard';
import { getCatalogueSource } from '../config/catalogue';
import type { Publication, Shelf } from '../model/types';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, space, type as typeScale } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'Shelf'>;

type Props = NativeStackScreenProps<CatalogueStackParamList, 'Shelf'>;

// State of a SUBSEQUENT page request only. A union rather than two booleans so
// "loading and failed at once" cannot be represented.
type MoreStatus = 'idle' | 'loading' | 'failed';

const PLACEHOLDER_INSTITUTION_ID = 'inst_7f3';

// How many skeleton cards to show before the first page arrives. Arbitrary —
// there is no data yet to size it from.
const SKELETON_COUNT = 3;

export default function ShelfScreen({ route }: Props) {
  const { shelfId } = route.params;
  const navigation = useNavigation<Nav>();

  // The shelf's IDENTITY, taken from the first page and then left alone: title
  // and totalItems describe the whole shelf, not the page that carried them.
  // Re-setting this on every page would let the header flicker if a later
  // response's metadata differed.
  const [shelf, setShelf] = useState<Shelf | null>(null);
  // Every page so far, concatenated. Separate from `shelf.publications`, which
  // is only ever one page's worth.
  const [publications, setPublications] = useState<Publication[]>([]);
  // The cursor. `undefined` means "no next page" — which is also the absence of
  // a `next` link in the feed, so the two agree by construction.
  const [nextPage, setNextPage] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [moreStatus, setMoreStatus] = useState<MoreStatus>('idle');

  // No synchronous setState here — only inside the async continuations. A
  // setState reachable directly from an effect body triggers a lint error
  // ("cascading renders"); `loading`/`failed` are also already at these exact
  // values on mount, so resetting them here would be redundant anyway. Retry
  // is the one path that truly needs to reset them, and it runs from a press
  // handler, not an effect — see below.
  const loadFirstPage = useCallback(() => {
    getCatalogueSource()
      .getShelf(PLACEHOLDER_INSTITUTION_ID, shelfId)
      // Page omitted, not passed as 0: the adapter forwards it to the server as
      // a query param only when present, so the server applies its own default.
      .then((page) => {
        setShelf(page);
        setPublications(page.publications);
        setNextPage(page.nextPage);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [shelfId]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    // A guard, not an assertion: the button is hidden when there is no next page
    // and disabled while a page is in flight, so arriving here in either state
    // means a race (two taps landing in one tick). Doing nothing is the right
    // answer — fetching page `undefined`, or the same page twice, is not.
    if (nextPage === undefined || moreStatus === 'loading') return;

    setMoreStatus('loading');
    getCatalogueSource()
      .getShelf(PLACEHOLDER_INSTITUTION_ID, shelfId, nextPage)
      .then((page) => {
        // Appended, never replaced — earlier pages staying on screen is the
        // whole point. Deduped by id because overlapping pages are a real
        // server behaviour, and a repeat would otherwise mean duplicate React
        // keys and a row rendered twice.
        setPublications((previous) => {
          const seen = new Set(previous.map((publication) => publication.id));
          return [...previous, ...page.publications.filter(({ id }) => !seen.has(id))];
        });
        setNextPage(page.nextPage);
        setMoreStatus('idle');
      })
      // Deliberately does NOT set `failed`: the rows already on screen stay,
      // and the inline label below turns into a retry.
      .catch(() => setMoreStatus('failed'));
  }, [nextPage, moreStatus, shelfId]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Couldn&apos;t load this shelf.</Text>
        <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const moreLabel =
    moreStatus === 'loading'
      ? 'Loading…'
      : moreStatus === 'failed'
        ? "Couldn't load more — tap to retry"
        : 'Load more';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {loading ? (
        Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <ContentCard key={index} state="loading" title="" />
        ))
      ) : (
        <View style={styles.section}>
          {/* No heading here — the app bar already shows this shelf's name, set
              by RootNavigator from route.params.title. */}
          <View style={styles.list}>
            {publications.map((publication) => (
              <ContentCard
                key={publication.id}
                title={publication.title}
                publisher={publication.publisher}
                imageUrl={publication.coverUrl}
                onPress={() => navigation.navigate('ItemDetail', { itemId: publication.id })}
              />
            ))}
          </View>

          {/* Server-reported total, so the count stays honest across pages.
              Rendered only when the feed supplies one — inventing "of 2" from
              what happens to be loaded would tell the user the shelf ends here. */}
          {shelf?.totalItems !== undefined && (
            <Text style={styles.count}>
              Showing {publications.length} of {shelf.totalItems}
            </Text>
          )}

          {/* Absent, not disabled, on the last page: a permanently dead button
              reads as broken. `nextPage === undefined` is exactly "no more". */}
          {nextPage !== undefined && (
            <Pressable
              onPress={loadMore}
              disabled={moreStatus === 'loading'}
              style={styles.loadMore}
              accessibilityRole="button"
              accessibilityLabel={moreLabel}
              accessibilityState={{ disabled: moreStatus === 'loading' }}
            >
              <Text
                style={[
                  styles.loadMoreLabel,
                  moreStatus === 'loading' && styles.loadMoreLabelLoading,
                  moreStatus === 'failed' && styles.loadMoreLabelFailed,
                ]}
              >
                {moreLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  content: {
    padding: space.md,
    gap: space.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
  },
  message: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
  retry: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.primary,
  },
  section: {
    gap: space.sm,
  },
  list: {
    gap: space.sm,
  },
  count: {
    alignSelf: 'center',
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  loadMore: {
    alignSelf: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  loadMoreLabel: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.primary,
  },
  loadMoreLabelLoading: {
    color: color.textSecondary,
  },
  loadMoreLabelFailed: {
    color: color.error,
  },
});
