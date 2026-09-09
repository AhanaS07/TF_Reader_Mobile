import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ACCESS_TIERS } from '@model/types';
import { color, space, type } from '@theme/tokens';

import AccessTierBadge from './AccessTierBadge';

const SIZES = ['sm', 'md'] as const;

export default function AccessTierBadgeGallery() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>AccessTierBadge</Text>

      {SIZES.map((size) => (
        <View key={size} style={styles.group}>
          <Text style={styles.caption}>size={size}</Text>
          {/* Iterates ACCESS_TIERS rather than hardcoding three — a new tier
              appears here automatically. */}
          {ACCESS_TIERS.map((tier) => (
            <View key={tier} style={styles.row}>
              <AccessTierBadge tier={tier} size={size} />
            </View>
          ))}
        </View>
      ))}

      <View style={styles.group}>
        <Text style={styles.caption}>Longest label, narrow container</Text>
        <View style={styles.narrow}>
          <AccessTierBadge tier="OPEN_ACCESS" />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.md, gap: space.lg },
  heading: {
    fontWeight: type.sectionHeader.weight,
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  group: { gap: space.sm },
  caption: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  row: { flexDirection: 'row' },
  narrow: { width: 140, borderWidth: 1, borderColor: color.border, padding: space.xs },
});
