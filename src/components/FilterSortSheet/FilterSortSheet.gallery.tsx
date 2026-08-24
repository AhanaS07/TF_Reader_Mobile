// Gallery entry — every state of FilterSortSheet from hardcoded props.
// No providers, no navigation, no stores, no adapter. Pure rendering only.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import FilterSortSheet from './FilterSortSheet';
import { color, space, type } from '@theme/tokens';

function TriggerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.trigger} onPress={onPress} accessibilityRole="button">
      <Text style={styles.triggerLabel}>{label}</Text>
    </Pressable>
  );
}

export default function FilterSortSheetGallery() {
  const [openSheet, setOpenSheet] = useState<string | null>(null);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>FilterSortSheet</Text>

      <Text style={styles.label}>no dimension selected, sort enabled (&apos;all&apos; shelf)</Text>
      <TriggerButton label="Open (empty)" onPress={() => setOpenSheet('empty')} />
      <FilterSortSheet
        visible={openSheet === 'empty'}
        onDismiss={() => setOpenSheet(null)}
        onSelectContentType={() => {}}
        onSelectAccessTier={() => {}}
        onSelectSort={() => {}}
        onApply={() => setOpenSheet(null)}
        onClearAll={() => setOpenSheet(null)}
      />

      <Text style={styles.label}>every enabled dimension selected</Text>
      <TriggerButton label="Open (selected)" onPress={() => setOpenSheet('selected')} />
      <FilterSortSheet
        visible={openSheet === 'selected'}
        onDismiss={() => setOpenSheet(null)}
        contentType="AUDIO"
        onSelectContentType={() => {}}
        accessTier="ELITE"
        onSelectAccessTier={() => {}}
        sort="title.asc"
        onSelectSort={() => {}}
        onApply={() => setOpenSheet(null)}
        onClearAll={() => setOpenSheet(null)}
      />

      <Text style={styles.label}>sortDisabled — a curated shelf, where sort is a no-op</Text>
      <TriggerButton label="Open (curated shelf)" onPress={() => setOpenSheet('curated')} />
      <FilterSortSheet
        visible={openSheet === 'curated'}
        onDismiss={() => setOpenSheet(null)}
        contentType="EPUB"
        onSelectContentType={() => {}}
        onSelectAccessTier={() => {}}
        sortDisabled
        onSelectSort={() => {}}
        onApply={() => setOpenSheet(null)}
        onClearAll={() => setOpenSheet(null)}
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
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  trigger: {
    marginHorizontal: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.primary,
    borderRadius: space.xs,
    alignItems: 'center',
  },
  triggerLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.white,
  },
  spacer: { height: space.xl },
});
