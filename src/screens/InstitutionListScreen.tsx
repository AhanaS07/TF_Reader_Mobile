import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { EmptyState } from '@components/EmptyState';
import { ErrorState } from '@components/ErrorState';
import { InstitutionRow } from '@components/InstitutionRow';
import OfflineBanner from '@components/OfflineBanner';
import { SearchInput } from '@components/SearchInput';
import { SectionHeader } from '@components/SectionHeader';
import { Skeleton } from '@components/Skeleton';
import type { Institution } from '@model/institution';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import { getCatalogueSource } from '@config/catalogue';
import { searchInstitutions } from '../search/searchInstitutions';
import { useInstitutionStore } from '@store/institutionStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, radius, space, type } from '@theme/tokens';
import { getInitials } from '@utils/initials';

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

// Used both when offline with no cache (no CatalogueFailure exists to key on —
// the client never called the network) and when the rejection was not a
// CatalogueFailure at all, same fallback idiom as the other catalogue screens.
const GENERIC_MESSAGE = "Couldn't load institutions. Check your connection and try again.";

export default function InstitutionListScreen() {
  const navigation = useNavigation<Nav>();

  // Same "a failed fetch is not the same as no crest" device InstitutionRow's
  // own state uses — this card draws the SAME institution InstitutionRow
  // would if it appeared in a list, so a failed logo load falls back to
  // initials here too rather than a blank box.
  const [currentCrestFailed, setCurrentCrestFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [errorCode, setErrorCode] = useState<CatalogueError | undefined>(undefined);
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

    // Clear any previous error before deciding whether to fetch or serve cache.
    // Must sit here — above the offline branch — so going offline with a cache
    // after a failed online attempt clears the error and shows the cache rather
    // than staying on the ErrorState.
    if (replace) {
      setFetchError(false);
      setErrorCode(undefined);
    }

    // Offline: serve the persisted cache instead of hitting the network.
    // Pagination is disabled (hasMore=false) since we only cache page 0.
    // A search query is satisfied client-side against the cached names.
    if (!isOnline) {
      setHasMore(false);
      setPage(0);
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
    searchInstitutions({ ...(q.length > 0 ? { q } : {}), page: pageNum, size: PAGE_SIZE })
      .then((results) => {
        setInstitutions((prev) => replace ? results : [...prev, ...results]);
        setHasMore(results.length === PAGE_SIZE);
        setPage(pageNum);
        // Cache only the first page of the unfiltered list — that is the list the
        // offline path serves. Filtered or paginated results are intentionally excluded.
        if (pageNum === 0 && q.length === 0) setCachedInstitutions(results);
      })
      .catch((err: unknown) => {
        // Mid-flight disconnect: prefer the cache over an error screen on initial load.
        if (replace && cached.length > 0) {
          setInstitutions(cached);
          setHasMore(false);
        } else {
          setErrorCode(isCatalogueFailure(err) ? err.code : undefined);
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
  // IDs don't accumulate across sessions.
  //
  // resolvedRef is marked AFTER a successful resolution (or NOT_FOUND), not
  // before the fetch. A transient network error must not permanently suppress
  // the ID for the rest of the session — the user reconnects and the Recently
  // used row should reappear without a restart.
  useEffect(() => {
    if (loading) return;
    // Skip while offline — getInstitution calls are guaranteed to fail, and the
    // IDs must remain unresolved so they are retried when the device reconnects.
    if (!isOnline) return;
    let cancelled = false;
    const source = getCatalogueSource();

    recentlyUsedIds.forEach((id) => {
      if (resolvedRef.current.has(id)) return;

      const alreadyLoaded = institutions.find((i) => i.id === id);
      if (alreadyLoaded) {
        resolvedRef.current.add(id);
        if (!cancelled) setResolvedRecents((prev) => [...prev, alreadyLoaded]);
        return;
      }

      source.getInstitution(id)
        .then((institution) => {
          resolvedRef.current.add(id);
          if (!cancelled) setResolvedRecents((prev) => [...prev, institution]);
        })
        .catch((err) => {
          if (isCatalogueFailure(err) && err.code === CatalogueError.NOT_FOUND) {
            // NOT_FOUND is permanent and idempotent — safe to handle even after
            // the effect is cancelled. Cleanup only fires on dep change (not
            // unmount), so calling a Zustand action here is safe.
            resolvedRef.current.add(id);
            removeRecentlyUsedId(id);
          }
          // Network errors: leave the ID out of resolvedRef so it retries after reconnect.
        });
    });

    return () => { cancelled = true; };
  }, [loading, isOnline, recentlyUsedIds, institutions, removeRecentlyUsedId]);

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

  // Excludes the CURRENT institution, on explicit request — it already has
  // its own card above ("Current institution"), and showing it a second
  // time here read as a redundant duplicate rather than a genuinely
  // different recent one.
  const pinnedInstitutions = useMemo(
    () =>
      recentlyUsedIds
        .map((id) => resolvedRecents.find((r) => r.id === id))
        .filter((i): i is Institution => i !== undefined && i.id !== selectedInstitution?.id),
    [recentlyUsedIds, resolvedRecents, selectedInstitution],
  );

  const mainInstitutions = useMemo(
    () => institutions.filter((i) => !recentlyUsedIds.includes(i.id)),
    [institutions, recentlyUsedIds],
  );

  // Sept 2026 redesign — the page's own heading, shown above every state
  // (loading, error and loaded alike) rather than only once data resolves,
  // matching how ProfileScreen's identical `pageTitle`/`pageSubtitle` pair
  // renders unconditionally too.
  const pageHeader = (
    <View style={styles.pageHeader}>
      <Text style={styles.pageTitle}>Change institution</Text>
      <Text style={styles.pageSubtitle}>
        Search for your institution to access its subscribed content.
      </Text>
    </View>
  );

  const searchBar = (
    <View style={styles.searchWrapper}>
      <SearchInput
        value={query}
        placeholder="Search for your institution"
        onChangeText={setQuery}
        onClear={() => setQuery('')}
      />
    </View>
  );

  // The reader's CURRENT institution, not a row in either list below — real
  // data already held by the store (this screen fetches nothing to draw it),
  // styled the same way ProfileScreen's own identity card is: light-blue
  // surface, crest-or-initials, an "Active access" status line. No chevron
  // here — unlike Profile's card, there is nothing to navigate to from this
  // one; it is the reader's own orientation cue while they change it.
  const currentInstitutionCard =
    selectedInstitution !== null ? (
      <View style={styles.section}>
        <View style={styles.sectionHeaderWrap}>
          <SectionHeader title="Current institution" emphasis="editorial" />
        </View>
        <View style={styles.currentInstitutionCard}>
          {selectedInstitution.branding !== undefined && !currentCrestFailed ? (
            <Image
              source={{ uri: selectedInstitution.branding.logoUrl }}
              style={styles.currentInstitutionCrest}
              resizeMode="contain"
              accessibilityLabel={`${selectedInstitution.name} logo`}
              onError={() => setCurrentCrestFailed(true)}
            />
          ) : (
            <View style={styles.currentInstitutionCrest}>
              <Text style={styles.currentInstitutionInitials}>
                {getInitials(selectedInstitution.name)}
              </Text>
            </View>
          )}

          <View style={styles.currentInstitutionText}>
            <Text style={styles.currentInstitutionName}>{selectedInstitution.name}</Text>
            <Text style={styles.currentInstitutionCountry}>{selectedInstitution.country}</Text>
            <View style={styles.currentInstitutionStatus}>
              <Ionicons name="checkmark-circle" size={type.smallLabel.size} color={color.success} />
              <Text style={styles.currentInstitutionActive}>Active access</Text>
            </View>
          </View>
        </View>
      </View>
    ) : null;

  if (loading && institutions.length === 0) {
    return (
      <View style={styles.screen}>
        {pageHeader}
        {searchBar}
        {currentInstitutionCard}
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
        <OfflineBanner visible={!isOnline} />
      </View>
    );
  }

  if (fetchError) {
    // errorCode is undefined both when offline with no cache (no
    // CatalogueFailure exists — the client never reached the network) and when
    // the rejection was not a CatalogueFailure at all. Either way this falls
    // back to the same honest generic line, kept as `network` since a
    // connectivity problem is the likeliest of the two.
    const variant = errorCode === undefined ? 'network' : catalogueErrorVariant(errorCode);
    const message = errorCode === undefined ? GENERIC_MESSAGE : CATALOGUE_ERROR_COPY[errorCode];
    return (
      <View style={styles.screen}>
        {pageHeader}
        {searchBar}
        {currentInstitutionCard}
        <ErrorState variant={variant} message={message} onRetry={handleRetry} />
        <OfflineBanner visible={!isOnline} />
      </View>
    );
  }

  const listHeader = (
    <View>
      {pageHeader}
      {searchBar}
      {currentInstitutionCard}
      {pinnedInstitutions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderWrap}>
            <SectionHeader title="Recent institutions" emphasis="editorial" />
          </View>
          {/* Clubbed into one rounded, bordered card — same technique
              ProfileScreen's own settings groups use (`overflow: 'hidden'`
              clips each `InstitutionRow`'s corners to this wrapper's
              radius). `isPinned` is dropped here: its own "Recently used"
              label would just repeat the section heading immediately
              above it. Every row here is guaranteed NOT the current
              institution (see `pinnedInstitutions`'s own filter), so none
              of them ever renders `isSelected` — the whole group reads as
              one consistent shape rather than one row looking different
              from its siblings. */}
          <View style={styles.groupCard}>
            {pinnedInstitutions.map((institution) => (
              <InstitutionRow
                key={institution.id}
                institution={institution}
                onPress={() => handleSelect(institution)}
              />
            ))}
          </View>
        </View>
      )}
      {mainInstitutions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderWrap}>
            <SectionHeader title="All Institutions" emphasis="editorial" />
          </View>
        </View>
      )}
    </View>
  );

  const listEmpty =
    !loading && pinnedInstitutions.length === 0 ? (
      <EmptyState
        variant={
          !isOnline && query.length > 0
            ? 'offline_no_results'
            : query.length > 0
              ? 'no_query_results'
              : 'no_content'
        }
        query={!isOnline || query.length === 0 ? undefined : query}
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

// Crest size for the "Current institution" card — bigger than InstitutionRow's
// own CREST_SIZE, same reasoning as ProfileScreen's INSTITUTION_LOGO_SIZE: this
// card is the screen's own visual anchor, not one row among several.
const CURRENT_INSTITUTION_CREST_SIZE = space.xl * 2;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.white,
  },
  searchWrapper: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  footer: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
  // Same shape as ProfileScreen's own `pageHeader`/`pageTitle`/`pageSubtitle` —
  // Aleo Bold headline, Aleo Light supporting line — reused rather than
  // reinvented so this screen reads as the same redesign pass.
  pageHeader: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.xs,
  },
  pageTitle: {
    fontFamily: type.editorialTitle.fontFamily,
    fontSize: type.editorialTitle.size,
    lineHeight: type.editorialTitle.lineHeight,
    color: color.textPrimary,
  },
  pageSubtitle: {
    fontFamily: type.editorialMeta.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  section: {
    marginTop: space.lg,
  },
  // `SectionHeader` sets no horizontal padding of its own (the caller owns
  // placement) — this is that placement, kept separate from `section` itself
  // so it does not stack with `groupCard`'s/`currentInstitutionCard`'s own
  // `marginHorizontal` on the card sitting right below the header.
  sectionHeaderWrap: {
    paddingHorizontal: space.md,
  },
  // Same technique as ProfileScreen's own `groupCard`: a bordered, rounded
  // wrapper with `overflow: 'hidden'` to clip each child row's square
  // corners, rather than a new prop on `InstitutionRow` itself.
  groupCard: {
    marginHorizontal: space.md,
    marginTop: space.sm,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    overflow: 'hidden',
  },
  // Same tint/radius/border language as ProfileScreen's own `identityCard`.
  currentInstitutionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.md,
    marginTop: space.sm,
    padding: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  currentInstitutionCrest: {
    width: CURRENT_INSTITUTION_CREST_SIZE,
    height: CURRENT_INSTITUTION_CREST_SIZE,
    borderRadius: radius.pill,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentInstitutionInitials: {
    fontFamily: type.editorialTitle.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textSecondary,
  },
  currentInstitutionText: {
    flex: 1,
    gap: space.xs / 2,
  },
  currentInstitutionName: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  currentInstitutionCountry: {
    fontFamily: type.editorialMeta.fontFamily,
    fontSize: type.editorialMeta.size,
    lineHeight: type.editorialMeta.lineHeight,
    color: color.textSecondary,
  },
  currentInstitutionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
  currentInstitutionActive: {
    fontFamily: type.editorialMeta.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.success,
  },
});
