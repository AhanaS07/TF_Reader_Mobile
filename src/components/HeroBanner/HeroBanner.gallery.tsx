// Gallery entry — every state of HeroBanner from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import HeroBanner from './HeroBanner';
import { color, space, type } from '@theme/tokens';

export default function HeroBannerGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>HeroBanner</Text>

      <Text style={styles.label}>the real CatalogueScreen shape — stat, action and updated note</Text>
      <View style={styles.demo}>
        <HeroBanner
          statLabel="Over 140,000 peer-reviewed titles"
          title="The Scholarly Archive"
          subtitle="Full-text access to world-leading research monographs, handbooks, and journal volumes."
          actionLabel="Explore All Titles"
          onPressAction={() => {}}
          updatedLabel="Updated daily"
        />
      </View>

      <Text style={styles.label}>no stat, no subtitle, no footer</Text>
      <View style={styles.demo}>
        <HeroBanner title="Your Scholarly Collection" />
      </View>

      <Text style={styles.label}>long title — wraps rather than overflowing the gradient</Text>
      <View style={styles.demo}>
        <HeroBanner
          title="Your Institution's Complete Scholarly Collection"
          subtitle="1 curated collection to explore"
        />
      </View>

      <Text style={styles.label}>{'action button only — no "updated" note'}</Text>
      <View style={styles.demo}>
        <HeroBanner
          title="Your Scholarly Collection"
          actionLabel="Explore All Titles"
          onPressAction={() => {}}
        />
      </View>

      <Text style={styles.label}>{'"updated" note only — actionLabel with no onPressAction never renders a button'}</Text>
      <View style={styles.demo}>
        <HeroBanner
          title="Your Scholarly Collection"
          actionLabel="Explore All Titles"
          updatedLabel="Updated daily"
        />
      </View>

      <Text style={styles.label}>{'state="loading" — skeleton bars, no text announced'}</Text>
      <View style={styles.demo}>
        <HeroBanner
          statLabel="Over 140,000 peer-reviewed titles"
          title=""
          actionLabel="Explore All Titles"
          onPressAction={() => {}}
          updatedLabel="Updated daily"
          state="loading"
        />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

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
  demo: { marginHorizontal: space.md },
  spacer: { height: space.xl },
});
