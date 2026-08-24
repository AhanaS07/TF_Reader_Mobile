// src/components/SubjectChip/SubjectChip.tsx
// The outlined teal pill in screen 01's "Browse by Subject" row and screen 09's
// subject list. One subject, one chip.
//
// DELIBERATELY NOT `FilterChip`. Foundation Spec §6.4: "a subject navigates, a
// filter refines". The two look near-identical and the spec warns they will
// drift together if not reviewed side by side, so this file owns only the
// subject surface — no count badge, no clear affordance, no multi-select
// vocabulary. If a caller wants those, it wants FilterChip.
//
// IT DOES NOT KNOW WHETHER IT IS SELECTED. `selected` arrives as a prop and the
// press is reported straight back out; the row that owns the subject list owns
// which one is active. That is the same props-in / callbacks-out rule that keeps
// SearchInput controlled by its screen.
//
// DISABLED OUTRANKS SELECTED. A teal-filled chip that refuses the press is the
// same dishonesty as a "See all" link that does nothing, so a disabled chip goes
// grey whatever `selected` says.
//
// It sets no outer margin: the row owns the gaps between chips, the same rule
// that keeps ContentCard from setting its own width.
import { Pressable, StyleSheet, Text } from 'react-native';

import { color, radius, space, type } from '@theme/tokens';

export interface SubjectChipProps {
  // The subject as the feed spells it — 'Public Policy', 'Anthropology'. Never
  // mapped through a lookup: subjects are per-institution data, so no subject is
  // named anywhere in this codebase.
  label: string;
  // Whether this subject is the active one. Owned by the caller.
  selected?: boolean;
  // A subject the feed advertises but that cannot be acted on right now.
  disabled?: boolean;
  // Required, unlike CategoryCard's optional `onPress`: a chip has no reason to
  // exist unpressable, and `disabled` already covers the inert case honestly.
  onPress: () => void;
}

export default function SubjectChip({
  label,
  selected = false,
  disabled = false,
  onPress,
}: SubjectChipProps) {
  // Resolved once, so the fill, border and label cannot disagree about which
  // state they are painting.
  const active = selected && !disabled;

  return (
    <Pressable
      testID="subject-chip"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // Selection is announced, not merely coloured: a screen-reader user gets
      // no signal from a teal fill.
      accessibilityState={{ selected, disabled }}
      style={[
        styles.chip,
        active && styles.chipSelected,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text
        testID="subject-chip-label"
        // A pill that wraps stops being a pill — the row scrolls instead.
        numberOfLines={1}
        style={[
          styles.label,
          active && styles.labelSelected,
          disabled && styles.labelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// The chip hugs its label, so a subject row of mixed-length subjects reads as
// pills of mixed width rather than a grid.
const styles = StyleSheet.create({
  chip: {
    // Sized by its content — see above.
    alignSelf: 'flex-start',
    // Vertical padding is deliberately tighter than horizontal: a pill's height
    // comes off the type scale, its width off the label.
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.primary,
    // Outlined, not filled — the unselected chip sits on whatever surface the
    // screen provides rather than painting its own.
    backgroundColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: color.primary,
  },
  chipDisabled: {
    // Grey, not dimmed teal: a faded brand colour still reads as available.
    borderColor: color.border,
    backgroundColor: 'transparent',
  },
  label: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.primary,
    textAlign: 'center',
  },
  labelSelected: {
    // On-primary: the label sits on a filled primary chip, so it takes white.
    color: color.white,
  },
  labelDisabled: {
    color: color.textSecondary,
  },
});
