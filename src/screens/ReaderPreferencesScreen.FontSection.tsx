// src/screens/ReaderPreferencesScreen.FontSection.tsx
// The Font section of the reader preferences screen.
//
// Same shape and same reasoning as the Theme section beside it: a screen-local
// part (CONVENTIONS §1), props in and callbacks out (§3), and `Tabs` in its
// segmented variant rather than a new control (§10). See
// ReaderPreferencesScreen.ThemeSection.tsx for the full note, including the
// logged `tablist`/`tab` role compromise, which applies here identically.
//
// SEVEN OPTIONS IN A CONTROL THAT SCROLLS. `Tabs` is a horizontal ScrollView
// that never compresses its labels — built that way because a per-institution
// tab set has no known maximum length. Seven font names is the same problem, so
// the strip scrolls instead of squeezing "Merriweather" to fit.
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
import { StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@components/SectionHeader';
import { Tabs } from '@components/Tabs';
import { color, space, type as typeScale } from '@theme/tokens';

import { FONT_FAMILY_OPTIONS } from '@/features/personalization/prefsOptions';

export interface FontSectionProps {
  /**
   * The stored family. A plain string because the contract's `FontPrefs.family`
   * is one — it may be a face this picker does not list.
   */
  family: string;
  onSelectFontFamily: (family: string) => void;
}

export default function FontSection({ family, onSelectFontFamily }: FontSectionProps) {
  // More likely to fire than the theme equivalent, and for two reasons rather
  // than one: `family` is an unconstrained string in the contract (whose own
  // example value, 'Georgia', is not in our list), and `customFontUri` lets a
  // reader supply a face from a file. Neither is an error — the reader is using
  // something we do not offer, and the honest response is to say so rather than
  // to highlight the wrong segment or silently overwrite their choice.
  const unmatched = !FONT_FAMILY_OPTIONS.some((option) => option.id === family);

  return (
    // See the same note in ReaderPreferencesScreen.ThemeSection.tsx: both
    // sections render a `Tabs` with a 'system' option, so their testIDs collide
    // and a test scopes to one section with `within()`.
    <View style={styles.section} testID="font-section">
      <SectionHeader title="Font" />
      <Text style={styles.hint}>EPUB only. PDFs use their own embedded fonts.</Text>

      <Tabs
        tabs={[...FONT_FAMILY_OPTIONS]}
        activeId={family}
        variant="segmented"
        onChange={onSelectFontFamily}
      />

      {unmatched && (
        <Text style={styles.note}>
          Your current font, {family}, is not one of these options. Picking one here will replace
          it.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // No outer margin — the screen owns placement (§8).
  section: {
    gap: space.sm,
  },
  hint: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  note: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
});
