// One way to sign in, as one tappable card: an icon, a title, a subtitle, a chevron.
//
// Extracted from AccessGateScreen so the access gate and the Profile sign-in screen
// cannot drift into looking like two different products. Both offer the same two
// choices, so both draw them with the same component (CONVENTIONS §7 — a second
// screen-local copy is the thing this replaces).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, radius, space, type } from '@theme/tokens';

const ICON_SIZE = 28;
const CHEVRON_SIZE = 20;

export interface AuthMethodCardProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress?: () => void;
  /**
   * The card exists but cannot be actioned — offline, or no destination yet.
   * Shown greyed rather than hidden, so the reader learns the option exists.
   */
  disabled?: boolean;
  testID: string;
}

export default function AuthMethodCard({
  icon,
  title,
  subtitle,
  onPress,
  disabled = false,
  testID,
}: AuthMethodCardProps) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled }}
      style={[styles.card, disabled && styles.cardDisabled]}
    >
      <Ionicons
        name={icon}
        size={ICON_SIZE}
        color={disabled ? color.textSecondary : color.primary}
      />
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        testID={`${testID}-chevron`}
        name="chevron-forward"
        size={CHEVRON_SIZE}
        color={color.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
  },
  cardDisabled: {
    opacity: 0.4,
  },
  cardText: {
    flex: 1,
    gap: space.xs / 2,
  },
  cardTitle: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  cardSubtitle: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
