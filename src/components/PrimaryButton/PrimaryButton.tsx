// A button for actions that are not access actions — form submits and flow steps.
//
// ActionButton is keyed on the `ActionId` contract, so its label comes from that
// table and nothing else. "Create account" is not an access action and will never
// be in that union, which is exactly why it cannot render one. Same geometry and
// colours as ActionButton on purpose, so the two never look like two design systems.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, radius, space, type } from '@theme/tokens';

// Matches ActionButton's own height — both now read the same token.
const HEIGHT = space.xl + space.md;

// A second, smaller size for a button standing in a place a chip would
// otherwise go — a header prompt, not a form's main action. 36 is not invented:
// it is FilterChip's own chip height, "comfortably tappable... without eating
// the row".
const COMPACT_HEIGHT = 36;

export type PrimaryButtonEmphasis = 'filled' | 'outlined' | 'quiet';
export type PrimaryButtonSize = 'default' | 'compact';

export interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  emphasis?: PrimaryButtonEmphasis;
  size?: PrimaryButtonSize;
  /** Keeps the label and adds a spinner, so the button does not change width. */
  loading?: boolean;
  /** Separate from `loading`: a button can be disabled while idle. */
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  testID: string;
}

export default function PrimaryButton({
  label,
  onPress,
  emphasis = 'filled',
  size = 'default',
  loading = false,
  disabled = false,
  icon,
  testID,
}: PrimaryButtonProps) {
  // `disabled` on the Pressable, not just a withheld onPress: clearing the
  // handler alone leaves the responder live, so the button still reacts to
  // touches and a test firing a press still reaches it.
  const inert = disabled || loading;
  const tint = emphasis === 'filled' ? color.white : color.primary;

  return (
    <Pressable
      testID={testID}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      // `busy` is what stops a screen reader announcing the button as actionable
      // while the request is in flight.
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[
        styles.base,
        size === 'compact' && styles.compact,
        styles[emphasis],
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {icon !== undefined && <Ionicons name={icon} size={type.button.size} color={tint} />}
        <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {loading && (
          <ActivityIndicator testID={`${testID}-spinner`} size="small" color={tint} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // Explicit, not left to the cross-axis stretch default: two of these side
    // by side in equal-width wrappers (ProfileScreen's Sign in / Create
    // account) must render the same width regardless of label length, and a
    // stated `100%` cannot be shadowed by a Pressable's own content sizing the
    // way an implicit default can.
    width: '100%',
    minHeight: HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    // Transparent rather than absent, so every emphasis branch overrides a known
    // starting point.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Applied after `base` so it wins on `minHeight` — same override order the
  // emphasis and disabled branches already use.
  compact: {
    minHeight: COMPACT_HEIGHT,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  filled: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  outlined: {
    borderColor: color.primary,
  },
  // No border and no fill: coloured text and an icon.
  quiet: {},
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    textAlign: 'center',
  },
});
