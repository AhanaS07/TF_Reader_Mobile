// A4 (Prayas) — one shelf as a full, paginated listing.
//
// Replaces the navigation stub that landed on main as scaffolding for this work
// ("renders the shelfId so Prayas can verify navigation is wired"). The route is
// `Shelf`, carrying `{ shelfId, title, institutionId }`.
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
// `institutionId` ARRIVES IN THE ROUTE PARAMS, from the catalogue that
// advertised this shelf. Not read from the store here: a param cannot be
// omitted, so there is no fallback id for a reader who has chosen no
// institution to fall through to.
//
// THE BADGE IS RESOLVED, NEVER DERIVED HERE. Each row calls `resolveAccess` and
// passes only the resulting `.tier` into ContentCard's slot — see the same note
// in `CatalogueScreen`. The session comes from `handToggledSession` and is
// never null here, for the same reason `institutionId` never is: a shelf is
// only ever reached from a signed-in reader's own catalogue.
//
// 'all' IS THE ONLY SHELF THAT PAGES on mock data today: it is the one with both
// a page-0 and a page-1 fixture (03 and 04). 'shelf_1' and 'shelf_2' have
// single-page feeds (05 and 06), and 'shelf_3' is advertised in navigation with
// no feed behind it, so it keeps the NOT_FOUND path exercised — MockAdapter
// returns NOT_FOUND and the error state above renders. Nothing here is
// shelf-specific; they will page the moment their fixtures land.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { handToggledSession } from '@access/handToggledSession';
import { resolveAccess } from '@access/resolveAccess';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ContentCard } from '../components/ContentCard';
import { ErrorState } from '@components/ErrorState';
import { FilterSortSheet } from '@components/FilterSortSheet';
import { getCatalogueSource } from '../config/catalogue';
import { type CatalogueError, isCatalogueFailure } from '@model/errors';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import type { Publication, Shelf, SortOrder } from '../model/types';
import type { CatalogueStackParamList } from '../navigation/types';
import type { BrowseFilters } from '@search/browseLink';
import { color, radius, space, type as typeScale } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'Shelf'>;

type Props = NativeStackScreenProps<CatalogueStackParamList, 'Shelf'>;

// State of a SUBSEQUENT page request only. A union rather than two booleans so
// "loading and failed at once" cannot be represented.
type MoreStatus = 'idle' | 'loading' | 'failed';

// How many skeleton cards to show before the first page arrives. Arbitrary —
// there is no data yet to size it from.
const SKELETON_COUNT = 3;

export default function ShelfScreen({ route }: Props) {
  const { shelfId, institutionId } = route.params;
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
  const [errorCode, setErrorCode] = useState<CatalogueError | undefined>(undefined);
  const [moreStatus, setMoreStatus] = useState<MoreStatus>('idle');

  // Screen 12 — filter & sort. APPLIED is what the last request actually used
  // (carried forward into loadMore's follow-up pages); DRAFT is what the sheet
  // shows while the reader is still choosing. They only agree the moment the
  // sheet opens and the moment Apply/Clear All commits — see openSheet below.
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>({});
  const [appliedSort, setAppliedSort] = useState<SortOrder | undefined>(undefined);
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>({});
  const [draftSort, setDraftSort] = useState<SortOrder | undefined>(undefined);
  const [sheetVisible, setSheetVisible] = useState(false);
  // Sort is honoured only on 'all' (browseLink.ts) — the sheet still renders
  // the row, greyed, rather than hiding it on every other shelf.
  const sortDisabled = shelfId !== 'all';

  // No synchronous setState here — only inside the async continuations. A
  // setState reachable directly from an effect body triggers a lint error
  // ("cascading renders"); `loading`/`failed` are also already at these exact
  // values on mount, so resetting them here would be redundant anyway. Retry
  // and a filter Apply/Clear All are the paths that truly need to reset them,
  // and they run from a press handler, not an effect — see below.
  const fetchPage = useCallback(
    (filters: BrowseFilters, sort: SortOrder | undefined) => {
      getCatalogueSource()
        // Page omitted, not passed as 0: the adapter forwards it to the server
        // as a query param only when present, so the server applies its own
        // default.
        .getShelf(institutionId, shelfId, undefined, { ...filters, sort })
        .then((page) => {
          setShelf(page);
          setPublications(page.publications);
          setNextPage(page.nextPage);
        })
        .catch((err: unknown) => {
          setErrorCode(isCatalogueFailure(err) ? err.code : undefined);
          setFailed(true);
        })
        .finally(() => setLoading(false));
    },
    [institutionId, shelfId],
  );

  useEffect(() => {
    fetchPage(appliedFilters, appliedSort);
    // Only on mount (or a shelfId change, which never happens on a live
    // screen — see the file header). appliedFilters/appliedSort changes are
    // driven by applyFilters/clearAllFilters below, which fetch directly
    // rather than through this effect, the same reasoning `retry` already
    // documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchPage(appliedFilters, appliedSort);
  }, [fetchPage, appliedFilters, appliedSort]);

  const openSheet = useCallback(() => {
    // The sheet always opens showing what is actually applied, never a stale
    // draft left over from a previous open-then-dismiss.
    setDraftFilters(appliedFilters);
    setDraftSort(appliedSort);
    setSheetVisible(true);
  }, [appliedFilters, appliedSort]);

  const applyFilters = useCallback(() => {
    setSheetVisible(false);
    setLoading(true);
    setFailed(false);
    setPublications([]);
    setNextPage(undefined);
    setAppliedFilters(draftFilters);
    setAppliedSort(draftSort);
    fetchPage(draftFilters, draftSort);
  }, [draftFilters, draftSort, fetchPage]);

  const clearAllFilters = useCallback(() => {
    setDraftFilters({});
    setDraftSort(undefined);
    setSheetVisible(false);
    setLoading(true);
    setFailed(false);
    setPublications([]);
    setNextPage(undefined);
    setAppliedFilters({});
    setAppliedSort(undefined);
    fetchPage({}, undefined);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    // A guard, not an assertion: the button is hidden when there is no next page
    // and disabled while a page is in flight, so arriving here in either state
    // means a race (two taps landing in one tick). Doing nothing is the right
    // answer — fetching page `undefined`, or the same page twice, is not.
    if (nextPage === undefined || moreStatus === 'loading') return;

    setMoreStatus('loading');
    getCatalogueSource()
      // The same filters/sort the current page was fetched with — a further
      // page of the same request, never a fresh, unfiltered one.
      .getShelf(institutionId, shelfId, nextPage, {
        ...appliedFilters,
        sort: appliedSort,
      })
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
  }, [nextPage, moreStatus, institutionId, shelfId, appliedFilters, appliedSort]);

  if (failed) {
    return (
      <View style={styles.center}>
        <ErrorState
          variant={errorCode === undefined ? 'not_ready' : catalogueErrorVariant(errorCode)}
          message={errorCode === undefined ? "Couldn't load this shelf." : CATALOGUE_ERROR_COPY[errorCode]}
          onRetry={retry}
        />
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
    <View style={styles.screen}>
      <Pressable
        testID="shelf-filter-button"
        onPress={openSheet}
        style={styles.filterButton}
        accessibilityRole="button"
        accessibilityLabel="Filter and sort"
      >
        <Text style={styles.filterButtonLabel}>Filter & Sort</Text>
      </Pressable>

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
            {publications.map((publication) => {
              // Hoisted out of the `badge` prop: D12 needs the resolved ACTIONS
              // as well as the tier, and resolving twice per row would be two
              // answers to one question.
              const access = resolveAccess({
                item: publication,
                institutionId,
                session: handToggledSession(institutionId),
              });
              return (
                <ContentCard
                  key={publication.id}
                  title={publication.title}
                  publisher={publication.publisher}
                  imageUrl={publication.coverUrl}
                  format={publication.format}
                  badge={<AccessTierBadge tier={access.tier} />}
                  // No `action`: the Elite queue button ("Grant access") is
                  // ItemDetailScreen only, not on this shelf row.
                  onPress={() => navigation.navigate('ItemDetail', { itemId: publication.id })}
                />
              );
            })}
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

      <FilterSortSheet
        visible={sheetVisible}
        onDismiss={() => setSheetVisible(false)}
        contentType={draftFilters.contentType}
        onSelectContentType={(contentType) =>
          setDraftFilters((previous) => ({ ...previous, contentType }))
        }
        accessTier={draftFilters.accessTier}
        onSelectAccessTier={(accessTier) =>
          setDraftFilters((previous) => ({ ...previous, accessTier }))
        }
        sort={draftSort}
        onSelectSort={setDraftSort}
        sortDisabled={sortDisabled}
        onApply={applyFilters}
        onClearAll={clearAllFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    padding: space.md,
    gap: space.lg,
  },
  filterButton: {
    alignSelf: 'flex-start',
    marginHorizontal: space.md,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
  },
  filterButtonLabel: {
    fontWeight: typeScale.button.weight,
    fontFamily: typeScale.button.fontFamily,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.textPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.white,
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
    fontFamily: typeScale.meta.fontFamily,
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
    fontFamily: typeScale.button.fontFamily,
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
