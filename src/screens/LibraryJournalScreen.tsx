// A journal's articles WITHIN THIS READER'S OWN LIBRARY — not the catalogue's
// Journal Details/Volumes & Issues browse (`JournalScreen.tsx`/
// `JournalVolumesScreen.tsx`/`JournalIssueScreen.tsx`), which lives only in
// `CatalogueStackParamList` and makes a live `getWork` call to browse a
// journal's full archive. This screen never calls `getWork` — the article ids
// are already known before this screen is reached (`LibraryScreen.tsx`'s own
// `journalGroups`, built from `articleJournalStore`'s membership map against
// this reader's actual downloads/loans/bookmarks), so it only hydrates their
// titles, the same `getItemsBatch` call `LibraryScreen.tsx` itself makes for
// every other row it renders.
//
// NO INSTITUTION PARAM, DELIBERATELY. Browsing this reader's own already-
// acquired articles needs no institution context — `getItemsBatch` takes item
// ids only, the same call LibraryScreen makes for books, loans and downloads
// alike.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ErrorState } from '@components/ErrorState';
import { ContentCard } from '@components/ContentCard';
import { useServerClock } from '@hooks/useServerClock';
import { useLibraryStore } from '@store/libraryStore';
import { getCatalogueSource } from '../config/catalogue';
import type { BookSummary } from '../model/types';
import type { LibraryStackParamList } from '../navigation/types';
import { color, space, type as typeScale } from '../theme/tokens';

import { activeLoans, dueLabel } from './LibraryScreen.holdings';

// Same cadence LibraryScreen.tsx's own `TICK_MS` uses for the identical
// countdown-refresh job — a due date is far less urgent than an offer
// countdown, so this need not tick any faster than that screen already does.
const TICK_MS = 30_000;

type Props = NativeStackScreenProps<LibraryStackParamList, 'LibraryJournal'>;

export default function LibraryJournalScreen({ route, navigation }: Props) {
  const { journalTitle, itemIds } = route.params;

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [titles, setTitles] = useState<Map<string, BookSummary>>(new Map());
  // READ-ONLY, NOT REFETCHED. `libraryStore` is a shared session cache that
  // `LibraryScreen.tsx` already populates before a reader can ever reach this
  // screen (it's only pushed from Library's own Journals tab) — a second
  // `refresh()` here would just repeat a call that already ran seconds ago.
  const loans = useLibraryStore((s) => s.loans);
  const live = activeLoans(loans);
  const loanByItemId = new Map(live.map((loan) => [loan.itemId, loan]));
  // No offer/hold in scope on this screen, so there is no `serverTime` to
  // anchor against — `undefined` falls back to the device's own clock
  // (`serverOffsetMs`'s own documented behaviour), same as any other reader
  // of this hook with nothing to anchor to.
  const clock = useServerClock(undefined, itemIds.join(','), TICK_MS);

  // A due label for whichever of these articles this reader currently holds
  // an active loan for — the same "Due in 5 minutes"/"Due in 14 days" copy
  // Library's own rows already use. An article with no matching loan (a
  // bookmark or a download with no loan behind it) gets no badge at all,
  // mirroring `renderMergedContentRow`'s own "only when `item.loan` exists"
  // rule.
  const dueBadgeFor = useCallback(
    (itemId: string): string | undefined => {
      const loan = loanByItemId.get(itemId);
      if (loan === undefined || !clock.ready) return undefined;
      return dueLabel(loan, clock.offsetMs, clock.nowMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loanByItemId` is rebuilt every render from `loans`, already a dependency via `live`.
    [loans, clock.ready, clock.offsetMs, clock.nowMs],
  );

  // `itemIds` is read but not listed as a dependency: it is a fresh array
  // identity on every render (built from `journalGroups` on the calling
  // screen), and the id SET it names cannot change without this screen being
  // pushed again with a new `journalWorkId`/`journalTitle` — the same "route
  // param that cannot change without a new screen instance" reasoning
  // `ItemDetailScreen.tsx`'s own fetch effect already documents.
  const fetchTitles = useCallback(() => {
    getCatalogueSource()
      .getItemsBatch(itemIds)
      .then((result) => setTitles(new Map(result.items.map((item) => [item.id, item]))))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalTitle]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchTitles();
  }, [fetchTitles]);

  useEffect(() => {
    fetchTitles();
  }, [fetchTitles]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{journalTitle}</Text>
      <Text style={styles.subtitle}>
        {itemIds.length === 1 ? '1 article in your library' : `${itemIds.length} articles in your library`}
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={color.textSecondary} />
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <ErrorState variant="not_ready" message="Couldn't load these articles." onRetry={retry} />
        </View>
      ) : (
        itemIds.map((itemId) => {
          const summary = titles.get(itemId);
          const due = dueBadgeFor(itemId);
          return (
            <View key={itemId} style={styles.row}>
              <ContentCard
                title={summary?.title ?? itemId}
                onPress={() => navigation.navigate('ItemDetail', { itemId })}
                {...(summary?.authors === undefined ? {} : { publisher: summary.authors.join(', ') })}
                {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
                {...(summary?.format === undefined ? {} : { format: summary.format })}
                {...(due === undefined ? {} : { badge: <Text style={styles.badgeLabel}>{due}</Text> })}
              />
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.lg,
  },
  title: {
    fontFamily: typeScale.cardTitle.fontFamily,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  subtitle: {
    ...typeScale.body,
    color: color.textSecondary,
    marginBottom: space.sm,
  },
  // Same shared badge style LibraryScreen.tsx's own rows use for a due date —
  // one sentence in the row's secondary line, not a badge component of its
  // own kind.
  badgeLabel: {
    color: color.textSecondary,
    fontFamily: typeScale.smallLabel.fontFamily,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
  },
  row: {
    marginBottom: space.sm,
  },
});
