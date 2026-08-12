// The Search tab — screen 09, the catalogue search surface.
//
// THE SCREEN OWNS THE QUERY AND THE CRITERIA; THE SHELL DECIDES THE RESULTS.
// `src/search` is pure (no React, no adapter), so everything below is state plus
// one call to `runCatalogueSearch`. CONVENTIONS §3: components are handed data
// and report events, screens hold the state and pass it down.
//
// IT SEARCHES WHAT IS ALREADY IN HAND. `CatalogueSource` has no search method and
// Q-E (does wokay expose a search link template?) is unresolved, so this is the
// Foundation Spec's fetch-and-filter contingency: pull the home catalogue once,
// then match locally. When a server-side endpoint lands it becomes another source
// of `Publication[]` and none of the ranking changes.
//
// NO ACCESS BADGE, for the reason CatalogueScreen already documents —
// `ContentCard`'s `badge` slot takes already-resolved UI, and
// `src/access/resolveAccess` does not exist yet. Faking one from
// `publication.acquisition` here is exactly the Design Spec §5.1 violation the
// slot exists to prevent. It is also why the sheet's Access Type row is inert.
//
// THE NO-RESULTS TREATMENT IS INLINE AND TEMPORARY. Khushi's `EmptyState` (K1)
// owns this copy and its two variants — "no results for a query" versus "no
// results for your filters". Building a second one here would break the rule the
// spec calls most likely to fail quietly: a feature may not introduce a
// component. This is screen-local text, to be deleted when EmptyState lands.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ContentCard } from '@components/ContentCard';
import { FilterChip } from '@components/FilterChip';
import { SearchInput } from '@components/SearchInput';
import { VoiceOverlay, type VoiceOverlayState } from '@components/VoiceOverlay';
import { getCatalogueSource } from '@config/catalogue';
import type { Publication } from '@model/types';
import type { SearchStackParamList } from '@navigation/types';
// `@/search` rather than `@search` — tsconfig maps `@search/*`, which needs a
// path segment after it, whereas `@/*` resolves the folder itself and so picks
// up its index.ts. Adding a bare `@search` alias would mean editing tsconfig AND
// babel.config together (the README requires they mirror exactly), which is not
// worth it for one import.
import { CONTENT_TYPES, isContentTypeSupported, runCatalogueSearch } from '@/search';
import { color, radius, space, type } from '@theme/tokens';

import FilterSheet, {
  CONTENT_TYPE_LABELS,
  DEFAULT_CRITERIA,
  type FilterCriteria,
} from './FilterScreen';

type Nav = NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>;

// Same placeholder CatalogueScreen uses, and for the same reason: CAP-3
// (institution selection) has not landed, so there is no real value to read yet.
const PLACEHOLDER_INSTITUTION_ID = 'inst_7f3';

const SKELETON_COUNT = 3;
const FILTER_ICON_SIZE = 16;

// The fixtures deliberately include the same work in two feeds under one id
// (P0-4's cross-feed dedup case), so flattening shelves without this shows it
// twice and React warns about duplicate keys.
function dedupeById(publications: Publication[]): Publication[] {
  const byId = new Map<string, Publication>();

  for (const publication of publications) {
    if (!byId.has(publication.id)) byId.set(publication.id, publication);
  }

  return [...byId.values()];
}

// How many dimensions are away from their default, for the trigger's badge.
// Counted rather than a boolean so the button can say "Filter & Sort · 2".
function activeCriteriaCount(criteria: FilterCriteria): number {
  return (Object.keys(criteria) as (keyof FilterCriteria)[]).filter(
    (key) => criteria[key] !== DEFAULT_CRITERIA[key],
  ).length;
}

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();

  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // The reference point for the date filter, stamped when the catalogue arrives.
  //
  // NOT read during render. `Date.now()` in the useMemo below is an impure call
  // and `react-hooks/purity` rejects it — rightly, since the filter would then
  // silently recompute against a different "now" on any incidental re-render.
  // Setting it in an effect body is out for the same reason CatalogueScreen
  // documents (cascading renders), so it is stamped in the async continuation.
  // Zero until then, which only matters while `publications` is still empty.
  const [loadedAt, setLoadedAt] = useState(0);

  const [query, setQuery] = useState('');
  const [criteria, setCriteria] = useState<FilterCriteria>(DEFAULT_CRITERIA);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The overlay is a pure view; nothing here records audio. See the mic handler.
  const [voiceState, setVoiceState] = useState<VoiceOverlayState | null>(null);

  const fetchCatalogue = useCallback(() => {
    getCatalogueSource()
      .getHomeCatalogue(PLACEHOLDER_INSTITUTION_ID)
      .then((catalogue) => {
        setPublications(dedupeById(catalogue.shelves.flatMap((shelf) => shelf.publications)));
        setLoadedAt(Date.now());
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchCatalogue();
  }, [fetchCatalogue]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchCatalogue();
  }, [fetchCatalogue]);

  // Derived, never stored. A `results` state variable would need keeping in step
  // with four other pieces of state, and the first missed update is a list that
  // disagrees with the query that produced it.
  //
  // `now` is passed IN rather than read inside `src/search`, so the whole shell
  // stays a pure function of its arguments and the date filter is testable
  // without freezing the clock.
  const results = useMemo(
    () =>
      runCatalogueSearch({
        publications,
        query,
        contentType: criteria.contentType,
        dateRange: criteria.dateRange,
        sort: criteria.sort,
        now: loadedAt,
      }),
    [publications, query, criteria, loadedAt],
  );

  const activeCount = activeCriteriaCount(criteria);

  // Blank query AND nothing filtered means the reader has not asked anything
  // yet. That is different from having asked and found nothing, which is why the
  // two get different copy below.
  const searching = query.trim().length > 0 || activeCount > 0;

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Couldn&apos;t load the catalogue.</Text>
        <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.field}>
        <SearchInput
          value={query}
          placeholder="Search books, journals and articles"
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          // Screen 09 is catalogue search, so the mic belongs here. Screen 06
          // (institution search) passes nothing and gets no mic.
          //
          // NOTHING IS RECORDED. A recogniser is a native dependency and adding
          // one is a team decision, not a per-person one, so the overlay opens
          // as a view only: the transcript stays empty and its Search button
          // stays disabled. When a recogniser lands it feeds `transcript` and
          // drives `voiceState` — the overlay itself needs no change.
          onVoicePress={() => setVoiceState('listening')}
          disabled={loading}
        />
      </View>

      {/* Quick access to the one dimension a reader changes most, plus the way
          into everything else. Both drive the SAME state as the sheet, so the
          row and the sheet can never disagree. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow: 0 is load-bearing. A horizontal ScrollView in a column
        // parent expands to fill the free vertical space, which pushes the
        // results list a couple of hundred pixels down the screen and reads as
        // a mysterious gap rather than as a layout bug.
        style={styles.chipsBar}
        contentContainerStyle={styles.chips}
      >
        <Pressable
          testID="filter-sort-trigger"
          onPress={() => setFiltersOpen(true)}
          style={styles.trigger}
          accessibilityRole="button"
          accessibilityLabel="Filter and sort"
        >
          <Ionicons name="options-outline" size={FILTER_ICON_SIZE} color={color.surface} />
          <Text style={styles.triggerLabel}>
            {activeCount > 0 ? `Filter & Sort · ${activeCount}` : 'Filter & Sort'}
          </Text>
        </Pressable>

        {CONTENT_TYPES.map((value) => (
          <FilterChip
            key={value}
            label={CONTENT_TYPE_LABELS[value]}
            selected={criteria.contentType === value}
            disabled={!isContentTypeSupported(value)}
            onPress={() => setCriteria({ ...criteria, contentType: value })}
          />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.results}>
        {loading &&
          Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))}

        {!loading &&
          results.map((publication) => (
            <ContentCard
              key={publication.id}
              title={publication.title}
              publisher={publication.publisher}
              imageUrl={publication.coverUrl}
              onPress={() => navigation.navigate('ItemDetail', { itemId: publication.id })}
            />
          ))}

        {!loading && results.length === 0 && (
          <Text style={styles.message}>
            {query.trim().length > 0
              ? `No books or articles match “${query.trim()}”.`
              : 'Nothing matches these filters.'}
          </Text>
        )}

        {!loading && !searching && results.length > 0 && (
          <Text style={styles.hint}>Showing everything. Type above to narrow it down.</Text>
        )}
      </ScrollView>

      {filtersOpen && (
        <FilterSheet
          criteria={criteria}
          onApply={(next) => {
            setCriteria(next);
            setFiltersOpen(false);
          }}
          onDismiss={() => setFiltersOpen(false)}
        />
      )}

      <VoiceOverlay
        visible={voiceState !== null}
        state={voiceState ?? 'listening'}
        onCancel={() => setVoiceState(null)}
        onClear={() => setVoiceState('listening')}
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
  chipsBar: {
    flexGrow: 0,
  },
  chips: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  // Navy rather than teal so it reads as the way INTO the filters, not as one
  // more filter that happens to be switched on.
  trigger: {
    height: space.xl + space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  triggerLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.surface,
  },
  results: {
    paddingHorizontal: space.md,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
  },
  message: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
    marginTop: space.lg,
  },
  hint: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
    marginTop: space.md,
  },
  retry: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
