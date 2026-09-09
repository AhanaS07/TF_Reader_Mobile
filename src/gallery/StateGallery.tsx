// K5 — the review surface. One section visible at a time, from static props only.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ResolveAccessGallery from '@/access/resolveAccess.gallery';
import AccessTierBadgeGallery from '@/components/AccessTierBadge/AccessTierBadge.gallery';
import ActionBarGallery from '@/components/ActionBar/ActionBar.gallery';
import ActionButtonGallery from '@/components/ActionButton/ActionButton.gallery';
import AuthMethodCardGallery from '@/components/AuthMethodCard/AuthMethodCard.gallery';
import BottomSheetGallery from '@/components/BottomSheet/BottomSheet.gallery';
import BottomTabBarGallery from '@/components/BottomTabBar/BottomTabBar.gallery';
import CategoryCardGallery from '@/components/CategoryCard/CategoryCard.gallery';
import ContentCardGallery from '@/components/ContentCard/ContentCard.gallery';
import EmptyStateGallery from '@/components/EmptyState/EmptyState.gallery';
import ErrorStateGallery from '@/components/ErrorState/ErrorState.gallery';
import FilterChipGallery from '@/components/FilterChip/FilterChip.gallery';
import FilterSortSheetGallery from '@/components/FilterSortSheet/FilterSortSheet.gallery';
import InstitutionDetailViewGallery from '@/components/InstitutionDetailView/InstitutionDetailView.gallery';
import InstitutionRowGallery from '@/components/InstitutionRow/InstitutionRow.gallery';
import ListRowGallery from '@/components/ListRow/ListRow.gallery';
import OfflineBannerGallery from '@/components/OfflineBanner/OfflineBanner.gallery';
import PrimaryButtonGallery from '@/components/PrimaryButton/PrimaryButton.gallery';
import QueueNotificationGallery from '@/components/QueueNotification/QueueNotification.gallery';
import SearchInputGallery from '@/components/SearchInput/SearchInput.gallery';
import SectionHeaderGallery from '@/components/SectionHeader/SectionHeader.gallery';
import SkeletonGallery from '@/components/Skeleton/Skeleton.gallery';
import SubjectChipGallery from '@/components/SubjectChip/SubjectChip.gallery';
import TabsGallery from '@/components/Tabs/Tabs.gallery';
import TextFieldGallery from '@/components/TextField/TextField.gallery';
import TopAppBarGallery from '@/components/TopAppBar/TopAppBar.gallery';
import VoiceOverlayGallery from '@/components/VoiceOverlay/VoiceOverlay.gallery';
import { color, radius, space, type } from '@theme/tokens';

const SECTIONS = [
  'Skeleton',
  'TopAppBar',
  'BottomTabBar',
  'BottomSheet',
  'OfflineBanner',
  'EmptyState',
  'ErrorState',
  'SearchInput',
  'AccessTierBadge',
  'FilterChip',
  'FilterSortSheet',
  'InstitutionRow',
  'ListRow',
  'SectionHeader',
  'VoiceOverlay',
  'InstitutionDetailView',
  'ActionButton',
  'ActionBar',
  // Not a component. It is here because the access RULES are the thing most worth
  // reviewing by eye, and the only surface that shows them resolving.
  'resolveAccess',
  'CategoryCard',
  'ContentCard',
  'SubjectChip',
  'Tabs',
  'QueueNotification',
  // The sign-in flow's three: a form field, a non-access button, and the method
  // card the access gate and Profile both draw.
  'TextField',
  'PrimaryButton',
  'AuthMethodCard',
] as const;

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

      {/* SkeletonGallery has no ScrollView of its own; every other entry supplies theirs. */}
      {section === 'Skeleton' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>Skeleton</Text>
          <SkeletonGallery />
        </ScrollView>
      )}
      {section === 'TopAppBar' && <TopAppBarGallery />}
      {section === 'BottomTabBar' && <BottomTabBarGallery />}
      {section === 'BottomSheet' && <BottomSheetGallery />}
      {section === 'OfflineBanner' && <OfflineBannerGallery />}
      {section === 'EmptyState' && <EmptyStateGallery />}
      {section === 'ErrorState' && <ErrorStateGallery />}
      {section === 'SearchInput' && <SearchInputGallery />}
      {section === 'AccessTierBadge' && <AccessTierBadgeGallery />}
      {section === 'FilterChip' && <FilterChipGallery />}
      {section === 'FilterSortSheet' && <FilterSortSheetGallery />}
      {section === 'InstitutionRow' && <InstitutionRowGallery />}
      {section === 'ListRow' && <ListRowGallery />}
      {section === 'SectionHeader' && <SectionHeaderGallery />}
      {section === 'VoiceOverlay' && <VoiceOverlayGallery />}
      {section === 'InstitutionDetailView' && <InstitutionDetailViewGallery />}
      {section === 'ActionButton' && <ActionButtonGallery />}
      {section === 'ActionBar' && <ActionBarGallery />}
      {section === 'resolveAccess' && <ResolveAccessGallery />}
      {section === 'CategoryCard' && <CategoryCardGallery />}
      {section === 'ContentCard' && <ContentCardGallery />}
      {section === 'SubjectChip' && <SubjectChipGallery />}
      {section === 'Tabs' && <TabsGallery />}
      {section === 'QueueNotification' && <QueueNotificationGallery />}
      {section === 'TextField' && <TextFieldGallery />}
      {section === 'PrimaryButton' && <PrimaryButtonGallery />}
      {section === 'AuthMethodCard' && <AuthMethodCardGallery />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.white,
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
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textSecondary,
  },
  tabLabelSelected: {
    color: color.white,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: space.xl,
  },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
});
