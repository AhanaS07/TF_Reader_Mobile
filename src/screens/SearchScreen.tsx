// The Search tab — screen 09, the catalogue search surface. B1's query surface.
//
// IT RENDERS WHAT CAME BACK AND NOTHING ELSE. Catalogue search is server-side and
// entitlement-scoped: "we filter, you render." There is no matching, no
// tokenising, no ranking and no local narrowing anywhere below this line — the
// query and the filters go out as one request, and the list is drawn in the order
// it arrived. Everything that could tempt a screen into doing otherwise lives
// behind `useCatalogueSearch`, which hands this file a lifecycle union and a list.
//
// SEARCH IS METADATA-ONLY, AND THE COPY HAS TO SAY SO. The corpus is title,
// authors, subjects and description. It is NOT the text inside a book — that is a
// separate index, per book, built at ingestion and owned by t4targaryen. The
// placeholder and the line beneath the field both exist to stop a reader
// concluding otherwise, because the failure is silent: they search for a phrase
// they remember from chapter nine, get nothing, and reasonably decide the app is
// broken.
//
// NO ACCESS BADGE, for the reason CatalogueScreen already documents — but note
// that `resolveAccess` is no longer that reason: it landed and is on main, and
// only the wiring is outstanding. `ContentCard`'s `badge` slot takes
// already-resolved UI, and deriving one from `publication.acquisition` here is
// still exactly the Design Spec §5.1 violation the slot exists to prevent.
//
// EMPTY AND ERROR RENDER THROUGH THE SHARED COMPONENTS. Khushi's `EmptyState`
// (K1) and `ErrorState` own this copy and this layout now that both exist —
// this screen supplies only the variant and the already-resolved message, per
// CONVENTIONS §3. Only the load-more failure stays inline: it is a row beneath
// results already on screen, not a screen-level takeover either component models.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CategoryCard, type CategoryAccent } from '@components/CategoryCard';
import { ContentCard } from '@components/ContentCard';
import { EmptyState } from '@components/EmptyState';
import { ErrorState } from '@components/ErrorState';
import { FilterSortSheet } from '@components/FilterSortSheet';
import { SearchInput } from '@components/SearchInput';
import { VoiceOverlay, type VoiceOverlayState } from '@components/VoiceOverlay';
import { getSearchPipeline } from '@config/search';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import type { SearchFilters, SearchStatus } from '@/search';
import { useCatalogueSearch } from '@/search';
import type { RootTabParamList, SearchStackParamList } from '@navigation/types';
import { useRecentSearchesStore } from '@store/recentSearchesStore';
import { color, radius, space, type } from '@theme/tokens';

// Composite, not a plain stack prop, because "Browse the full catalogue"
// crosses into the Catalogue tab's Shelf screen — same cross-tab pattern
// ProfileScreen and AccessGateScreen already use to reach the other tab.
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>,
  BottomTabNavigationProp<RootTabParamList, 'Search'>
>;

// Same placeholder CatalogueScreen uses, and for the same reason: CAP-3
// (institution selection) has not landed, so there is no real value to read yet.
const PLACEHOLDER_INSTITUTION_ID = 'inst_7f3';

const SKELETON_COUNT = 3;

// ─── Copy ────────────────────────────────────────────────────────────────────

// Stated twice, on purpose. The placeholder names the four fields so a reader
// forms the right expectation before typing; the helper line rules out the wrong
// one explicitly, because "searches titles" does not by itself tell anybody that
// it does not also search inside the book.
const PLACEHOLDER = 'Search titles, authors, subjects, and descriptions';
const HELPER = 'Catalogue metadata only — this does not search inside books.';

// Browse-instead cards cycle the accents so three targets do not read as one
// block of colour. Cycled by INDEX, never chosen from the title — types.ts is
// explicit that navigation is data, not code, and no shelf may be named in a
// branch anywhere.
const BROWSE_ACCENTS: readonly CategoryAccent[] = ['primary', 'navy', 'elite'];

// Search has no sort parameter at all — searchCatalogue's own contract carries
// none (see SORT_ORDERS in model/types.ts). This satisfies FilterSortSheet's
// required onSelectSort prop for a row that stays permanently disabled below.
function noopSort() {
  /* sort is not a search parameter — see sortDisabled on <FilterSortSheet> */
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();

  // Resolved once. `getSearchPipeline` is lazy and process-wide, so this is also
  // where the fixture-vs-api choice gets made — by config, never by this file.
  const pipeline = useMemo(() => getSearchPipeline(), []);
  const search = useCatalogueSearch({
    institutionId: PLACEHOLDER_INSTITUTION_ID,
    pipeline,
  });

  // Client-side only — see recentSearchesStore.ts for why this is not a wokay
  // capability. Recorded on submit, never on every keystroke: a draft is not
  // a search until it is actually one.
  const recentQueries = useRecentSearchesStore((s) => s.queries);
  const addRecentQuery = useRecentSearchesStore((s) => s.addQuery);
  const clearRecentQueries = useRecentSearchesStore((s) => s.clear);
  const onSubmit = useCallback(() => {
    addRecentQuery(search.draft);
    search.onSubmit();
  }, [addRecentQuery, search]);
  const onSelectRecentQuery = useCallback(
    (query: string) => {
      search.onChangeQuery(query);
      search.onSubmit();
    },
    [search],
  );

  // The overlay is a pure view; nothing here records audio. See the mic handler.
  const [voiceState, setVoiceState] = useState<VoiceOverlayState | null>(null);

  // Filter & sort sheet — same draft-then-Apply shape ShelfScreen uses.
  // `search.filters` already IS the applied value (it mirrors the reducer's
  // own state), so unlike ShelfScreen there is no separate "applied" copy to
  // keep here — only what the sheet is showing before Apply is pressed.
  const [draftFilters, setDraftFilters] = useState<SearchFilters>({});
  const [sheetVisible, setSheetVisible] = useState(false);

  const openSheet = useCallback(() => {
    setDraftFilters(search.filters);
    setSheetVisible(true);
  }, [search.filters]);

  // Both setters fire in one synchronous handler, so React batches them into
  // one re-render and the reducer threads them correctly — see
  // searchState.ts's mergeFilters/beginSearch, which apply each action against
  // the true prior state rather than a stale render-time snapshot. That is
  // what lets one Apply press commit both dimensions together.
  const applyFilters = useCallback(() => {
    setSheetVisible(false);
    search.onSelectContentType(draftFilters.contentType);
    search.onSelectAccessTier(draftFilters.accessTier);
  }, [draftFilters, search]);

  const clearAllFilters = useCallback(() => {
    setDraftFilters({});
    setSheetVisible(false);
    search.onSelectContentType(undefined);
    search.onSelectAccessTier(undefined);
  }, [search]);

  const state: SearchStatus = search.state;
  const hasResults = search.publications.length > 0;
  const hasActiveFilter =
    search.filters.contentType !== undefined || search.filters.accessTier !== undefined;
  // A failure with results already on screen is a failed NEXT PAGE — the reader
  // keeps what they were reading and gets a retry where the page would have been.
  const pageFailed = state === 'error' && hasResults;

  return (
    <View style={styles.screen}>
      <View style={styles.field}>
        <SearchInput
          value={search.draft}
          placeholder={PLACEHOLDER}
          onChangeText={search.onChangeQuery}
          onSubmit={onSubmit}
          onClear={search.onClear}
          // Screen 09 is catalogue search, so the mic belongs here. Screen 06
          // (institution search) passes nothing and gets no mic.
          //
          // NOTHING IS RECORDED. A recogniser is a native dependency and adding
          // one is a team decision, so the overlay opens as a view only: the
          // transcript stays empty and its Search button stays disabled. When a
          // recogniser lands it feeds `transcript` and drives `voiceState`, and
          // submitting it is `onChangeQuery` then `onSubmit` — no change here.
          onVoicePress={() => setVoiceState('listening')}
        />

        <Text testID="search-helper" style={styles.helper}>
          {HELPER}
        </Text>
      </View>

      {/* Content type and access tier both live behind this one sheet now —
          same FilterSortSheet ShelfScreen already uses. Nothing re-searches
          until Apply is pressed inside it. */}
      <Pressable
        testID="search-filter-button"
        onPress={openSheet}
        style={styles.filterButton}
        accessibilityRole="button"
        accessibilityLabel="Filter and sort"
      >
        <Text style={styles.filterButtonLabel}>Filter & Sort</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.results}>
        {state === 'idle' && (
          <Text testID="search-idle" style={styles.message}>
            Search this catalogue by title, author, subject or description.
          </Text>
        )}

        {/* Recent searches — client-side only (recentSearchesStore.ts).
            Shown only before a fresh query is typed: once a reader has
            started their own, a list of old ones is clutter, not help. */}
        {state === 'idle' && search.draft.trim().length === 0 && recentQueries.length > 0 && (
          <View testID="search-recent" style={styles.recent}>
            <View style={styles.recentHeader}>
              <Text style={styles.recentHeading}>Recent searches</Text>
              <Pressable
                testID="search-recent-clear"
                onPress={clearRecentQueries}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
              >
                <Text style={styles.action}>Clear</Text>
              </Pressable>
            </View>
            {recentQueries.map((query) => (
              <Pressable
                key={query}
                testID="search-recent-item"
                onPress={() => onSelectRecentQuery(query)}
                style={styles.recentRow}
                accessibilityRole="button"
                accessibilityLabel={`Search again for ${query}`}
              >
                <Text style={styles.recentRowLabel}>{query}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {state === 'loading' &&
          Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))}

        {/* THE ERROR STATE, and only for an actual failure. A response that
            arrived and contained nothing never reaches this branch. */}
        {state === 'error' && !hasResults && (
          <View testID="search-error">
            <ErrorState
              variant={
                search.errorCode === undefined ? 'not_ready' : catalogueErrorVariant(search.errorCode)
              }
              message={
                search.errorCode === undefined
                  ? 'The search could not be completed.'
                  : CATALOGUE_ERROR_COPY[search.errorCode]
              }
              onRetry={search.onRetry}
            />
          </View>
        )}

        {/* THE ZERO-RESULT STATE. A successful response with nothing in it —
            including one that carried no `publications` key at all and only
            browse targets. Not an error, and it must never render as one.
            A filter narrows the same query to nothing, which reads as a
            different fact than the query itself matching nothing — hence the
            two EmptyState variants rather than one generic message. */}
        {state === 'empty' && (
          <View testID="search-empty" style={styles.panel}>
            <EmptyState
              variant={hasActiveFilter ? 'no_filter_results' : 'no_query_results'}
              query={search.query}
              onClearFilters={clearAllFilters}
            />

            {search.browseInstead.length > 0 && (
              <View testID="search-browse-instead" style={styles.browse}>
                <Text style={styles.browseHeading}>Browse instead</Text>
                {search.browseInstead.map((entry, index) => (
                  // Shelf now exists (Catalogue stack), so this crosses tabs to
                  // it — same cross-tab pattern AccessGateScreen already uses to
                  // reach SignIn. `PLACEHOLDER_INSTITUTION_ID` matches every
                  // other call this screen makes: a shelf only exists within one
                  // institution's catalogue, and Search has no real one yet.
                  <CategoryCard
                    key={entry.shelfId}
                    title={entry.title}
                    accent={BROWSE_ACCENTS[index % BROWSE_ACCENTS.length]}
                    onPress={() =>
                      navigation.navigate('Catalogue', {
                        screen: 'Shelf',
                        params: {
                          shelfId: entry.shelfId,
                          title: entry.title,
                          institutionId: PLACEHOLDER_INSTITUTION_ID,
                        },
                      })
                    }
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {search.publications.map((publication) => (
          <ContentCard
            key={publication.id}
            title={publication.title}
            publisher={publication.publisher}
            imageUrl={publication.coverUrl}
            onPress={() => navigation.navigate('ItemDetail', { itemId: publication.id })}
          />
        ))}

        {/* PAGINATION IS THE RESPONSE'S `next`, FOLLOWED. No page numbers: the
            server said where the next page is, and there is nothing else to
            offer — a numbered control would have to invent a total page count
            from a cursor it cannot read. */}
        {search.canLoadMore && (
          <Pressable
            testID="search-load-more"
            onPress={search.onLoadMore}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityLabel="Show more results"
          >
            <Text style={styles.action}>Show more results</Text>
          </Pressable>
        )}

        {/* One skeleton where the next page will land, so the list grows downward
            instead of the results already read being replaced by a loading view. */}
        {state === 'paging' && <ContentCard state="loading" title="" />}

        {pageFailed && (
          <View testID="search-page-error" style={styles.panel}>
            <Text style={styles.message}>
              {search.errorCode === undefined
                ? 'More results could not be loaded.'
                : CATALOGUE_ERROR_COPY[search.errorCode]}
            </Text>
            <Pressable
              testID="search-retry-page"
              onPress={search.onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more results"
            >
              <Text style={styles.action}>Try again</Text>
            </Pressable>
          </View>
        )}

        {/* Server-reported, never counted locally: `publications.length` is what
            has been paged in so far, not how many there are. */}
        {hasResults && search.totalItems !== undefined && (
          <Text testID="search-total" style={styles.note}>
            Showing {search.publications.length} of {search.totalItems}
          </Text>
        )}
      </ScrollView>

      <VoiceOverlay
        visible={voiceState !== null}
        state={voiceState ?? 'listening'}
        onCancel={() => setVoiceState(null)}
        onClear={() => setVoiceState('listening')}
      />

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
        sort={undefined}
        onSelectSort={noopSort}
        sortDisabled
        onApply={applyFilters}
        onClearAll={clearAllFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  // SearchInput sets no outer margin of its own (CONVENTIONS §8), so the screen
  // laying it out provides the gutter.
  field: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  helper: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.sm,
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
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textPrimary,
  },
  recent: {
    gap: space.xs,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  recentHeading: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  recentRow: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  recentRowLabel: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  note: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    textAlign: 'center',
  },
  results: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  panel: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  browse: {
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.md,
  },
  browseHeading: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  message: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  moreButton: {
    height: space.xl + space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
  },
  action: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
