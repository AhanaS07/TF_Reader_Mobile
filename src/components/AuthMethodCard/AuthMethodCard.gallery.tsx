// Gallery entry — both sign-in methods, enabled and disabled.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthMethodCard from './AuthMethodCard';
import { color, space, type } from '@theme/tokens';

export default function AuthMethodCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>AuthMethodCard</Text>

      <View style={styles.stack}>
        <Text style={styles.label}>the pair, as the access gate and Profile draw them</Text>
        <AuthMethodCard
          testID="gallery-institution"
          icon="business-outline"
          title="Through my institution"
          subtitle="Sign in via SAML/SSO"
          onPress={() => {}}
        />
        <AuthMethodCard
          testID="gallery-personal"
          icon="person-outline"
          title="Personal account"
          subtitle="Sign in with email and password"
          onPress={() => {}}
        />

        {/* Disabled is what offline looks like. Greyed and announced as disabled
            rather than dropped, so the reader still learns the option exists. */}
        <Text style={styles.label}>disabled — offline</Text>
        <AuthMethodCard
          testID="gallery-institution-disabled"
          icon="business-outline"
          title="Through my institution"
          subtitle="Sign in via SAML/SSO"
          disabled
        />
        <AuthMethodCard
          testID="gallery-personal-disabled"
          icon="person-outline"
          title="Personal account"
          subtitle="Sign in with email and password"
          disabled
        />

        {/* The text column flexes and the icons do not, so a long title wraps
            without pushing the chevron off the card. */}
        <Text style={styles.label}>a title and subtitle long enough to wrap</Text>
        <AuthMethodCard
          testID="gallery-long"
          icon="business-outline"
          title="Through my institution or consortium library"
          subtitle="Single sign-on via SAML, OIDC or a federated access provider"
          onPress={() => {}}
        />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  // The card sets no outer margin of its own, so the gallery supplies the inset.
  stack: { paddingHorizontal: space.md, gap: space.sm },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.md,
  },
  spacer: { height: space.xl },
});
