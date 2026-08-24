import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { color, space, type } from '@theme/tokens';

function TriggerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.trigger} onPress={onPress} accessibilityRole="button">
      <Text style={styles.triggerLabel}>{label}</Text>
    </Pressable>
  );
}

export default function BottomSheetGallery() {
  const [openSheet, setOpenSheet] = useState<string | null>(null);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>BottomSheet</Text>

      <Text style={styles.label}>dismissible (default, 65% height)</Text>
      <TriggerButton label="Open sheet" onPress={() => setOpenSheet('default')} />
      <BottomSheet
        visible={openSheet === 'default'}
        onDismiss={() => setOpenSheet(null)}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Default sheet</Text>
          <Text style={styles.sheetBody}>Tap the backdrop or swipe down to dismiss.</Text>
        </View>
      </BottomSheet>

      <Text style={styles.label}>tall (70% height)</Text>
      <TriggerButton label="Open tall sheet" onPress={() => setOpenSheet('tall')} />
      <BottomSheet
        visible={openSheet === 'tall'}
        onDismiss={() => setOpenSheet(null)}
        heightRatio={0.7}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Tall sheet (70%)</Text>
          <Text style={styles.sheetBody}>Used for content-heavy sheets like filter panels.</Text>
        </View>
      </BottomSheet>

      <Text style={styles.label}>non-dismissible (Access Gate — must choose)</Text>
      <TriggerButton label="Open access gate" onPress={() => setOpenSheet('nodismiss')} />
      <BottomSheet
        visible={openSheet === 'nodismiss'}
        onDismiss={() => setOpenSheet(null)}
        dismissible={false}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Access Gate</Text>
          <Text style={styles.sheetBody}>
            Backdrop tap and swipe are disabled. User must pick an action.
          </Text>
          <Pressable
            style={styles.closeButton}
            onPress={() => setOpenSheet(null)}
            accessibilityRole="button"
          >
            <Text style={styles.closeLabel}>Close (action button placeholder)</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <Text style={styles.label}>short (60% height)</Text>
      <TriggerButton label="Open short sheet" onPress={() => setOpenSheet('short')} />
      <BottomSheet
        visible={openSheet === 'short'}
        onDismiss={() => setOpenSheet(null)}
        heightRatio={0.6}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Short sheet (60%)</Text>
          <Text style={styles.sheetBody}>Minimum height per Design Spec §2.3.</Text>
        </View>
      </BottomSheet>

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
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.white,
  },
  sheetContent: {
    padding: space.md,
    gap: space.sm,
  },
  sheetTitle: {
    fontWeight: type.sectionHeader.weight,
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  sheetBody: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  closeButton: {
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.border,
    borderRadius: space.xs,
    alignItems: 'center',
  },
  closeLabel: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textPrimary,
  },
  spacer: { height: space.xl },
});
