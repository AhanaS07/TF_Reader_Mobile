// Gallery entry — every state of FilterChip from hardcoded props.
// No providers, no navigation, no stores, no pipeline. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import FilterChip from './FilterChip';
import { color, space, type } from '@theme/tokens';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

export default function FilterChipGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>FilterChip</Text>

      <Row label="unselected — neutral at rest, NOT teal (that is SubjectChip)">
        <FilterChip label="Books" onPress={() => {}} />
        <FilterChip label="Audio" onPress={() => {}} />
      </Row>

      <Row label="selected">
        <FilterChip label="Books" selected onPress={() => {}} />
      </Row>

      <Row label="selected_with_count">
        <FilterChip label="Subject" selected count={3} onPress={() => {}} />
      </Row>

      <Row label="count of 0 — label alone; unselected styling already says it">
        <FilterChip label="Subject" selected count={0} onPress={() => {}} />
      </Row>

      <Row label="count while unselected — ignored, a filter off has no values">
        <FilterChip label="Subject" count={3} onPress={() => {}} />
      </Row>

      <Row label="removable — × appears only once selected">
        <FilterChip label="Books" selected onPress={() => {}} onRemove={() => {}} />
        <FilterChip label="Audio" onPress={() => {}} onRemove={() => {}} />
      </Row>

      <Row label="removable with a count">
        <FilterChip label="Subject" selected count={12} onPress={() => {}} onRemove={() => {}} />
      </Row>

      <Row label="a realistic row — one dimension on, the rest off">
        <FilterChip label="All" selected onPress={() => {}} />
        <FilterChip label="PDF" onPress={() => {}} />
        <FilterChip label="EPUB" onPress={() => {}} />
        <FilterChip label="Audio" onPress={() => {}} />
      </Row>

      <Row label="overflow — a long dimension name truncates rather than wrapping">
        <FilterChip
          label="Environmental science and sustainable development"
          selected
          count={4}
          onPress={() => {}}
          onRemove={() => {}}
        />
      </Row>

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
  row: {
    marginHorizontal: space.md,
    marginBottom: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginBottom: space.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  spacer: { height: space.xl },
});
