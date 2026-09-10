// src/components/Tabs/Tabs.tsx
// The tab bar for screen 01 (feed tabs), 04 (detail sections), 09 (search
// scope) and now screen 08 (Library's own filter rail). Three variants:
// `segmented` (one filled pill track), `underline` (a rule under the active
// label) and `pills` (each tab its own standalone pill, no shared track
// background) — added for Library, whose spec explicitly rejected being
// "trapped inside one giant grey container" the way `segmented` reads.
//
// `count` IS OPTIONAL AND REAL DATA ONLY. It renders a small badge on the tab
// — Library's "how many are in Downloads" at a glance — and is plain
// caller-supplied data, same as `label`: this file does not compute it and
// has no opinion on what it means for a tab with no count to omit one.
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
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, elevation, radius, space, type } from '@theme/tokens';

// One tab. `id` for identity, `label` for display, `count` for an optional
// small badge — see the file header on why that is real-data-only.
export interface TabItem {
  // Stable identity. On screen 01 this is `NavLink.shelfId`, so a tab change
  // maps straight to getShelf() without re-parsing a URL.
  id: string;
  label: string;
  count?: number;
}

export type TabsVariant = 'segmented' | 'underline' | 'pills';

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
  const pills = variant === 'pills';
  // Both fill-shaped variants flip the active label onto a filled background,
  // where `underline` never fills anything and keeps the brand-coloured text
  // instead. One flag rather than repeating `segmented || pills` at each style.
  const onFill = segmented || pills;
  const tabShapeStyle = segmented ? styles.tabSegmented : pills ? styles.tabPills : styles.tabUnderline;

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
        pills && styles.trackPills,
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
              tabShapeStyle,
              segmented && active && styles.tabSegmentedActive,
              // `elevation.card`'s own platform-split shadow, only on the active
              // pill — see the file header's "subtle elevation" note.
              // Segmented/underline never lift off the page, so this stays
              // pills-only.
              pills && active && styles.tabPillsActive,
            ]}
          >
            <Text
              testID={`tabs-label-${tab.id}`}
              // Labels are feed data of unknown length; one line and the bar
              // scrolls, rather than a tab growing taller than its neighbours.
              numberOfLines={1}
              style={[
                styles.label,
                pills && !active && styles.labelPillsInactive,
                active && (onFill ? styles.labelSegmentedActive : styles.labelActive),
              ]}
            >
              {tab.label}
            </Text>

            {tab.count !== undefined && (
              <View
                testID={`tabs-count-${tab.id}`}
                style={[styles.count, active && onFill && styles.countActive]}
              >
                <Text style={[styles.countLabel, active && onFill && styles.countLabelActive]}>
                  {tab.count}
                </Text>
              </View>
            )}

            {/* The underline is its own element rather than a bottom border on
                the tab, so it can sit inside the horizontal padding and match
                the label's width instead of the tab's. */}
            {variant === 'underline' && active && (
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
  // `pills`, unlike `trackSegmented`, carries no shared track background —
  // every tab is its own standalone pill (Library's own spec: "rather than
  // being trapped inside one giant grey container"), so the gap is the only
  // thing the track itself contributes.
  trackPills: {
    gap: space.sm,
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
  // Subtle neutral fill, unselected — `surface` rather than `border`'s flat
  // grey, so the pill still reads as part of this app's palette rather than
  // a generic chrome control.
  tabPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
  },
  // Filled brand blue plus a lift off the page — the "polished and
  // intentional" selected state the spec asks for, one step stronger than
  // `tabSegmented`'s flat fill.
  tabPillsActive: {
    backgroundColor: color.primary,
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
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
    // takes white. Shared by `pills` — see `onFill` above.
    color: color.white,
  },
  // `pills`'s own UNSELECTED state is navy, not `label`'s shared grey — the
  // spec's own "dark navy text" for an inactive pill, one shade stronger than
  // `segmented`/`underline`'s muted default. Applied only when `pills &&
  // !active`, so the other two variants keep their existing grey untouched.
  labelPillsInactive: {
    color: color.textPrimary,
  },
  // Small count badge — real data only, see the file header. Tinted against
  // its own tab's current fill rather than one fixed colour, so it reads on
  // both the neutral (unselected) and primary (selected) pill backgrounds.
  count: {
    minWidth: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  countLabel: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  countLabelActive: {
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
