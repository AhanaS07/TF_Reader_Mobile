// Gallery entry — every state of Tabs from hardcoded props.
// No providers, no navigation, no stores.
//
// Tabs holds no selection state of its own, so most rows pass a fixed `activeId`.
// The last row adds a local useState purely so a reviewer can tap through and
// confirm the bar reports changes rather than moving its own highlight.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Tabs from './Tabs';
import { color, space, type } from '@theme/tokens';

// Sample data only, and one institution's at that. Tabs never names a tab
// itself — it renders whatever it is handed, because an administrator picks the
// shelves and their names (AGENTS.md L-5, settled 16 Aug 2026).
const FEED_TABS = [
  { id: 'ebooks', label: 'eBooks' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'open-access', label: 'Open access' },
];

const TWO_TABS = [
  { id: 'about', label: 'About' },
  { id: 'contents', label: 'Contents' },
];

const LONG_TABS = [
  { id: 'a', label: 'Environmental Science' },
  { id: 'b', label: 'Sustainable Development' },
  { id: 'c', label: 'Public Policy and Governance' },
  { id: 'd', label: 'Anthropology' },
];

export default function TabsGallery() {
  // Only for the interactive row at the bottom.
  const [activeId, setActiveId] = useState('ebooks');

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Tabs</Text>

      <Text style={styles.label}>segmented — first tab active (default variant)</Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="ebooks" onChange={() => {}} />
      </View>

      <Text style={styles.label}>segmented — middle tab active</Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="audiobooks" onChange={() => {}} />
      </View>

      <Text style={styles.label}>segmented — last tab active</Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="open-access" onChange={() => {}} />
      </View>

      <Text style={styles.label}>underline — first tab active</Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="ebooks" variant="underline" onChange={() => {}} />
      </View>

      <Text style={styles.label}>underline — middle tab active</Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="audiobooks" variant="underline" onChange={() => {}} />
      </View>

      <Text style={styles.label}>two tabs — screen 04&apos;s detail sections</Text>
      <View style={styles.row}>
        <Tabs tabs={TWO_TABS} activeId="about" variant="underline" onChange={() => {}} />
      </View>

      <Text style={styles.label}>one tab — renders as a single segment</Text>
      <View style={styles.row}>
        <Tabs tabs={[{ id: 'all', label: 'All' }]} activeId="all" onChange={() => {}} />
      </View>

      <Text style={styles.label}>
        activeId matches no tab — nothing active, no fallback to tab zero
      </Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId="stale-cursor" onChange={() => {}} />
      </View>

      <Text style={styles.label}>empty tab set — renders nothing, not an empty bar</Text>
      <View style={[styles.row, styles.emptyFrame]}>
        <Tabs tabs={[]} activeId="" onChange={() => {}} />
      </View>

      <Text style={styles.label}>long labels — the bar scrolls, labels never squeeze</Text>
      <View style={styles.row}>
        <Tabs tabs={LONG_TABS} activeId="a" onChange={() => {}} />
      </View>

      <Text style={styles.label}>long labels, underline variant</Text>
      <View style={styles.row}>
        <Tabs tabs={LONG_TABS} activeId="b" variant="underline" onChange={() => {}} />
      </View>

      <Text style={styles.label}>
        interactive — tap to change. Re-tapping the active tab reports nothing.
      </Text>
      <View style={styles.row}>
        <Tabs tabs={FEED_TABS} activeId={activeId} onChange={setActiveId} />
      </View>
      <Text style={styles.readout}>activeId: {activeId}</Text>

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
  // The screen owns where the bar sits — Tabs sets no outer margin.
  row: { marginHorizontal: space.md },
  // Marks out the space an empty bar would have taken, so "renders nothing" is
  // visibly nothing rather than an ambiguous gap.
  emptyFrame: {
    height: space.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
  },
  readout: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textPrimary,
    marginHorizontal: space.md,
    marginTop: space.xs,
  },
  spacer: { height: space.xl },
});
