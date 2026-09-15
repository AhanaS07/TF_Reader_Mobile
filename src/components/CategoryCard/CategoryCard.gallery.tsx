// Gallery entry — every state of CategoryCard from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
//
// Each card sits in a fixed-width box because CategoryCard sets no width of its
// own — on the real screen the horizontal strip owns that.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import CategoryCard from './CategoryCard';
import { color, space, type } from '@theme/tokens';

export default function CategoryCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>CategoryCard</Text>

      <Text style={styles.label}>{'accent="primary"'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="eBooks" accent="primary" count={12} onPress={() => {}} />
      </View>

      <Text style={styles.label}>{'accent="navy"'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="Audiobooks" accent="navy" count={5} onPress={() => {}} />
      </View>

      <Text style={styles.label}>{'accent="blueDeep"'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="Journals" accent="blueDeep" count={8} onPress={() => {}} />
      </View>

      <Text style={styles.label}>{'accent="blueBright"'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="Open access" accent="blueBright" count={30} onPress={() => {}} />
      </View>

      <Text style={styles.label}>no accent — falls back to primary</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="eBooks" count={12} onPress={() => {}} />
      </View>

      <Text style={styles.label}>count=0 — a real count, still rendered</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="New releases" accent="primary" count={0} onPress={() => {}} />
      </View>

      <Text style={styles.label}>{'count=1 — reads "1 title", not "1 titles"'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="Featured" accent="navy" count={1} onPress={() => {}} />
      </View>

      <Text style={styles.label}>no count — title only, chevron still right-aligned</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="Browse all" accent="primary" onPress={() => {}} />
      </View>

      <Text style={styles.label}>no onPress — not a button, no chevron</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="eBooks" accent="primary" count={12} />
      </View>

      <Text style={styles.label}>{'state="loading" — skeleton bars, not pressable'}</Text>
      <View style={styles.cardBox}>
        <CategoryCard title="" state="loading" accent="navy" onPress={() => {}} />
      </View>

      <Text style={styles.label}>long title — truncates to one line</Text>
      <View style={styles.cardBox}>
        <CategoryCard
          title="Environmental Policy and Sustainable Development"
          accent="navy"
          count={4}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>the real strip — the full accent cycle in order</Text>
      <View style={styles.strip}>
        <View style={styles.stripCard}>
          <CategoryCard title="eBooks" accent="primary" count={12} onPress={() => {}} />
        </View>
        <View style={styles.stripCard}>
          <CategoryCard title="Audiobooks" accent="navy" count={5} onPress={() => {}} />
        </View>
        <View style={styles.stripCard}>
          <CategoryCard title="Open access" accent="blueBright" count={30} onPress={() => {}} />
        </View>
        <View style={styles.stripCard}>
          <CategoryCard title="Journals" accent="blueDeep" count={8} onPress={() => {}} />
        </View>
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

// The width CatalogueScreen's strip gives each card.
const CARD_WIDTH = space.xl * 5;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  cardBox: {
    width: CARD_WIDTH,
    marginHorizontal: space.md,
  },
  // Mirrors the home screen's horizontal strip. Wraps instead of scrolling so
  // every card stays visible during a review.
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginHorizontal: space.md,
  },
  stripCard: { width: CARD_WIDTH },
  spacer: { height: space.xl },
});
