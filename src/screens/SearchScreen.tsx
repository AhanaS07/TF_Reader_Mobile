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
// EMPTY AND ERROR RENDER THROUGH THE SHARED COMPONENTS. Khushi's `EmptyState`
// (K1) and `ErrorState` own this copy and this layout now that both exist —
// this screen supplies only the variant and the already-resolved message, per
// CONVENTIONS §3. Only the load-more failure stays inline: it is a row beneath
// results already on screen, not a screen-level takeover either component models.
//
// THE BADGE IS RESOLVED HERE, NOT COMPUTED. `resolveAccess` is the only place
// access logic may live (Design Spec §5.1) — this screen calls it per row and
// passes only the resolved `.tier` into `ContentCard`'s `badge` slot. It never
// reads `publication.acquisition.licenceModel` itself.
//
// A RESULT ROW AND A RECENTLY-VIEWED ROW ARE THE SAME `ContentCard` ROW
// CATALOGUE ITSELF USES — on explicit instruction not to invent a second
// display for the same kind of data. `renderPublicationRow` is the one place
// that builds one, so a result and a "recently viewed" item cannot drift
// into looking like two different things.
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';

import { isNotEntitled, resolveAccess } from '@access/resolveAccess';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { useCurrentSession } from '@access/currentSession';
import type { CategoryAccent } from '@components/CategoryCard';
import { ContentCard } from '@components/ContentCard';
import { ErrorState } from '@components/ErrorState';
import { FilterSortSheet } from '@components/FilterSortSheet';
import { SearchInput } from '@components/SearchInput';
import { SectionHeader } from '@components/SectionHeader';
import { VoiceOverlay, type VoiceOverlayState } from '@components/VoiceOverlay';
import { getSearchPipeline } from '@config/search';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import type { Publication } from '@model/types';
import type { SearchFilters, SearchStatus, VoiceStatus } from '@/search';
import { useCatalogueSearch, useVoiceSearch, VOICE_ERROR_COPY } from '@/search';
import type { RootTabParamList, SearchStackParamList } from '@navigation/types';
import { useRecentlyViewedStore } from '@store/recentlyViewedStore';
import { useRecentSearchesStore } from '@store/recentSearchesStore';
import { color, elevation, radius, space, type, weight } from '@theme/tokens';

// Composite, not a plain stack prop, because "Browse the full catalogue"
// crosses into the Catalogue tab's Shelf screen — same cross-tab pattern
// ProfileScreen and AccessGateScreen already use to reach the other tab.
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>,
  BottomTabNavigationProp<RootTabParamList, 'Search'>
>;

const SKELETON_COUNT = 3;

// The store itself remembers more (MAX_RECENTLY_VIEWED, recentlyViewedStore.ts)
// so a future second consumer isn't capped by this screen's own display
// choice — this is purely how many of those Search shows, on explicit request.
const RECENTLY_VIEWED_DISPLAY_LIMIT = 3;

// The leading/trailing glyphs on a recent-search row and the no-results
// panel's own icon — sized against `type.body`'s own line height so an icon
// sits on the same visual baseline as the text beside it, composed rather
// than a bare number (CONVENTIONS §5).
const ROW_ICON_SIZE = type.body.lineHeight;

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
//
// A ramp of blues. The status and access-tier colours that used to be in this
// cycle are semantic — see the CategoryCard header.
const BROWSE_ACCENTS: readonly CategoryAccent[] = ['primary', 'navy', 'blueBright'];

// How the recogniser's lifecycle renders. `VoiceStatus` is the machine
// (src/search/voiceState.ts); `VoiceOverlayState` is the four things the surface
// can look like — they are deliberately not the same list, because the overlay
// has no reason to distinguish a refusal from a broken recogniser and the
// machine very much does.
//
// A full Record, so a new `VoiceStatus` member is a compile error here rather
// than a state that silently renders as something else.
const VOICE_OVERLAY_STATE: Record<VoiceStatus, VoiceOverlayState> = {
  // Never read — the overlay is hidden when the machine is closed. Present only
  // because the map is exhaustive.
  closed: 'listening',
  // The OS permission dialog is covering the screen, so "Listening…" is what
  // the reader sees behind it either way.
  checkingPermission: 'listening',
  listening: 'listening',
  processing: 'transcribing',
  done: 'success',
  // All three are one surface: the copy carries the difference, and it comes
  // from VOICE_ERROR_COPY rather than from a fourth visual state.
  noSpeech: 'error',
  permissionDenied: 'error',
  failed: 'error',
};

// Search has no sort parameter at all — searchCatalogue's own contract carries
// none (see SORT_ORDERS in model/types.ts). This satisfies FilterSortSheet's
// required onSelectSort prop for a row that stays permanently disabled below.
function noopSort() {
  /* sort is not a search parameter — see sortDisabled on <FilterSortSheet> */
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();

  // Null unless the reader has actually signed in — see currentSession.ts's
  // note on why this replaced handToggledSession.
  const session = useCurrentSession();

  // The real institution, never a hardcoded fallback — null when the reader
  // has no institution (not signed in, or an individual subscriber), in which
  // case search runs as a public search instead of one scoped to a catalogue
  // that doesn't apply to this reader. Every use below reads this instead of
  // re-deriving it, so there's exactly one place this can go stale.
  const institutionId = session !== null ? session.institutionId ?? null : null;

  // Resolved once. `getSearchPipeline` is lazy and process-wide, so this is also
  // where the fixture-vs-api choice gets made — by config, never by this file.
  const pipeline = useMemo(() => getSearchPipeline(), []);
  const search = useCatalogueSearch({
    institutionId: institutionId ?? undefined,
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

  // Client-side only, same footing as recent searches — see
  // recentlyViewedStore.ts's own header.
  const recentlyViewed = useRecentlyViewedStore((s) => s.items).slice(
    0,
    RECENTLY_VIEWED_DISPLAY_LIMIT,
  );

  // Screen 11. The overlay stays a pure view — the recogniser and the microphone
  // permission live in this hook, and it knows nothing about searching.
  const voice = useVoiceSearch();

  // WHERE VOICE REJOINS ORDINARY SEARCH, and the whole of it. A transcript is
  // "simply a second way to produce a query string", so it goes through the same
  // two calls `onSelectRecentQuery` above makes — no voice-shaped search path,
  // no second pipeline, and nothing new on the wire.
  const onVoiceSubmit = useCallback(() => {
    const transcript = voice.transcript.trim();
    // Belt and braces: the machine cannot reach `submitted` from a silence, and
    // the overlay disables Search without a transcript. Neither of those is
    // visible from here, and a blank query fired at an entitlement-scoped
    // endpoint is the failure worth two guards.
    if (transcript.length === 0) return;

    voice.onSubmit();
    addRecentQuery(transcript);
    search.onChangeQuery(transcript);
    search.onSubmit();
  }, [voice, addRecentQuery, search]);

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
  // Counted, not just a boolean — the "Filter & Sort (1)" badge on the
  // button needs the real number, and a boolean derived from it below costs
  // nothing extra.
  const activeFilterCount =
    (search.filters.contentType !== undefined ? 1 : 0) +
    (search.filters.accessTier !== undefined ? 1 : 0);
  const hasActiveFilter = activeFilterCount > 0;
  // A failure with results already on screen is a failed NEXT PAGE — the reader
  // keeps what they were reading and gets a retry where the page would have been.
  const pageFailed = state === 'error' && hasResults;

  // ONE ROW BUILDER FOR EVERY `Publication` THIS SCREEN DRAWS — a result and
  // a "recently viewed" item are the same kind of thing, so this is the one
  // place that turns either into `ContentCard`'s own row, the same shape
  // Catalogue uses. Closes over `institutionId`/`session` rather than taking
  // them as parameters, since every caller in this file already has them in
  // scope and passing them through would just be ceremony.
  //
  // SESSION PASSED, NOT NULL — corrected for D12. This used to pass
  // `session: null` and say it matched CatalogueScreen and ItemDetailScreen;
  // both actually pass `handToggledSession`, so this row was the outlier. It
  // mattered: `resolveAccess` §4 answers `requires_signin` for ANY licensed
  // tier when the session is null, so the Elite branch was unreachable here
  // and a search result could never offer the queue. resolveAccess's own §5
  // states the goal this restores — "an Elite row resolving identically on a
  // list and on a detail screen".
  //
  // No loan/hold: neither a search result nor a recently-viewed item carries
  // holdings. The session IS passed — that half is not part of the D12
  // revert, and it is what makes an Elite result resolve consistently with
  // the detail screen.
  function renderPublicationRow(publication: Publication, onPress: () => void) {
    const access = resolveAccess({ item: publication, institutionId, session });
    const authors =
      publication.authors.length > 0 ? publication.authors.join(', ') : undefined;
    // Real page count, not an invented edition — `numberOfPages` is the one
    // printed-extent field the feed actually carries. Same reasoning as
    // CatalogueScreen's own `meta` line.
    const meta =
      publication.numberOfPages === undefined ? undefined : `${publication.numberOfPages} pp.`;

    return (
      <ContentCard
        key={publication.id}
        title={publication.title}
        publisher={publication.publisher}
        imageUrl={publication.coverUrl}
        format={publication.format}
        {...(authors === undefined ? {} : { authors })}
        {...(meta === undefined ? {} : { meta })}
        // D8 — `not_entitled` renders nothing at all, badge included.
        badge={isNotEntitled(access) ? undefined : <AccessTierBadge tier={access.tier} />}
        // NO `action` PROP. D12's Elite queue affordance is ItemDetailScreen
        // only — confirmed team decision, 26 Aug.
        onPress={onPress}
      />
    );
  }

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
          // The press asks for the microphone permission and then opens it —
          // see `useVoiceSearch`. Nothing about a recogniser reaches this file.
          onVoicePress={voice.onMicPress}
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
        <Text style={styles.filterButtonLabel}>
          {hasActiveFilter ? `Filter & Sort (${activeFilterCount})` : 'Filter & Sort'}
        </Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.results}>
        {/* The plain instructional line only earns its place once a reader
            has actually started typing — with an empty draft, Popular
            searches and Recently viewed below are the more useful "here is
            what you can do" than a sentence restating the placeholder. */}
        {state === 'idle' && search.draft.trim().length > 0 && (
          <View style={styles.compactCard}>
            <Text testID="search-idle" style={styles.message}>
              Search this catalogue by title, author, subject or description.
            </Text>
          </View>
        )}

        {/* Recent searches — client-side only (recentSearchesStore.ts).
            Shown only before a fresh query is typed: once a reader has
            started their own, a list of old ones is clutter, not help. */}
        {state === 'idle' && search.draft.trim().length === 0 && recentQueries.length > 0 && (
          <View testID="search-recent" style={styles.recent}>
            <SectionHeader
              title="Recent searches"
              emphasis="editorial"
              actionLabel="Clear"
              onAction={clearRecentQueries}
            />
            {recentQueries.map((query) => (
              <Pressable
                key={query}
                testID="search-recent-item"
                onPress={() => onSelectRecentQuery(query)}
                style={styles.recentRow}
                accessibilityRole="button"
                accessibilityLabel={`Search again for ${query}`}
              >
                <Ionicons name="time-outline" size={ROW_ICON_SIZE} color={color.textSecondary} />
                <Text style={styles.recentRowLabel} numberOfLines={1}>
                  {query}
                </Text>
                {/* The classic "fills the search field" glyph — a plain up
                    arrow rotated to point at the field above rather than a
                    bespoke asset. */}
                <Ionicons
                  name="arrow-up-outline"
                  size={ROW_ICON_SIZE}
                  color={color.textSecondary}
                  style={styles.recentRowFillIcon}
                />
              </Pressable>
            ))}
          </View>
        )}

        {/* Client-side only (recentlyViewedStore.ts) — the reader's own last
            few opened items. Same "before a fresh query" gating as Recent
            searches; a reader mid-typing does not need a reminder of what
            they already looked at. Drawn with the exact same row Catalogue
            itself uses — see `renderPublicationRow`. */}
        {state === 'idle' && search.draft.trim().length === 0 && recentlyViewed.length > 0 && (
          <View testID="search-recently-viewed" style={styles.recentlyViewed}>
            <SectionHeader title="Recently viewed" emphasis="editorial" />
            {recentlyViewed.map((publication) =>
              renderPublicationRow(publication, () =>
                navigation.navigate('ItemDetail', { itemId: publication.id }),
              ),
            )}
          </View>
        )}

        {state === 'loading' &&
          Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))}

        {/* THE ERROR STATE, and only for an actual failure. A response that
            arrived and contained nothing never reaches this branch. */}
        {state === 'error' && !hasResults && (
          <View testID="search-error" style={styles.cardChrome}>
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
            {/* A Search-local panel, not the shared EmptyState component.
                EmptyState's own padding (`space.xl`, the most generous in the
                whole scale) is right for the full-screen centred panel it was
                built for (ShelfScreen, PublicCatalogueScreen) — inline below
                a search field it read as a card built to fill a screen it
                was not on, which is the "too spacious" of it. Same copy
                contract as EmptyState's own `no_query_results`/
                `no_filter_results` (curly-quoted query, "Clear search" vs
                "Clear filters"), just laid out at this screen's own density. */}
            <View style={styles.compactCard}>
              <Ionicons name="search-outline" size={ROW_ICON_SIZE * 1.5} color={color.textSecondary} />
              <Text style={styles.message}>
                {hasActiveFilter
                  ? 'Try adjusting your filters.'
                  : `No articles or books match “${search.query}”.`}
              </Text>

              <View testID="search-empty-tips" style={styles.tips}>
                {[
                  'Checking your spelling',
                  'Using different keywords',
                  'Searching for a broader topic',
                  ...(hasActiveFilter ? ['Removing some filters'] : []),
                ].map((tip) => (
                  <View key={tip} style={styles.tipRow}>
                    <Text style={styles.tipBullet}>•</Text>
                    <Text style={styles.tipLabel}>{tip}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                // Screen 17 — "Clear search" beside the no-results message. The
                // same `onClear` the input's own clear button uses when there is
                // no active filter, so the two routes out of a dead query land
                // in the same state.
                onPress={hasActiveFilter ? clearAllFilters : search.onClear}
                style={styles.clearButton}
                accessibilityRole="button"
                accessibilityLabel={hasActiveFilter ? 'Clear filters' : 'Clear search'}
              >
                <Text style={styles.clearButtonLabel}>
                  {hasActiveFilter ? 'Clear filters' : 'Clear search'}
                </Text>
              </Pressable>
            </View>

            {/* A shelf only exists within one institution's catalogue, so this
                is only offered when the reader actually has one — otherwise
                Shelf would receive an institutionId that isn't theirs. */}
            {search.browseInstead.length > 0 && institutionId !== null && (
              <View testID="search-browse-instead" style={styles.browse}>
                <SectionHeader title="Browse instead" emphasis="editorial" />
                {/* A Search-local row, not CategoryCard — that component's
                    fixed height (`CARD_HEIGHT`, tokens.ts's `space.xl * 3`)
                    is tuned for a narrow tile in a horizontal strip
                    (ShelfScreen, InstitutionDetailScreen); stretched to this
                    screen's full content width it read as a squat, padded
                    banner rather than a single-line action row. */}
                {search.browseInstead.map((entry, index) => (
                  // Shelf now exists (Catalogue stack), so a shelf target crosses
                  // tabs to it — same cross-tab pattern AccessGateScreen already
                  // uses to reach SignIn. A catalogue target has no group to open
                  // by id (see NavLink.target in types.ts) — getShelf would only
                  // 404 on it — so it goes to the catalogue home instead.
                  <Pressable
                    key={entry.shelfId}
                    testID="search-browse-item"
                    style={[
                      styles.browseRow,
                      { backgroundColor: color[BROWSE_ACCENTS[index % BROWSE_ACCENTS.length]] },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={entry.title}
                    onPress={() =>
                      entry.target === 'shelf'
                        ? navigation.navigate('Catalogue', {
                            screen: 'Shelf',
                            params: {
                              shelfId: entry.shelfId,
                              title: entry.title,
                              institutionId,
                            },
                          })
                        : navigation.navigate('Catalogue', { screen: 'CatalogueHome' })
                    }
                  >
                    <Text style={styles.browseRowLabel} numberOfLines={1}>
                      {entry.title}
                    </Text>
                    <Ionicons name="chevron-forward" size={ROW_ICON_SIZE} color={color.white} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* The reference mockup's "1,245 results" line — server-reported,
            same source the bottom "Showing X of Y" note already trusts.
            Shown once, above the list, rather than only after it. */}
        {hasResults && search.totalItems !== undefined && (
          <View style={styles.resultsHeader}>
            <Text testID="search-results-count" style={styles.resultsCount}>
              {search.totalItems === 1 ? '1 result' : `${search.totalItems} results`}
            </Text>
          </View>
        )}

        {search.publications.map((publication) =>
          renderPublicationRow(publication, () =>
            navigation.navigate('ItemDetail', { itemId: publication.id }),
          ),
        )}

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
          <View testID="search-page-error" style={styles.compactCard}>
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

      {/* Screen 11. Still a pure view — every prop below is already-resolved
          state, and the copy is looked up here rather than in the machine, the
          same way this screen resolves CATALOGUE_ERROR_COPY for ErrorState. */}
      <VoiceOverlay
        visible={voice.status !== 'closed'}
        state={VOICE_OVERLAY_STATE[voice.status]}
        transcript={voice.transcript}
        errorMessage={voice.errorCode === undefined ? undefined : VOICE_ERROR_COPY[voice.errorCode]}
        onCancel={voice.onCancel}
        onClear={voice.onClear}
        onSubmit={onVoiceSubmit}
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
    backgroundColor: color.white,
  },
  // SearchInput sets no outer margin of its own (CONVENTIONS §8), so the screen
  // laying it out provides the gutter.
  field: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  helper: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
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
    // A card, not a bare outline — same family as the search field and the
    // result panels below, so this reads as one designed surface next to
    // them rather than a plain HTML-style pill.
    backgroundColor: color.white,
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },
  filterButtonLabel: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textPrimary,
  },
  recent: {
    gap: space.xs,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  recentRowLabel: {
    flex: 1,
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  // Points at the field above rather than the plain "up" the glyph reads as
  // on its own — the same "fills the search box" convention as most search
  // history lists.
  recentRowFillIcon: {
    transform: [{ rotate: '-45deg' }],
  },
  note: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
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
  // Groups the no-results card with the browse-instead section beneath it —
  // spacing between the two comes from `results`' own `gap`, not from padding
  // here, so this adds no extra air of its own.
  panel: {
    alignItems: 'center',
    gap: space.md,
  },
  // The card surface for every plain-text message block on this screen (the
  // idle prompt, the no-results message, the inline "more results failed"
  // row) — deliberately tighter than EmptyState's own `space.xl` padding.
  // That padding is right for the full-screen centred panel EmptyState was
  // built for (ShelfScreen, PublicCatalogueScreen); reused inline below a
  // search field, on a screen already dense with its own controls, it read
  // as a card sized for a screen it was not on. Search-local, on purpose —
  // EmptyState and ErrorState themselves stay bare, since Catalogue renders
  // both directly (its own `no_content` state, its own failed-load state)
  // and must not pick up a border/shadow it never asked for.
  compactCard: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    backgroundColor: color.white,
    borderRadius: radius.sheet,
    borderWidth: 1,
    borderColor: color.border,
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },
  // `cardChrome` — chrome only, no padding — for wrapping ErrorState, which
  // already pads itself; a network failure keeps going through that shared
  // component rather than a duplicated local copy, since its copy varies by
  // `ErrorStateVariant` in a way the no-results panel's two cases do not.
  cardChrome: {
    backgroundColor: color.white,
    borderRadius: radius.sheet,
    borderWidth: 1,
    borderColor: color.border,
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },
  // The outlined pill EmptyState's own "Clear search"/"Clear filters" button
  // used — replicated here rather than imported, since this screen no longer
  // renders through that component for this state (see `compactCard`).
  clearButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
  },
  clearButtonLabel: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
  // No `marginTop` — `panel`'s own `gap` already spaces this from the
  // no-results card above it.
  browse: {
    alignSelf: 'stretch',
    gap: space.sm,
  },
  // A single-line action row at this screen's own width, not a squarish
  // tile — see the comment where this is used for why CategoryCard's own
  // fixed height was the wrong shape here.
  browseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },
  browseRowLabel: {
    flex: 1,
    fontWeight: weight.bold,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.white,
  },
  message: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
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
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
  // ─── recently viewed ────────────────────────────────────────────────────────
  recentlyViewed: {
    gap: space.xs,
  },
  // ─── results header ────────────────────────────────────────────────────────
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  resultsCount: {
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // ─── no-results tips ───────────────────────────────────────────────────────
  tips: {
    alignSelf: 'stretch',
    gap: space.xs,
    marginTop: space.xs,
  },
  tipRow: {
    flexDirection: 'row',
    gap: space.xs,
  },
  tipBullet: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  tipLabel: {
    flex: 1,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
});
