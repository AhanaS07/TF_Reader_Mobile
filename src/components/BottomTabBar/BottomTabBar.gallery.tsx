// Gallery entry — every state of BottomTabBar from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import BottomTabBar from './BottomTabBar';
import type { TabItem } from './BottomTabBar';
import { color, space, type } from '@theme/tokens';

const TABS: TabItem[] = [
  { key: 'Catalogue', label: 'Catalogue', iconActive: 'book', iconInactive: 'book-outline' },
  { key: 'Search', label: 'Search', iconActive: 'search', iconInactive: 'search-outline' },
  { key: 'Library', label: 'Library', iconActive: 'library', iconInactive: 'library-outline' },
  { key: 'Profile', label: 'Profile', iconActive: 'person', iconInactive: 'person-outline' },
];

const TABS_WITH_BADGE: TabItem[] = TABS.map((t) =>
  t.key === 'Library' ? { ...t, badge: true } : t,
);

export default function BottomTabBarGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>BottomTabBar</Text>

      <Text style={styles.label}>Catalogue active (default home state)</Text>
      <BottomTabBar tabs={TABS} activeKey="Catalogue" onTabPress={() => {}} />

      <Text style={styles.label}>Search active</Text>
      <BottomTabBar tabs={TABS} activeKey="Search" onTabPress={() => {}} />

      <Text style={styles.label}>Library active</Text>
      <BottomTabBar tabs={TABS} activeKey="Library" onTabPress={() => {}} />

      <Text style={styles.label}>Profile active</Text>
      <BottomTabBar tabs={TABS} activeKey="Profile" onTabPress={() => {}} />

      <Text style={styles.label}>Library active + badge dot</Text>
      <BottomTabBar
        tabs={TABS_WITH_BADGE}
        activeKey="Library"
        onTabPress={() => {}}
      />

      <Text style={styles.label}>Catalogue active + badge dot (Library)</Text>
      <BottomTabBar
        tabs={TABS_WITH_BADGE}
        activeKey="Catalogue"
        onTabPress={() => {}}
      />

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
  spacer: { height: space.xl },
});
