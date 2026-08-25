// src/screens/ReaderPreferencesScreen.FontSection.tsx
// The Font section of the reader preferences screen.
//
// Same shape and same reasoning as the Theme section beside it: a screen-local
// part (CONVENTIONS §1), props in and callbacks out (§3). See
// ReaderPreferencesScreen.ThemeSection.tsx for the full note, including the
// logged `tablist`/`tab` role compromise — Theme still uses `Tabs`, so that
// compromise still applies there, just not here any more (see below).
//
// A DROPDOWN, NOT `Tabs`. Seven font names, several of them long
// ("Merriweather"), do not fit a row of segments — scrolling sideways or
// wrapping into a grid both make picking one a scan across the whole control.
// The one-tap-then-choose-from-a-list shape below is the same one the app
// already uses for a single value out of many options: `CatalogueScreen`'s own
// institution picker opens a full list the same way. Here the list is short
// enough to live in a `BottomSheet` instead of pushing a new screen.
//
// LABELLED EPUB ONLY, AND THE LABEL IS NOT DECORATION. The font choice reaches
// epub.js through the reader; a PDF renders its own embedded faces and ignores
// it entirely. Saying so on the section is the difference between a setting that
// looks broken on a PDF and one the reader understands does not apply.
//
// NO FACE IS PREVIEWED IN ITSELF. CONVENTIONS §5 forbids setting `fontFamily`
// here, and none of the six named faces is installed in this app — these are
// labels naming a choice t4targaryen's reader applies to book content, not
// styling for our own chrome.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { BottomSheet } from '@components/BottomSheet';
import { SectionHeader } from '@components/SectionHeader';
import { color, space, type as typeScale } from '@theme/tokens';

import { FONT_FAMILY_OPTIONS } from '@/features/personalization/prefsOptions';

// Seven short rows plus the sheet's own handle and title fit comfortably below
// half the screen — no need for Design Spec §2.3's fuller 60–70% band, which
// is sized for FilterSortSheet's much longer content.
const SHEET_HEIGHT_RATIO = 0.5;

export interface FontSectionProps {
  /**
   * The stored family. A plain string because the contract's `FontPrefs.family`
   * is one — it may be a face this picker does not list.
   */
  family: string;
  onSelectFontFamily: (family: string) => void;
}

export default function FontSection({ family, onSelectFontFamily }: FontSectionProps) {
  // Local to this part, and purely presentational — whether the sheet is open
  // is not reading state, so it does not belong in `useReaderPrefs` alongside
  // `family` itself.
  const [pickerOpen, setPickerOpen] = useState(false);

  // More likely to fire than the theme equivalent, and for two reasons rather
  // than one: `family` is an unconstrained string in the contract (whose own
  // example value, 'Georgia', is not in our list), and `customFontUri` lets a
  // reader supply a face from a file. Neither is an error — the reader is using
  // something we do not offer, and the honest response is to say so rather than
  // to highlight the wrong segment or silently overwrite their choice.
  const selected = FONT_FAMILY_OPTIONS.find((option) => option.id === family);
  const unmatched = selected === undefined;

  function selectFont(id: string) {
    onSelectFontFamily(id);
    setPickerOpen(false);
  }

  return (
    <View style={styles.section} testID="font-section">
      <SectionHeader title="Font" />
      <Text style={styles.hint}>EPUB only. PDFs use their own embedded fonts.</Text>

      <Pressable
        testID="font-picker-trigger"
        style={styles.trigger}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Font: ${selected?.label ?? family}`}
      >
        <Text style={styles.triggerValue} numberOfLines={1}>
          {selected?.label ?? family}
        </Text>
        <Ionicons name="chevron-down" size={20} color={color.textSecondary} />
      </Pressable>

      {unmatched && (
        <Text style={styles.note}>
          Your current font, {family}, is not one of these options. Picking one here will replace
          it.
        </Text>
      )}

      <BottomSheet
        visible={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        heightRatio={SHEET_HEIGHT_RATIO}
      >
        <View style={styles.sheet} testID="font-picker-sheet">
          <Text style={styles.sheetTitle}>Font</Text>
          <ScrollView>
            {FONT_FAMILY_OPTIONS.map((option) => {
              const active = option.id === family;
              return (
                <Pressable
                  key={option.id}
                  testID={`font-option-${option.id}`}
                  style={styles.option}
                  onPress={() => selectFont(option.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                >
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                    {option.label}
                  </Text>
                  {active && <Ionicons name="checkmark" size={20} color={color.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // No outer margin — the screen owns placement (§8).
  section: {
    gap: space.sm,
  },
  hint: {
    fontWeight: typeScale.smallLabel.weight,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  // Same shape as CatalogueScreen's own institution picker row — a bordered
  // field naming the current value, tapped to change it.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.white,
    borderRadius: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  triggerValue: {
    flex: 1,
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  note: {
    fontWeight: typeScale.smallLabel.weight,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  sheet: {
    flex: 1,
    paddingHorizontal: space.md,
  },
  sheetTitle: {
    fontWeight: typeScale.pageTitle.weight,
    fontFamily: typeScale.pageTitle.fontFamily,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
    marginBottom: space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  optionLabel: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textPrimary,
  },
  optionLabelActive: {
    fontWeight: typeScale.button.weight,
    color: color.primary,
  },
});
