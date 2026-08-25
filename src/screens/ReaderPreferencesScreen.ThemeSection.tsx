// src/screens/ReaderPreferencesScreen.ThemeSection.tsx
// The Theme section of the reader preferences screen.
//
// A PART, NOT A SHARED COMPONENT. It sits beside its only consumer and is not
// exported from any barrel — CONVENTIONS §1's `ComponentName.Row.tsx` rule. It
// is a section of one screen, so promoting it to `src/components/` would be the
// speculative component §10 rules out.
//
// The file split is what keeps three people out of one function body: Keshav's
// Layout section and Prayas's Typography section each land as their own file and
// add one import and one line to the screen, rather than editing this one.
//
// PROPS IN, CALLBACKS OUT (§3). It reads no store and calls no hook — the screen
// owns `useReaderPrefs` and hands down a value and an `on<Event>`.
//
// `Tabs`, NOT A NEW CONTROL. The segmented variant is the repo's existing
// controlled selected/unselected control: `activeId` in, `onChange` out, no
// internal state, and it swallows a press on the already-active segment, which
// is exactly right here — re-picking the current theme should not spend a write.
// It is also the control Keshav's Layout section uses for its two pickers, so
// the screen reads as one screen.
//
// ONE KNOWN COMPROMISE, LOGGED RATHER THAN HIDDEN: `Tabs` announces itself as
// `tablist`/`tab`. A theme picker is closer to a radio group, so a screen reader
// is told these switch views when they set a value. It does still announce the
// selected segment via `accessibilityState`, which is the part that matters
// most, and the alternative was a new `radio` variant on Keshav's `ListRow` in
// the same week he is building two stores. Raised for the accessibility pass
// rather than fixed by forking a component.
import { StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@components/SectionHeader';
import { Tabs } from '@components/Tabs';
import type { Theme } from '@/shared/contracts';
import { color, space, type as typeScale } from '@theme/tokens';

import { THEME_OPTIONS } from '@/features/personalization/prefsOptions';

export interface ThemeSectionProps {
  /** The stored value. May be one this section does not offer — see below. */
  theme: Theme;
  onSelectTheme: (theme: Theme) => void;
}

export default function ThemeSection({ theme, onSelectTheme }: ThemeSectionProps) {
  // `highContrast` is a real member of the contract's `Theme` union that this
  // section deliberately does not offer (see prefsOptions.ts), and prefs sync
  // LWW across devices, so the stored value can be one with no segment here.
  //
  // `Tabs` already handles that correctly by rendering nothing active. What it
  // cannot do is explain itself, and a picker with no selection reads as broken
  // rather than as "your current setting lives somewhere else" — so the note
  // below says it. Absent in every normal case.
  const unmatched = !THEME_OPTIONS.some((option) => option.id === theme);

  return (
    // `Tabs` hardcodes its own testIDs (`tabs`, `tabs-tab-<id>`) with no prefix,
    // and this screen renders two of them — both of which have a 'system'
    // option, so those ids collide. A testID here lets a test scope its queries
    // to one section with `within()`, which is the fix that does not involve
    // adding a prefix prop to a shared component for one screen's convenience.
    <View style={styles.section} testID="theme-section">
      <SectionHeader title="Theme" />

      <Tabs
        tabs={[...THEME_OPTIONS]}
        activeId={theme}
        variant="segmented"
        onChange={(id) => onSelectTheme(id as Theme)}
      />

      {unmatched && (
        <Text style={styles.note}>
          Your current theme was set elsewhere and is not one of these options.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // No outer margin — the screen owns where the section sits (§8). The gap is
  // internal spacing between the header and its control.
  section: {
    gap: space.sm,
  },
  note: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
});
