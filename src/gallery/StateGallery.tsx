// K5 — the review surface. One section visible at a time, from static props only.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import BottomSheetGallery from '@/components/BottomSheet/BottomSheet.gallery';
import BottomTabBarGallery from '@/components/BottomTabBar/BottomTabBar.gallery';
import SkeletonGallery from '@/components/Skeleton/Skeleton.gallery';
import TopAppBarGallery from '@/components/TopAppBar/TopAppBar.gallery';
import { color, radius, space, type } from '@theme/tokens';

const SECTIONS = ['Skeleton', 'TopAppBar', 'BottomTabBar', 'BottomSheet'] as const;

type Section = (typeof SECTIONS)[number];

export default function StateGallery() {
  const [section, setSection] = useState<Section>('Skeleton');

  return (
    <View style={styles.page}>
      <View style={styles.switcher}>
        {SECTIONS.map((name) => {
          const selected = name === section;
          return (
            <Pressable
              key={name}
              onPress={() => setSection(name)}
              style={[styles.tab, selected && styles.tabSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* SkeletonGallery has no ScrollView of its own; the other two supply theirs. */}
      {section === 'Skeleton' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>Skeleton</Text>
          <SkeletonGallery />
        </ScrollView>
      )}
      {section === 'TopAppBar' && <TopAppBarGallery />}
      {section === 'BottomTabBar' && <BottomTabBarGallery />}
      {section === 'BottomSheet' && <BottomSheetGallery />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.surface,
  },
  switcher: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  tab: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
  },
  tabSelected: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  tabLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textSecondary,
  },
  tabLabelSelected: {
    color: color.surface,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: space.xl,
  },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
});
