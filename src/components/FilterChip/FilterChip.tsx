// src/components/FilterChip/FilterChip.tsx
// One filter dimension in the search and filter surfaces (screens 09 and 12).
//
// DELIBERATELY NOT SubjectChip. The two look alike and the Foundation Spec warns
// they will drift together, so the difference is behavioural and visible: a
// SUBJECT navigates, so it is teal-outlined even at rest; a FILTER refines what
// is already on screen, so it is NEUTRAL at rest and only earns the brand colour
// once it is actually doing something. If you find yourself making an unselected
// FilterChip teal, you have merged the two.
//
// IT REFINES NOTHING ITSELF. The chip reports a press and renders what it is
// told — which dimensions exist, which are on, and how many values each holds all
// belong to the pipeline (CONVENTIONS §3).
//
// Q-12 (resolved): wokay's contract confirms `accessTier` as a real filter
// parameter. Nothing here names a dimension — that decision belongs to the
// caller's list (see `ACCESS_TIER_FILTER_CONFIRMED` in `searchLink.ts`) — which
// is what let the answer land as a change to the caller, not to this file.
import { Pressable, StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, radius, space, type } from '@theme/tokens';

// Comfortably tappable in a horizontally scrolling row without the row eating
// the height a results list needs. Named because CONVENTIONS §5 bans bare
// numbers in a StyleSheet.
const CHIP_HEIGHT = 36;

const REMOVE_ICON_SIZE = 16;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FilterChipProps {
  /** The dimension's name — "Books", "Open access", "Subject". */
  label: string;
  /** Whether this dimension is currently applied. */
  selected?: boolean;
  /**
   * How many values are active inside this dimension, rendered as "Subject · 3".
   * Absent or zero renders the label alone: on a filter, zero selected values and
   * "not selected" are the same fact, so showing "· 0" would state it twice and
   * contradict the chip's own unselected styling.
   */
  count?: number;
  /** The chip was tapped — toggle the dimension. */
  onPress: () => void;
  /**
   * Presence renders the × affordance while selected, for clearing this one
   * dimension without reopening the filter sheet. Absent means the only way off
   * is another `onPress`, which is correct for a single-choice row.
   */
  onRemove?: () => void;
  /**
   * The dimension exists but cannot be applied — no field behind it yet.
   *
   * SHOWN, NOT HIDDEN. Dropping it would make the filter set look complete when
   * it is not, and the reader would never learn the dimension is coming. A
   * greyed control that announces itself as disabled is the honest version.
   */
  disabled?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FilterChip({
  label,
  selected = false,
  count,
  onPress,
  onRemove,
  disabled = false,
}: FilterChipProps) {
  const showCount = selected && count !== undefined && count > 0;
  const showRemove = selected && onRemove !== undefined && !disabled;

  return (
    <Pressable
      testID="filter-chip"
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
      accessibilityRole="button"
      // Announced as a toggle rather than a plain button, so a screen reader
      // says "selected" instead of the sighted-only colour change.
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
    >
      <Text
        testID="filter-chip-label"
        style={[styles.label, selected && styles.labelSelected]}
        numberOfLines={1}
      >
        {showCount ? `${label} · ${count}` : label}
      </Text>

      {showRemove && (
        <Pressable
          testID="filter-chip-remove"
          onPress={onRemove}
          hitSlop={space.sm}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label} filter`}
        >
          <Ionicons name="close" size={REMOVE_ICON_SIZE} color={color.white} />
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  chip: {
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  chipSelected: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  label: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textPrimary,
  },
  labelSelected: {
    color: color.white,
  },
});
