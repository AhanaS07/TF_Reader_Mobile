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
// THE EMPTY / ERROR TREATMENTS ARE INLINE AND TEMPORARY. Khushi's `EmptyState`
// (K1) owns this copy. Building a second one here would break the rule the spec
// calls most likely to fail quietly — a feature may not introduce a component —
// so this is screen-local text, to be deleted when EmptyState lands.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CategoryCard, type CategoryAccent } from '@components/CategoryCard';
import { ContentCard } from '@components/ContentCard';
import { FilterChip } from '@components/FilterChip';
import { SearchInput } from '@components/SearchInput';
import { VoiceOverlay, type VoiceOverlayState } from '@components/VoiceOverlay';
import { getSearchPipeline } from '@config/search';
import { CatalogueError } from '@model/errors';
import { ACCESS_TIERS, type AccessTier } from '@model/types';
import type { SearchStatus } from '@/search';
import { ACCESS_TIER_FILTER_CONFIRMED, useCatalogueSearch } from '@/search';
import type { ContentFormat } from '@/shared/types/primitives';
import type { SearchStackParamList } from '@navigation/types';
import { color, radius, space, type } from '@theme/tokens';

type Nav = NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>;

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

// Reader-facing labels, kept apart from the machine values so a rewording can
// never change what goes on the wire.
//
// TYPED AS A FULL Record, WHICH IS WHAT MAKES THE ROW EXHAUSTIVE. `ContentFormat`
// is a type with no const array behind it (primitives.ts declares only the union),
// so the chip row is driven by this map's keys — and omitting a format here is a
// compile error rather than a chip that silently stops being offered.
const CONTENT_TYPE_LABELS: Record<ContentFormat, string> = {
  EPUB: 'eBooks',
  PDF: 'PDF',
  AUDIO: 'Audiobooks',
};

const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as ContentFormat[];

const ACCESS_TIER_LABELS: Record<AccessTier, string> = {
  OPEN_ACCESS: 'Open access',
  SUBSCRIPTION: 'Subscription',
  ELITE: 'Elite',
};

// Copy per failure code, keyed on wokay's own vocabulary rather than on an HTTP
// status, so a reader never sees a number. A map rather than a switch: adding a
// code makes the compiler name this line.
const ERROR_COPY: Record<CatalogueError, string> = {
  [CatalogueError.NOT_FOUND]: 'This catalogue cannot be searched.',
  [CatalogueError.NETWORK_UNAVAILABLE]: 'You appear to be offline.',
  [CatalogueError.MALFORMED_FEED]: 'The catalogue sent something we could not read.',
  [CatalogueError.TIMEOUT]: 'The search took too long to answer.',
};

// Browse-instead cards cycle the accents so three targets do not read as one
// block of colour. Cycled by INDEX, never chosen from the title — types.ts is
// explicit that navigation is data, not code, and no shelf may be named in a
// branch anywhere.
const BROWSE_ACCENTS: readonly CategoryAccent[] = ['primary', 'navy', 'elite'];

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

  // The overlay is a pure view; nothing here records audio. See the mic handler.
  const [voiceState, setVoiceState] = useState<VoiceOverlayState | null>(null);

  const state: SearchStatus = search.state;
  const hasResults = search.publications.length > 0;
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
          onSubmit={search.onSubmit}
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

      {/* Content type. Sent as a query parameter with the search itself, so the
          server narrows before it paginates — changing a chip starts a new search
          rather than trimming the page already on screen. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow: 0 is load-bearing. A horizontal ScrollView in a column parent
        // expands to fill the free vertical space, which pushes the results list
        // down the screen and reads as a mysterious gap rather than a layout bug.
        style={styles.chipsBar}
        contentContainerStyle={styles.chips}
      >
        <FilterChip
          label="All"
          // "No constraint" is the absence of a value, not a fourth format — so
          // there is no 'ALL' member to filter back out before the wire.
          selected={search.filters.contentType === undefined}
          onPress={() => search.onSelectContentType(undefined)}
        />
        {CONTENT_TYPES.map((contentType) => (
          <FilterChip
            key={contentType}
            label={CONTENT_TYPE_LABELS[contentType]}
            selected={search.filters.contentType === contentType}
            onPress={() => search.onSelectContentType(contentType)}
          />
        ))}
      </ScrollView>

      {/* Access tier. Q-12 is resolved — wokay's contract confirms `accessTier`
          as a real filter parameter, so the dimension is enabled and the chosen
          tier is sent. See ACCESS_TIER_FILTER_CONFIRMED. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsBar}
        contentContainerStyle={styles.chips}
      >
        {ACCESS_TIERS.map((tier) => (
          <FilterChip
            key={tier}
            label={ACCESS_TIER_LABELS[tier]}
            selected={search.filters.accessTier === tier}
            disabled={!ACCESS_TIER_FILTER_CONFIRMED}
            onPress={() => search.onSelectAccessTier(tier)}
          />
        ))}
      </ScrollView>

      {!ACCESS_TIER_FILTER_CONFIRMED && (
        <Text testID="search-tier-note" style={styles.note}>
          Access tier filtering is awaiting confirmation from the catalogue team.
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.results}>
        {state === 'idle' && (
          <Text testID="search-idle" style={styles.message}>
            Search this catalogue by title, author, subject or description.
          </Text>
        )}

        {state === 'loading' &&
          Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))}

        {/* THE ERROR STATE, and only for an actual failure. A response that
            arrived and contained nothing never reaches this branch. */}
        {state === 'error' && !hasResults && (
          <View testID="search-error" style={styles.panel}>
            <Text style={styles.message}>
              {search.errorCode === undefined
                ? 'The search could not be completed.'
                : ERROR_COPY[search.errorCode]}
            </Text>
            <Pressable
              testID="search-retry"
              onPress={search.onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry search"
            >
              <Text style={styles.action}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* THE ZERO-RESULT STATE. A successful response with nothing in it —
            including one that carried no `publications` key at all and only
            browse targets. Not an error, and it must never render as one. */}
        {state === 'empty' && (
          <View testID="search-empty" style={styles.panel}>
            <Text style={styles.emptyTitle}>No publications found</Text>
            <Text style={styles.message}>
              Nothing in this catalogue matches “{search.query}”.
            </Text>

            {search.browseInstead.length > 0 && (
              <View testID="search-browse-instead" style={styles.browse}>
                <Text style={styles.browseHeading}>Browse instead</Text>
                {search.browseInstead.map((entry, index) => (
                  // NOT PRESSABLE, AND THAT IS A GAP RATHER THAN A CHOICE. Each
                  // entry carries a `shelfId` ready to open, but no stack in this
                  // app has a shelf route yet (navigation is P0-6's) — so there is
                  // nowhere to send the tap. A card that looked tappable and did
                  // nothing would be worse than one that does not claim to be.
                  // When a shelf route lands this becomes one `onPress`.
                  <CategoryCard
                    key={entry.shelfId}
                    title={entry.title}
                    accent={BROWSE_ACCENTS[index % BROWSE_ACCENTS.length]}
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
                : ERROR_COPY[search.errorCode]}
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
  chipsBar: {
    flexGrow: 0,
  },
  chips: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
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
  emptyTitle: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
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
