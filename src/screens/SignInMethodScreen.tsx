// Sign-in method chooser, reached from the Profile tab when nobody is signed in.
//
// A PUSHED SCREEN, NOT A SHEET. The access gate is an interruption raised on the
// reader; this is a destination they chose, so it gets a header and a back chevron.
// The two options themselves are the same AuthMethodCard the gate draws, so the two
// entry points cannot drift into looking like different products.
//
// No auth here — navigation only. SignInScreen handles SAML, PersonalAccountScreen
// handles email and password.
import { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthMethodCard } from '@components/AuthMethodCard';
import { OfflineBanner } from '@components/OfflineBanner';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useInstitutionStore } from '@store/institutionStore';
import { useSessionStore } from '@store/sessionStore';
import { color, space, type as typeScale } from '@theme/tokens';
import type { PersonalAccountMode } from '@navigation/types';

// Hand-typed rather than the generated stack props, for the same reason
// AccessGateScreen hand-types its own: this screen only ever pushes within the
// stack it is mounted in, and naming one stack's props would be a claim about
// which tab the reader is on.
interface Props {
  navigation: {
    navigate: (
      screen: 'SignIn' | 'InstitutionList' | 'PersonalAccount',
      params?: { mode: PersonalAccountMode },
    ) => void;
    goBack: () => void;
  };
}

export default function SignInMethodScreen({ navigation }: Props) {
  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);
  const isOnline = useNetworkStatus();

  // Set just before sending the reader to the institution list with nothing
  // selected, so the effect below knows the selection was asked for here rather
  // than made earlier for some other reason.
  const awaitingInstitution = useRef(false);

  useEffect(() => {
    if (!awaitingInstitution.current || selectedInstitution === null) return;
    awaitingInstitution.current = false;
    navigation.navigate('SignIn');
  }, [selectedInstitution, navigation]);

  // Both paths land back here when they finish, so this is the one place that has
  // to notice a session arrived. Without it the reader signs in and is left staring
  // at the chooser they have just finished with.
  useEffect(() => {
    if (isAuthenticated) navigation.goBack();
  }, [isAuthenticated, navigation]);

  const handleInstitution = useCallback(() => {
    if (selectedInstitution !== null) {
      navigation.navigate('SignIn');
      return;
    }
    // The effect above continues to SignIn once a selection lands, so the reader
    // does not have to come back and tap this a second time.
    awaitingInstitution.current = true;
    navigation.navigate('InstitutionList');
  }, [selectedInstitution, navigation]);

  const handlePersonal = useCallback(() => {
    navigation.navigate('PersonalAccount', { mode: 'signIn' });
  }, [navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Choose how to sign in</Text>
      <Text style={styles.intro}>
        Institutional readers sign in through their library. Personal subscribers use a
        Taylor &amp; Francis account.
      </Text>

      <OfflineBanner
        visible={!isOnline}
        message="You're offline. Signing in needs a connection."
      />

      <View style={styles.methods}>
        <AuthMethodCard
          testID="method-institution"
          icon="business-outline"
          title="Through my institution"
          subtitle="Sign in via SAML/SSO"
          onPress={handleInstitution}
          disabled={!isOnline}
        />
        <AuthMethodCard
          testID="method-personal"
          icon="person-outline"
          title="Personal account"
          subtitle="Sign in with email and password"
          onPress={handlePersonal}
          disabled={!isOnline}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    padding: space.md,
    gap: space.md,
  },
  heading: {
    fontWeight: typeScale.pageTitle.weight,
    fontFamily: typeScale.pageTitle.fontFamily,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  intro: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  methods: {
    gap: space.sm,
  },
});
