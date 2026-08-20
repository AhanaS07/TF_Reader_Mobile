import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { EmptyState } from '@components/EmptyState';
import { ErrorState } from '@components/ErrorState';
import { InstitutionRow } from '@components/InstitutionRow';
import OfflineBanner from '@components/OfflineBanner';
import { SearchInput } from '@components/SearchInput';
import { Skeleton } from '@components/Skeleton';
import type { Institution } from '@model/institution';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import { getCatalogueSource } from '@config/catalogue';
import { searchInstitutions } from '../search/searchInstitutions';
import { useInstitutionStore } from '@store/institutionStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, space, type } from '@theme/tokens';

// Matches InstitutionRow's CREST_SIZE — skeleton circle must fill the same space.
const CREST_SIZE = space.xl + space.md;
// Approximate widths for the two text lines in an InstitutionRow.
const NAME_SKEL_WIDTH = space.xl * 5;
const COUNTRY_SKEL_WIDTH = space.xl * 2;
const SKELETON_ROW_COUNT = 6;
const PAGINATION_SKEL_COUNT = 2;

function SkeletonRow() {
  return (
    <View style={skeletonRowStyles.row}>
      <Skeleton variant="block" width={CREST_SIZE} height={CREST_SIZE} />
      <View style={skeletonRowStyles.lines}>
        <Skeleton variant="text" width={NAME_SKEL_WIDTH} height={type.body.lineHeight} />
        <Skeleton variant="text" width={COUNTRY_SKEL_WIDTH} height={type.meta.lineHeight} />
      </View>
    </View>
  );
}

const skeletonRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  lines: {
    flex: 1,
    gap: space.xs,
  },
});

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'InstitutionList'>;

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

export default function InstitutionListScreen() {
  const navigation = useNavigation<Nav>();

  const [query, setQuery] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const recentlyUsedIds = useInstitutionStore((s) => s.recentlyUsedIds);
  const setSelectedInstitution = useInstitutionStore((s) => s.setSelectedInstitution);
  const removeRecentlyUsedId = useInstitutionStore((s) => s.removeRecentlyUsedId);
  const cachedInstitutions = useInstitutionStore((s) => s.cachedInstitutions);
  const setCachedInstitutions = useInstitutionStore((s) => s.setCachedInstitutions);

  // Ref so fetchPage can read the latest cache without being listed as a dep
  // and causing a re-fetch loop every time the cache is written.
  const cachedRef = useRef(cachedInstitutions);
  useEffect(() => { cachedRef.current = cachedInstitutions; }, [cachedInstitutions]);

  // Institutions resolved directly by ID for the "Recently used" section.
  // Needed because paging means a recently-used institution may not appear in
  // the current page, and inactive institutions return NOT_FOUND and must be pruned.
  const [resolvedRecents, setResolvedRecents] = useState<Institution[]>([]);
  // Track which IDs we've already attempted so paginating doesn't re-trigger fetches.
  const resolvedRef = useRef<Set<string>>(new Set());

  const isOnline = useNetworkStatus();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback((q: string, pageNum: number, replace: boolean) => {
    const cached = cachedRef.current;

    // Offline: serve the persisted cache instead of hitting the network.
    // Pagination is disabled (hasMore=false) since we only cache page 0.
    // A search query is satisfied client-side against the cached names.
    if (!isOnline) {
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      if (replace) {
        if (cached.length > 0) {
          setInstitutions(
            q.length > 0
              ? cached.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
              : cached,
          );
        } else {
          setFetchError(true);
        }
      }
      return;
    }

    if (replace) { setLoading(true); } else { setLoadingMore(true); }
    setFetchError(false);
    searchInstitutions({ ...(q.length > 0 ? { q } : {}), page: pageNum, size: PAGE_SIZE })
      .then((results) => {
        setInstitutions((prev) => replace ? results : [...prev, ...results]);
        setHasMore(results.length === PAGE_SIZE);
        setPage(pageNum);
        // Cache only the first page of the unfiltered list — that is the list the
        // offline path serves. Filtered or paginated results are intentionally excluded.
        if (pageNum === 0 && q.length === 0) setCachedInstitutions(results);
      })
      .catch(() => {
        // Mid-flight disconnect: prefer the cache over an error screen on initial load.
        if (replace && cached.length > 0) {
          setInstitutions(cached);
          setHasMore(false);
        } else {
          setFetchError(true);
        }
      })
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [isOnline, setCachedInstitutions]);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const delay = query.length === 0 ? 0 : DEBOUNCE_MS;
    timerRef.current = setTimeout(() => fetchPage(query, 0, true), delay);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [query, fetchPage]);

  // After the initial page loads, resolve any recently-used IDs not found in the
  // current results. Institutions on later pages are fetched directly by ID.
  // Inactive institutions (NOT_FOUND) are pruned from recentlyUsedIds so stale
  // IDs don't accumulate across sessions. Network errors leave the ID intact —
  // the user is offline and the institution may still exist.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const source = getCatalogueSource();

    recentlyUsedIds.forEach((id) => {
      if (resolvedRef.current.has(id)) return;
      resolvedRef.current.add(id);

      const alreadyLoaded = institutions.find((i) => i.id === id);
      if (alreadyLoaded) {
        if (!cancelled) setResolvedRecents((prev) => [...prev, alreadyLoaded]);
        return;
      }

      source.getInstitution(id)
        .then((institution) => {
          if (!cancelled) setResolvedRecents((prev) => [...prev, institution]);
        })
        .catch((err) => {
          if (!cancelled && isCatalogueFailure(err) && err.code === CatalogueError.NOT_FOUND) {
            removeRecentlyUsedId(id);
          }
        });
    });

    return () => { cancelled = true; };
  }, [loading, recentlyUsedIds, institutions, removeRecentlyUsedId]);

  const handleRetry = useCallback(() => {
    fetchPage(query, 0, true);
  }, [fetchPage, query]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    fetchPage(query, page + 1, false);
  }, [hasMore, loadingMore, loading, query, page, fetchPage]);

  const handleSelect = useCallback(
    (institution: Institution) => {
      setSelectedInstitution(institution);
      navigation.goBack();
    },
    [setSelectedInstitution, navigation],
  );

  const pinnedInstitutions = useMemo(
    () =>
      recentlyUsedIds
        .map((id) => resolvedRecents.find((r) => r.id === id))
        .filter((i): i is Institution => i !== undefined),
    [recentlyUsedIds, resolvedRecents],
  );

  const mainInstitutions = useMemo(
    () => institutions.filter((i) => !recentlyUsedIds.includes(i.id)),
    [institutions, recentlyUsedIds],
  );

  const searchBar = (
    <View style={styles.searchWrapper}>
      <SearchInput
        value={query}
        placeholder="Search institutions..."
        onChangeText={setQuery}
        onClear={() => setQuery('')}
      />
    </View>
  );

  if (loading && institutions.length === 0) {
    return (
      <View style={styles.screen}>
        {searchBar}
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
        <OfflineBanner visible={!isOnline} />
      </View>
    );
  }

  if (fetchError) {
    return (
      <View style={styles.screen}>
        {searchBar}
        <ErrorState
          variant="network"
          message="Couldn't load institutions. Check your connection and try again."
          onRetry={handleRetry}
        />
        <OfflineBanner visible={!isOnline} />
      </View>
    );
  }

  const listHeader = (
    <View>
      {searchBar}
      {pinnedInstitutions.length > 0 && (
        <View>
          <Text style={styles.sectionHeader}>Recently used</Text>
          {pinnedInstitutions.map((institution) => (
            <InstitutionRow
              key={institution.id}
              institution={institution}
              isSelected={institution.id === selectedInstitution?.id}
              isPinned
              onPress={() => handleSelect(institution)}
            />
          ))}
        </View>
      )}
      {mainInstitutions.length > 0 && (
        <Text style={styles.sectionHeader}>All Institutions</Text>
      )}
    </View>
  );

  const listEmpty =
    !loading && pinnedInstitutions.length === 0 ? (
      <EmptyState
        variant={query.length > 0 ? 'no_query_results' : 'no_content'}
        query={query.length > 0 ? query : undefined}
      />
    ) : null;

  const listFooter = loadingMore ? (
    <View style={styles.footer}>
      {Array.from({ length: PAGINATION_SKEL_COUNT }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  ) : null;

  return (
    <View style={styles.screen}>
      <FlatList
        data={mainInstitutions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InstitutionRow
            institution={item}
            isSelected={item.id === selectedInstitution?.id}
            onPress={() => handleSelect(item)}
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      <OfflineBanner visible={!isOnline} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  searchWrapper: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sectionHeader: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
    backgroundColor: color.surface,
  },
  footer: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
});
