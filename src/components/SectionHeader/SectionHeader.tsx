// src/components/SectionHeader/SectionHeader.tsx
// The heading that opens a section: "Featured", "Browse by Subject" and
// "Recently Published" on screen 01, "Recently used" / "All Institutions" on
// 06, and the result groups on 09.
//
// THE TITLE WRAPS, THE ACTION STAYS PUT. The Foundation Spec's done-when clause
// for this component is "a long title wraps rather than pushing the action
// off-screen", so that is the one behaviour the layout exists to guarantee: the
// title takes the row's spare width and wraps inside it, while the action holds
// its intrinsic width against the right edge.
//
// THE ACTION NEEDS BOTH PROPS, NOT JUST A LABEL. An `actionLabel` with no
// `onAction` would render teal text that looks tappable and does nothing —
// the same dishonesty CategoryCard avoids by withholding its chevron when it
// has no `onPress`. Either both arrive, or no action is drawn.
//
// It sets no outer margin or padding: the parent owns where the header sits,
// the same rule that keeps CategoryCard from setting its own width.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

export interface SectionHeaderProps {
  // The section's own label, rendered verbatim — a shelf title off the feed
  // ("New this term") or a screen's fixed heading ("Browse by Subject").
  // Never mapped through a lookup keyed by section.
  title: string;
  // Trailing action, "See all" in the design package. Absent on every section
  // of screen 01; the with_action variant belongs to screens 06 and 09.
  actionLabel?: string;
  onAction?: () => void;
}

export default function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  // Both, or neither — see the header.
  const showAction = actionLabel !== undefined && onAction !== undefined;

  return (
    <View testID="section-header" style={styles.header}>
      <Text
        testID="section-header-title"
        style={styles.title}
        // Announced as a heading so a screen reader can jump section to section
        // instead of reading the whole feed linearly.
        accessibilityRole="header"
      >
        {title}
      </Text>

      {showAction && (
        <Pressable
          testID="section-header-action"
          style={styles.actionSlot}
          onPress={onAction}
          accessibilityRole="button"
          // Carries the section name: "See all" on its own tells a screen-reader
          // user which words are on screen but not which shelf they open.
          accessibilityLabel={`${actionLabel} ${title}`}
          // Grows the touch target without padding the text, which would pull
          // the label in from the row's right edge.
          hitSlop={space.sm}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    // The two type styles have different line heights, so align on the box
    // rather than the baseline: the action centres against the title block.
    alignItems: 'center',
    gap: space.md,
  },
  title: {
    // Takes the spare width, which both pushes the action to the far edge and
    // makes a long title wrap inside the row instead of overflowing it.
    flex: 1,
    fontWeight: type.sectionHeader.weight,
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  // Explicitly refuses to shrink, so the action keeps its full label however
  // long the title runs. This is the done-when clause, stated in one property.
  actionSlot: {
    flexShrink: 0,
  },
  action: {
    // The token meant for tappable text; the spec fixes the colour here and
    // leaves the size unstated.
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
