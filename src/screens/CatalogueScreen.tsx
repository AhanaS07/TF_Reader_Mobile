// P0-3/P0-4 (Prayas) — wires CategoryCard and ContentCard to the DataSource seam.
//
// SHAPE FOLLOWS THE FEED, NOT THE MOCKUP'S TAB BEHAVIOUR. The top strip is one
// CategoryCard per `catalogue.navigation` entry; the "Recently published" section
// below is the home catalogue's OWN shelves, each under its own heading. Both
// lists come from the feed and neither has a fixed length or a known name — an
// administrator configures the shelves per institution (AGENTS.md L-5, settled
// 16 Aug 2026), so handle none, one and many.
//
// Tapping a category card does not filter the list below. A shelf is not a
// filter: it pushes ShelfDetail (ShelfScreen), which fetches that shelf's own
// full, paginated listing via getShelf(). See ShelfScreen.tsx.
//
// `institutionId` comes from the institution store, falling back to inst_7f3
// until one is selected. The picker above the category row changes it.
//
// NO ACCESS BADGE YET, AND `resolveAccess` IS NO LONGER THE REASON — it landed
// and is on main. `ContentCard`'s `badge` slot takes already-resolved UI (Design
// Spec §5.1 — the UI must never calculate access rights), and reaching into
// `publication.acquisition` here to fake one is still exactly the violation that
// rule exists to prevent. What is left is the wiring, and nothing blocks it:
// `resolveAccess` takes `session: null` with no loan and no hold and resolves
// Open Access, Subscription and Elite-with-nothing-held correctly, which is
// precisely so a list can be wired before the session store exists. Call it per
// row and pass the result to the slot; do not derive a badge here.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CategoryCard, type CategoryAccent } from '../components/CategoryCard';
import { ContentCard } from '../components/ContentCard';
import { SectionHeader } from '../components/SectionHeader';
import { getCatalogueSource } from '../config/catalogue';
import type { Catalogue } from '../model/types';
import type { CatalogueStackParamList } from '../navigation/types';
import { useInstitutionStore } from '@store/institutionStore';
import { color, space, type as typeScale } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'CatalogueHome'>

// Cycled by POSITION, never by shelf name — types.ts: "NAVIGATION IS DATA, NOT
// CODE ... no shelf is named in a type or a branch anywhere". There are already
// more shelves than accents, so the cycle wraps rather than running out.
const ACCENTS: CategoryAccent[] = ['primary', 'navy', 'success', 'subscription', 'elite'];

// How many skeleton rows/cards to show before the first real payload arrives.
// Arbitrary — there is no data yet to size it from.
const SKELETON_COUNT = 3;

export default function CatalogueScreen() {
  const navigation = useNavigation<Nav>();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const institutionId = selectedInstitution?.id ?? 'inst_7f3';

  // No synchronous setState here — only inside the async continuations. A
  // setState reachable directly from an effect body triggers a lint error
  // ("cascading renders"); `loading`/`failed` are also already at these exact
  // values on mount, so resetting them here would be redundant anyway. Retry
  // is the one path that truly needs to reset them, and it runs from a press
  // handler, not an effect — see below.
  const fetchCatalogue = useCallback(() => {
    getCatalogueSource()
      .getHomeCatalogue(institutionId)
      .then(setCatalogue)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [institutionId]);

  useEffect(() => {
    fetchCatalogue();
  }, [fetchCatalogue]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchCatalogue();
  }, [fetchCatalogue]);

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable
        style={styles.institutionPicker}
        onPress={() => navigation.navigate('InstitutionList')}
        accessibilityRole="button"
        accessibilityLabel="Change institution"
      >
        <Text style={styles.institutionName} numberOfLines={1}>
          {selectedInstitution?.name ?? 'Select institution'}
        </Text>
        <Text style={styles.institutionChange}>Change</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryStrip}
      >
        {loading
          ? ACCENTS.slice(0, SKELETON_COUNT).map((accent, index) => (
              <View key={index} style={styles.categoryCard}>
                <CategoryCard title="" state="loading" accent={accent} />
              </View>
            ))
          : catalogue?.navigation.map((entry, index) => (
              <View key={entry.shelfId} style={styles.categoryCard}>
                <CategoryCard
                  title={entry.title}
                  accent={ACCENTS[index % ACCENTS.length]}
                  // `title` rides along so the pushed screen's app bar can name
                  // the shelf immediately, before its feed has loaded.
                  onPress={() =>
                    navigation.navigate('Shelf', {
                      shelfId: entry.shelfId,
                      title: entry.title,
                    })
                  }
                />
              </View>
            ))}
      </ScrollView>

      {loading
        ? Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))
        : catalogue?.shelves.map((shelf) => (
            <View key={shelf.id} style={styles.section}>
              {/* No `actionLabel`: these are the home-catalogue's own preview
                  shelves, not one of the tappable navigation categories above,
                  so there is no "See all" destination for them. Screen 01's
                  design shows no action on these headers either. */}
              <SectionHeader title={shelf.title} />
              <View style={styles.list}>
                {shelf.publications.map((publication) => (
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
            </View>
          ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  institutionPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.surface,
    borderRadius: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  institutionName: {
    flex: 1,
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  institutionChange: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.primary,
    marginLeft: space.sm,
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
  categoryStrip: {
    gap: space.md,
    paddingHorizontal: space.xs,
  },
  // The strip owns tile width; neither card sets its own (CONVENTIONS §8).
  categoryCard: {
    width: space.xl * 5,
  },
  section: {
    gap: space.sm,
  },
  list: {
    gap: space.sm,
  },
});
