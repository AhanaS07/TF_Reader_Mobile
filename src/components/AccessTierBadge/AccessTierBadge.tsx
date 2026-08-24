import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AccessTier } from '@model/types';
import { color, radius, space, type } from '@theme/tokens';

/**
 * Pill-shaped access-tier indicator.
 *
 * Takes a resolved tier and computes nothing 
 * The tier is derived in the adapter from the acquisition link's licenceModel, never here.
 *
 * No loading, empty, error or offline state: this renders one resolved value,
 * so it has nothing to wait for, nothing to fail at and nothing to degrade.
 */
export interface AccessTierBadgeProps {
  tier: AccessTier;
  size?: 'sm' | 'md';
}

/** One table, so a new tier is a single compile error rather than three gaps. */
const TIERS: Record<
  AccessTier,
  {
    label: string;
    icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
    background: string;
  }
> = {
  OPEN_ACCESS: { label: 'Open Access', icon: 'lock-open-variant', background: color.success },
  SUBSCRIPTION: { label: 'Subscription', icon: 'lock', background: color.subscription },
  ELITE: { label: 'Elite', icon: 'crown', background: color.elite },
};

export default function AccessTierBadge({ tier, size = 'sm' }: AccessTierBadgeProps) {
  const { label, icon, background } = TIERS[tier];

  return (
    <View
      accessibilityRole="text"
      style={[styles.badge, styles[size], { backgroundColor: background }]}
    >
      <MaterialCommunityIcons name={icon} size={type.smallLabel.size} color={color.white} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    // The RN equivalent of the reference CSS's `display: inline-flex` — without
    // it the pill stretches to fill a column. Not an outer-layout choice.
    alignSelf: 'flex-start',
    gap: space.xs,
    borderRadius: radius.pill,
  },
  sm: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  md: { paddingHorizontal: space.md, paddingVertical: space.xs },
  label: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.white,
  },
});
