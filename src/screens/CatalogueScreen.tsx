// P0-3/P0-4 (Prayas) — wires CategoryCard and ContentCard to the DataSource seam.
//
// SHAPE FOLLOWS THE FIXTURES, NOT THE MOCKUP'S TAB BEHAVIOUR. The top strip is
// one CategoryCard per `catalogue.navigation` entry (eBooks/Audiobooks/Open
// access from the real fixture); the "Recently published" section below is the
// home-catalogue's OWN shelves ("New this term", "Free to read"), each under its
// own heading. Tapping a category card does not filter that list — CLAUDE.md L-5
// (three tabs, or one merged list?) is unsettled, and the mockup's "tap eBooks,
// see its shelf on a separate screen" needs getShelf() + a route that does not
// exist in the navigator yet (RootNavigator / navigation/types.ts are Keshav's,
// P0-6). So a category card has nowhere to send the user today: it renders with
// no onPress and no chevron, honestly, rather than pretending. Wire it up when
// that screen lands — it is a one-line addition here.
//
// `institutionId` IS HARDCODED to the one id the mock fixtures serve. CAP-3
// (institution selection) has not landed, so there is no real value to read yet.
// Replace this constant with whatever CAP-3 hands the screen; nothing else here
// should need to change.
//
// NO ACCESS BADGE YET. `ContentCard`'s `badge` slot takes already-resolved UI
// (Design Spec §5.1 — the UI must never calculate access rights), and
// `src/access/resolveAccess` does not exist yet. Reaching into
// `publication.acquisition` here to fake one would be exactly the violation that
// rule exists to prevent, so the slot is left empty until resolveAccess lands.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CategoryCard, type CategoryAccent } from '../components/CategoryCard';
import { ContentCard } from '../components/ContentCard';
import { getCatalogueSource } from '../config/catalogue';
import type { Catalogue } from '../model/types';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, space, type as typeScale } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'CatalogueHome'>;

const PLACEHOLDER_INSTITUTION_ID = 'inst_7f3';

// Cycled by POSITION, never by category name — types.ts: "NAVIGATION IS DATA,
// NOT CODE ... no tab is named in a type or a branch anywhere". A fourth
// category tomorrow just continues the cycle.
const ACCENTS: CategoryAccent[] = ['primary', 'navy', 'success', 'subscription', 'elite'];

// How many skeleton rows/cards to show before the first real payload arrives.
// Arbitrary — there is no data yet to size it from.
const SKELETON_COUNT = 3;

export default function CatalogueScreen() {
  const navigation = useNavigation<Nav>();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // No synchronous setState here — only inside the async continuations. A
  // setState reachable directly from an effect body triggers a lint error
  // ("cascading renders"); `loading`/`failed` are also already at these exact
  // values on mount, so resetting them here would be redundant anyway. Retry
  // is the one path that truly needs to reset them, and it runs from a press
  // handler, not an effect — see below.
  const fetchCatalogue = useCallback(() => {
    getCatalogueSource()
      .getHomeCatalogue(PLACEHOLDER_INSTITUTION_ID)
      .then(setCatalogue)
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
                <CategoryCard title={entry.title} accent={ACCENTS[index % ACCENTS.length]} />
              </View>
            ))}
      </ScrollView>

      {loading
        ? Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))
        : catalogue?.shelves.map((shelf) => (
            <View key={shelf.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{shelf.title}</Text>
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
  // The carousel owns tile width; neither card sets its own (CONVENTIONS §8).
  categoryCard: {
    width: space.xl * 5,
  },
  section: {
    gap: space.sm,
  },
  sectionTitle: {
    fontWeight: typeScale.sectionHeader.weight,
    fontSize: typeScale.sectionHeader.size,
    lineHeight: typeScale.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  list: {
    gap: space.sm,
  },
});
