// C2 — the institution detail view. Read-only, props in, callbacks out.
//
// TAKES PRIMITIVES, NOT AN Institution. Two Institution shapes exist right now
// (@model/institution, which the adapter returns, and @model/types, which nothing
// imports yet) and `crestUrl` is mid-rename to `logoUrl`. Following ContentCard,
// this file imports neither: the screen maps whatever shape it holds into these
// three values, so a contract change lands in the wrapper instead of here.
//
// It also means authType cannot be rendered, because it never arrives — sign-in
// is always SAML, so there is nothing to display and nothing to choose.
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '@theme/tokens';

export interface InstitutionDetailViewProps {
  name: string;
  country: string;
  logoUrl?: string;
  onSelect: () => void;
  onBack: () => void;
}

// Mirrors InstitutionRow's private helper. Duplicated rather than exported from
// there, since that file has another author — promote to a shared util if a third
// caller appears.
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

// Larger than InstitutionRow's crest, composed from the spacing scale so no bare
// number enters the StyleSheet.
const LOGO_SIZE = space.xl + space.xl + space.md;

export default function InstitutionDetailView({
  name,
  country,
  logoUrl,
  onSelect,
  onBack,
}: InstitutionDetailViewProps) {
  return (
    <View style={styles.container}>
      {logoUrl !== undefined ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={`${name} logo`}
        />
      ) : (
        // W-17: some institutions have no logo. Initials are the required
        // fallback, not a broken image or an empty box.
        <View style={styles.initialsBlock}>
          <Text style={styles.initialsText}>{getInitials(name)}</Text>
        </View>
      )}

      {/* No numberOfLines — a detail screen has room to wrap where a row does not. */}
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.country}>{country}</Text>

      <Pressable
        style={styles.primaryAction}
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel="Select this institution"
      >
        <Text style={styles.primaryLabel}>Select this institution</Text>
      </Pressable>

      <Pressable
        style={styles.secondaryAction}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Text style={styles.secondaryLabel}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: space.lg,
    gap: space.md,
    backgroundColor: color.white,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  initialsBlock: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: radius.card,
    backgroundColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textSecondary,
  },
  name: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
  },
  country: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  primaryAction: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
  },
  primaryLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.white,
  },
  secondaryAction: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  secondaryLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
