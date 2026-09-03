// src/components/Tabs/Tabs.tsx
// The tab bar for screen 01 (feed tabs), 04 (detail sections) and 09 (search
// scope). Two variants: `segmented` (a filled pill track) and `underline` (a
// teal rule under the active label).
//
// ⚠ TABS ARE DATA, NOT CODE — and this is the whole reason the component exists
// in this shape. Settled 16 Aug 2026 (AGENTS.md L-5): an administrator configures
// the shelves for their institution and names them, so the count, the titles and
// the ids are all theirs and two institutions see different bars. No tab is named
// anywhere in this file, no count is assumed, and the bar renders whatever array
// it is handed, in the order it arrives. Same rule as `NavLink` in
// model/types.ts.
//
// IT HOLDS NO SELECTION STATE. `activeId` comes in, `onChange` goes out, and
// there is no `useState` in this file. §6.4: "onChange must be the only way the
// active tab changes, so the consumer can swap cursors cleanly" — each feed tab
// owns its own pagination cursor and result count (A0), and a bar that moved its
// own highlight would desync from whichever cursor the consumer had loaded.
//
// RE-PRESSING THE ACTIVE TAB IS SWALLOWED, for the same reason: a consumer that
// refetches on every `onChange` would reset that tab's cursor on a stray tap.
//
// An empty tab set renders nothing rather than an empty bar: a stripe of dead
// chrome reads as a broken control, where absence reads as "no tabs here".
//
// It sets no outer margin: the screen owns where the bar sits.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '@theme/tokens';

// One tab. Deliberately minimal — id for identity, label for display, and
// nothing else. A count or a badge would be a second component's job.
export interface TabItem {
  // Stable identity. On screen 01 this is `NavLink.shelfId`, so a tab change
  // maps straight to getShelf() without re-parsing a URL.
  id: string;
  label: string;
}

export type TabsVariant = 'segmented' | 'underline';

export interface TabsProps {
  tabs: TabItem[];
  // Which tab is active. Owned by the caller — see the file header. An id that
  // matches no tab selects nothing rather than falling back to tab zero, so a
  // stale cursor shows as "nothing active" instead of silently lying.
  activeId: string;
  variant?: TabsVariant;
  /**
   * Spread the bar across the full width it is given, instead of letting it end
   * wherever the labels do.
   *
   * OFF BY DEFAULT because the bar's usual job is a tab set of unknown length
   * (see the file header) — a feed configured per institution, where the row
   * scrolls and "full width" is not a thing it can be. Opt in when the tab set
   * is FIXED and the bar is the screen's own filter: left-flush is fine for a
   * strip that plainly continues off-screen, and wrong for a five-segment
   * control, where the leftover space pools on the right and reads as a
   * mis-centred component rather than as room to scroll.
   *
   * THE SLACK GOES BETWEEN THE TABS, NOT INTO THEM. Giving each tab an equal
   * share of the width (`flex: 1`) is the other way to fill a row and it
   * truncates: "Bookmarks" needs about 76pt and a fifth of a small phone's row
   * is nearer 57, so the labels would ellipsise to fit a shape. Distributing the
   * gap keeps every label whole and still reaches both margins.
   *
   * A NO-OP WHEN THE LABELS ALREADY OVERFLOW, which is the behaviour that makes
   * this safe to pass without measuring: `flexGrow` cannot shrink a row that is
   * already wider than its viewport, so the bar falls back to scrolling exactly
   * as it does today.
   */
  fill?: boolean;
  onChange: (id: string) => void;
}

export default function Tabs({
  tabs,
  activeId,
  variant = 'segmented',
  fill = false,
  onChange,
}: TabsProps) {
  // Nothing to render, so no chrome — see the file header.
  if (tabs.length === 0) {
    return null;
  }

  const segmented = variant === 'segmented';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The bar scrolls rather than compressing: a per-institution tab set has
      // no known maximum length, so labels must never be squeezed to fit.
      testID="tabs"
      accessibilityRole="tablist"
      contentContainerStyle={[
        styles.track,
        segmented && styles.trackSegmented,
        fill && styles.trackFill,
      ]}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;

        return (
          <Pressable
            key={tab.id}
            testID={`tabs-tab-${tab.id}`}
            // Swallowed when already active — see the file header.
            onPress={active ? undefined : () => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.tab,
              segmented ? styles.tabSegmented : styles.tabUnderline,
              segmented && active && styles.tabSegmentedActive,
            ]}
          >
            <Text
              testID={`tabs-label-${tab.id}`}
              // Labels are feed data of unknown length; one line and the bar
              // scrolls, rather than a tab growing taller than its neighbours.
              numberOfLines={1}
              style={[
                styles.label,
                active && (segmented ? styles.labelSegmentedActive : styles.labelActive),
              ]}
            >
              {tab.label}
            </Text>

            {/* The underline is its own element rather than a bottom border on
                the tab, so it can sit inside the horizontal padding and match
                the label's width instead of the tab's. */}
            {!segmented && active && (
              <View testID={`tabs-underline-${tab.id}`} style={styles.underline} />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // `flexGrow` on a horizontal ScrollView's content container stretches it to
  // the viewport when the content is narrower, and is ignored when it is wider —
  // which is what makes `fill` degrade back to scrolling on its own. The slack
  // is then spread BETWEEN the tabs, so no label is squeezed. See `fill`.
  trackFill: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  // The segmented variant reads as one control, so the track carries the pill
  // and the segments sit inside it.
  trackSegmented: {
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSegmented: {
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  tabSegmentedActive: {
    backgroundColor: color.primary,
  },
  tabUnderline: {
    paddingHorizontal: space.md,
    // Room for the rule below the label, so the active tab does not grow taller
    // than its inactive neighbours when the underline appears.
    paddingTop: space.sm,
  },
  // `smallLabel`, not `button`: every current caller (Theme, Layout,
  // Typography's presets) is an option label read at a glance, not a button
  // someone reads word-for-word — safe to size down while this component has
  // no other consumer yet (see the file header's planned screens 01/04/09).
  label: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  labelActive: {
    color: color.primary,
  },
  labelSegmentedActive: {
    // On-primary: the active segment is a filled primary pill, so the label
    // takes white.
    color: color.white,
  },
  underline: {
    // Full width of the label above it, which is what makes it read as a rule
    // rather than a dash.
    alignSelf: 'stretch',
    height: space.xs / 2,
    marginTop: space.sm - space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
  },
});
