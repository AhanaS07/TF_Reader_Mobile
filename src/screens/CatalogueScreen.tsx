// The Catalogue tab — screen 01, the institution's home surface (CAP-2).
//
// SLOT MAPPING IS NOT INVENTED HERE. `src/adapters/catalogueScreenFlow.test.ts`
// already encodes this screen's data contract against the mock, slot by slot, and
// this file renders exactly that and nothing more:
//
//   Featured carousel   → catalogue.navigation      (eBooks / Audiobooks / Open access)
//   Subject-style chips → catalogue.shelves         (the groups)
//   Bottom list         → the selected shelf's publications
//
// SWITCHING CHIPS IS LOCAL STATE, NEVER A FETCH. The home payload already carries
// each group's publications, which that suite asserts by name ("with no extra
// fetch"). Re-requesting on every chip tap would turn a free interaction into a
// spinner and would quietly disagree with the contract.
//
// THE DATA HOOK LIVES IN THIS FILE ON PURPOSE. It is small, it has exactly one
// caller, and this screen is shared ground — keeping it here means the whole
// feature is one file to review, merge or revert rather than a hook module that
// another branch also has to reconcile. When a second screen needs the same load,
// that is the moment to lift it into `src/hooks/`, not before.
//
// NO ACCESS BADGE, for the reason SearchScreen already documents: `ContentCard`'s
// `badge` slot takes already-resolved UI, and `src/access/resolveAccess` does not
// exist yet. Deriving one from `publication.acquisition` here is exactly the
// Design Spec §5.1 violation ("the UI must never calculate access rights") that
// the slot exists to prevent. The row only needs the input to be present.
//
// THE EMPTY / ERROR TREATMENTS ARE INLINE AND TEMPORARY, matching SearchScreen:
// Khushi's `EmptyState` (K1) owns this copy, and a feature may not introduce a
// component, so this is screen-local text to be deleted when that lands.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CatalogueSource } from '@adapters/CatalogueSource';
import { CategoryCard, type CategoryAccent } from '@components/CategoryCard';
import { ContentCard } from '@components/ContentCard';
import { FilterChip } from '@components/FilterChip';
import { getCatalogueSource } from '@config/catalogue';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import type { Catalogue, Shelf } from '@model/types';
import type { CatalogueStackParamList } from '@navigation/types';
import { color, space, type } from '@theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'CatalogueHome'>;

// Same placeholder SearchScreen uses, and for the same reason: CAP-3 (institution
// selection) has not landed, so there is no real value to read yet.
const PLACEHOLDER_INSTITUTION_ID = 'inst_7f3';

const CAROUSEL_SKELETONS = 3;
const ROW_SKELETONS = 3;

// Carousel cards are sized by the screen, not by themselves: `CategoryCard` sets a
// height and takes its width from the parent (CONVENTIONS §8 — a component sets no
// outer geometry of its own), so a horizontal row has to supply one.
const CAROUSEL_CARD_WIDTH = space.xl * 5;

// Cycled by INDEX, never chosen from the title — types.ts is explicit that
// navigation is data, not code, and no shelf may be named in a branch anywhere.
const CAROUSEL_ACCENTS: readonly CategoryAccent[] = ['primary', 'navy', 'elite'];

// Copy per failure code, keyed on wokay's own vocabulary rather than on an HTTP
// status, so a reader never sees a number. A map rather than a switch: adding a
// code makes the compiler name this line.
const ERROR_COPY: Record<CatalogueError, string> = {
  [CatalogueError.NOT_FOUND]: 'This institution’s catalogue could not be found.',
  [CatalogueError.NETWORK_UNAVAILABLE]: 'You appear to be offline.',
  [CatalogueError.MALFORMED_FEED]: 'The catalogue sent something we could not read.',
  [CatalogueError.TIMEOUT]: 'The catalogue took too long to answer.',
};

// ─── Data ────────────────────────────────────────────────────────────────────

type CatalogueStatus = 'loading' | 'ready' | 'error';

interface UseHomeCatalogue {
  status: CatalogueStatus;
  catalogue?: Catalogue;
  errorCode?: CatalogueError;
  onRetry: () => void;
}

// What one settled request produced, tagged with the request it answers.
interface Settled {
  key: string;
  catalogue?: Catalogue;
  errorCode?: CatalogueError;
}

function useHomeCatalogue(institutionId: string, source: CatalogueSource): UseHomeCatalogue {
  // Bumped by Retry. A counter rather than a boolean so a second retry after a
  // second failure still changes the key and re-runs the request.
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | undefined>(undefined);

  // Which request the screen currently wants an answer to.
  const key = `${institutionId}#${attempt}`;

  // LOADING IS DERIVED, NOT STORED — "we have not yet settled the request we are
  // asking about". Writing it from inside the effect instead would mean a setState
  // in an effect body, which cascades an extra render and is what
  // react-hooks/set-state-in-effect flags. Deriving it also makes the transition
  // back to loading automatic when `institutionId` or `attempt` changes, so there
  // is no second effect keeping status in step with its own inputs.
  const status: CatalogueStatus =
    settled?.key !== key ? 'loading' : settled.errorCode !== undefined ? 'error' : 'ready';

  // Whether this hook is still on screen. UNMOUNT, not per-request cancellation —
  // the case that has to be caught is a reader leaving the tab mid-request, whose
  // answer then arrives to a screen that no longer exists. Declared before the
  // request effect so the two run in the right order.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    source
      .getHomeCatalogue(institutionId)
      // Every outcome is stamped with the key it answers, so a superseded response
      // landing late is simply not the key being rendered and needs no abort.
      .then((catalogue) => {
        if (live.current) setSettled({ key, catalogue });
      })
      .catch((error: unknown) => {
        if (!live.current) return;
        // A source is contracted to reject with CatalogueFailure. Anything else is
        // a bug rather than a network condition, but the reader still needs a
        // state — and "something went wrong out there" is the least wrong thing to
        // say about an unclassified throw.
        setSettled({
          key,
          errorCode: isCatalogueFailure(error)
            ? error.code
            : CatalogueError.NETWORK_UNAVAILABLE,
        });
      });
  }, [institutionId, source, key]);

  const onRetry = useCallback(() => setAttempt((previous) => previous + 1), []);

  const current = settled?.key === key ? settled : undefined;

  return {
    status,
    ...(current?.catalogue !== undefined ? { catalogue: current.catalogue } : {}),
    ...(current?.errorCode !== undefined ? { errorCode: current.errorCode } : {}),
    onRetry,
  };
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CatalogueScreen() {
  const navigation = useNavigation<Nav>();

  // Resolved once. `getCatalogueSource` is lazy and process-wide, so this is also
  // where the Mock-vs-Api choice gets made — by config, never by this file.
  const source = useMemo(() => getCatalogueSource(), []);
  const { status, catalogue, errorCode, onRetry } = useHomeCatalogue(
    PLACEHOLDER_INSTITUTION_ID,
    source,
  );

  // WHICH CHIP IS ACTIVE, not which shelf exists. Held as an id and RESOLVED
  // against the current shelves on every render rather than being synced to them
  // in an effect: shelves arrive asynchronously, and an effect that copied the
  // first id into state would render one frame with nothing selected and would
  // need a second effect to cope with the list changing under it.
  const [selectedShelfId, setSelectedShelfId] = useState<string | undefined>(undefined);

  const shelves: Shelf[] = catalogue?.shelves ?? [];
  // Falls back to the first shelf, so the list is never empty while chips are
  // visible. `id`, never `title` — types.ts warns the two diverge in real data
  // ("Free to read" is id 'open-access').
  const selectedShelf = shelves.find((shelf) => shelf.id === selectedShelfId) ?? shelves[0];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {status === 'loading' && (
          <View testID="catalogue-loading" style={styles.section}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow: 0 is load-bearing on a horizontal ScrollView — see the
              // note on `bar` in the stylesheet.
              style={styles.bar}
              contentContainerStyle={styles.barContent}
            >
              {Array.from({ length: CAROUSEL_SKELETONS }, (_, index) => (
                <View key={index} style={styles.carouselItem}>
                  <CategoryCard state="loading" title="" />
                </View>
              ))}
            </ScrollView>

            <View style={styles.rows}>
              {Array.from({ length: ROW_SKELETONS }, (_, index) => (
                <ContentCard key={index} state="loading" title="" />
              ))}
            </View>
          </View>
        )}

        {status === 'error' && (
          <View testID="catalogue-error" style={styles.panel}>
            <Text style={styles.message}>
              {errorCode === undefined
                ? 'The catalogue could not be loaded.'
                : ERROR_COPY[errorCode]}
            </Text>
            <Pressable
              testID="catalogue-retry"
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry loading the catalogue"
            >
              <Text style={styles.action}>Retry</Text>
            </Pressable>
          </View>
        )}

        {status === 'ready' && catalogue !== undefined && (
          <>
            {/* Which institution this catalogue belongs to. Read from the feed
                rather than hardcoded, so it stays true when CAP-3 lets the reader
                switch — the TopAppBar title is the product, this is the library. */}
            <Text testID="catalogue-title" style={styles.institution}>
              {catalogue.title}
            </Text>

            {catalogue.navigation.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionHeading}>Browse</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.bar}
                  contentContainerStyle={styles.barContent}
                  testID="catalogue-carousel"
                >
                  {catalogue.navigation.map((entry, index) => (
                    // NOT PRESSABLE, AND THAT IS A GAP RATHER THAN A CHOICE. Each
                    // entry carries a `shelfId` ready to open, but
                    // `CatalogueStackParamList` has no shelf route — adding one
                    // means editing the navigator, which is P0-6's file. A card
                    // that looked tappable and did nothing would be worse than one
                    // that does not claim to be. When a shelf route lands this
                    // becomes one `onPress`, and note that 'audiobooks' must then
                    // render NOT_FOUND: no fixture backs it, which
                    // catalogueScreenFlow.test.ts documents deliberately.
                    //
                    // No `count` either — that suite asserts a navigation entry
                    // carries exactly href/shelfId/title, so any number here would
                    // be invented.
                    <View key={entry.shelfId} style={styles.carouselItem}>
                      <CategoryCard
                        title={entry.title}
                        accent={CAROUSEL_ACCENTS[index % CAROUSEL_ACCENTS.length]}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {shelves.length > 0 && selectedShelf !== undefined && (
              <View style={styles.section}>
                {/* Local selection — no request. See the file header. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.bar}
                  contentContainerStyle={styles.barContent}
                  testID="catalogue-shelf-chips"
                >
                  {shelves.map((shelf) => (
                    <FilterChip
                      key={shelf.id}
                      label={shelf.title}
                      selected={shelf.id === selectedShelf.id}
                      onPress={() => setSelectedShelfId(shelf.id)}
                    />
                  ))}
                </ScrollView>

                <Text style={styles.sectionHeading}>{selectedShelf.title}</Text>

                {selectedShelf.publications.length === 0 ? (
                  <Text testID="catalogue-shelf-empty" style={styles.message}>
                    Nothing on this shelf yet.
                  </Text>
                ) : (
                  <View style={styles.rows}>
                    {selectedShelf.publications.map((publication) => (
                      <ContentCard
                        key={publication.id}
                        title={publication.title}
                        publisher={publication.publisher}
                        imageUrl={publication.coverUrl}
                        onPress={() =>
                          navigation.navigate('ItemDetail', { itemId: publication.id })
                        }
                      />
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  content: {
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  section: {
    gap: space.sm,
  },
  // Components set no outer margin of their own (CONVENTIONS §8), so the screen
  // provides the gutter. Applied per-block rather than to `content` because the
  // horizontal bars must bleed to the screen edge while text does not.
  institution: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
  },
  sectionHeading: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
    paddingHorizontal: space.md,
  },
  // flexGrow: 0 is load-bearing, and the reason is the same one SearchScreen
  // records: React Native's ScrollView defaults to flexGrow: 1, so a horizontal
  // one inside a column expands to fill the free vertical space and pushes
  // everything below it down the screen — which reads as a mysterious gap rather
  // than a layout bug.
  bar: {
    flexGrow: 0,
  },
  barContent: {
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  carouselItem: {
    width: CAROUSEL_CARD_WIDTH,
  },
  rows: {
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  panel: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
  },
  message: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
    paddingHorizontal: space.md,
  },
  action: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
