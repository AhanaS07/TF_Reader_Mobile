// src/screens/ReaderPreferencesScreen.LayoutSection.tsx
// The Layout section of the reader preferences screen — Keshav.
//
// A PART, NOT A SHARED COMPONENT (CONVENTIONS §1). One consumer, one file beside
// it. The split is what keeps three people from editing one function body on the
// same day: this file adds one import and one line to the screen.
//
// PROPS IN, CALLBACKS OUT (§3). No store, no hook — the screen owns
// `useReaderPrefs` and hands down the values and the `on<Event>` pair.
//
// TWO PICKERS, ONE SECTION. `flow` and `spread` are two fields on the same
// `LayoutPrefs` object, so they live in one section rather than two. The outer
// `View` carries the section `testID`; each picker is its own inner group with
// its own `SectionHeader`.
//
// THE CAST ON onChange IS SAFE. `FLOW_OPTIONS` and `SPREAD_OPTIONS` are typed
// with `satisfies` against the contract union, so the only ids the `Tabs` will
// ever emit are members of that union. The cast turns a `string` back into the
// typed member — the same pattern ThemeSection uses for `Theme`.
import { StyleSheet, View } from 'react-native';

import { SectionHeader } from '@components/SectionHeader';
import { Tabs } from '@components/Tabs';
import type { LayoutPrefs } from '@/shared/contracts';
import { space } from '@theme/tokens';

import { FLOW_OPTIONS, SPREAD_OPTIONS } from '@/features/personalization/prefsOptions';

export interface LayoutSectionProps {
  layout: LayoutPrefs;
  onSelectFlow: (flow: LayoutPrefs['flow']) => void;
  onSelectSpread: (spread: LayoutPrefs['spread']) => void;
}

export default function LayoutSection({ layout, onSelectFlow, onSelectSpread }: LayoutSectionProps) {
  return (
    <View style={styles.section} testID="layout-section">
      <View style={styles.group}>
        <SectionHeader title="Reading style" />
        <Tabs
          tabs={[...FLOW_OPTIONS]}
          activeId={layout.flow}
          variant="segmented"
          onChange={(id) => onSelectFlow(id as LayoutPrefs['flow'])}
        />
      </View>

      <View style={styles.group}>
        <SectionHeader title="Page view" />
        <Tabs
          tabs={[...SPREAD_OPTIONS]}
          activeId={layout.spread}
          variant="segmented"
          onChange={(id) => onSelectSpread(id as LayoutPrefs['spread'])}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No outer margin — the screen owns where the section sits (§8). `md`, not
  // `sm`: "Reading style" and "Page view" are two distinct pickers, not one
  // control split in two, so they need real separation between them.
  section: {
    gap: space.md,
  },
  group: {
    gap: space.sm,
  },
});
