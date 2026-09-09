import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Institution } from '@model/institution';
import { color, radius, space, type } from '@theme/tokens';

export interface InstitutionRowProps {
  institution: Institution;
  isSelected?: boolean;
  // Renders a "Recently used" label above the row content.
  isPinned?: boolean;
  onPress?: () => void;
}

// Takes the first letter of each of the first two words.
// "Imperial College London" → "IC", "Kwame Nkrumah Uni..." → "KN"
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export default function InstitutionRow({
  institution,
  isSelected = false,
  isPinned = false,
  onPress,
}: InstitutionRowProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={institution.name}
      accessibilityState={{ selected: isSelected }}
    >
      {isPinned && (
        <Text style={styles.pinnedLabel}>Recently used</Text>
      )}

      <View style={styles.inner}>
        {institution.branding !== undefined ? (
          <Image
            source={{ uri: institution.branding.logoUrl }}
            style={styles.crest}
            resizeMode="contain"
            accessibilityLabel={`${institution.name} logo`}
          />
        ) : (
          // W-17: wokay may have no crest URL — initials monogram is the
          // required fallback, not a broken image or an empty box.
          <View style={styles.initialsCircle}>
            <Text style={styles.initialsText}>{getInitials(institution.name)}</Text>
          </View>
        )}

        <View style={styles.content}>
          <Text style={styles.name} numberOfLines={2}>
            {institution.name}
          </Text>
          <Text style={styles.country} numberOfLines={1}>
            {institution.country}
          </Text>
        </View>

        {isSelected && (
          <Ionicons name="checkmark" size={20} color={color.primary} />
        )}
      </View>
    </Pressable>
  );
}

// Crest size composed from the spacing scale — no bare number.
const CREST_SIZE = space.xl + space.md;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'column',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: color.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
    gap: space.xs,
  },
  pinnedLabel: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.primary,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  crest: {
    width: CREST_SIZE,
    height: CREST_SIZE,
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  initialsCircle: {
    width: CREST_SIZE,
    height: CREST_SIZE,
    borderRadius: radius.card,
    backgroundColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textSecondary,
  },
  content: {
    flex: 1,
    gap: space.xs,
  },
  name: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  country: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
