// Screen 03 — access gate. Raised when resolveAccess returns requires_signin.
// transparentModal, not BottomSheet — same z-index reason as SignInScreen.
// Both options are now wired: institution goes to SAML, personal account goes to
// the email-and-password form. No auth here — navigation and intent only.
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthMethodCard } from '@components/AuthMethodCard';
import { OfflineBanner } from '@components/OfflineBanner';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import { color, radius, space, type as typeScale } from '@theme/tokens';
import type { PersonalAccountMode } from '@navigation/types';

// A minimal, hand-typed shape rather than either stack's generated props —
// same reason ItemDetailScreen's own route type is hand-typed: this screen is
// registered in both CatalogueStackParamList and SearchStackParamList, and
// picking one stack's `NativeStackScreenProps` would be wrong for the other.
// SignIn and InstitutionList are registered in both stacks too (same reason),
// so `navigate` only ever needs to push within whichever stack this screen is
// currently mounted in — never a cross-tab jump, and never a claim about
// which tab the reader ends up looking at for a flow that started elsewhere.
interface Props {
  route: { params: { itemId: string; title: string; authors: string } };
  navigation: {
    navigate: (
      screen: 'SignIn' | 'InstitutionList' | 'PersonalAccount',
      params?: { mode: PersonalAccountMode },
    ) => void;
    goBack: () => void;
  };
}

export default function AccessGateScreen({ route, navigation }: Props) {
  const { itemId, title, authors } = route.params;

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const remember = usePendingIntentStore((s) => s.remember);
  const isOnline = useNetworkStatus();

  // Set right before sending the reader to InstitutionList with nothing
  // selected yet; cleared once the effect below fires, or on dismiss. Not
  // strictly load-bearing now that InstitutionList lives in the same stack as
  // this screen (its own `goBack()` correctly lands back here either way) —
  // kept because it also removes the need for a second manual tap on
  // "Through my institution" to notice the selection and continue.
  const awaitingInstitution = useRef(false);

  useEffect(() => {
    if (!awaitingInstitution.current || selectedInstitution === null) return;
    awaitingInstitution.current = false;
    navigation.goBack();
    navigation.navigate('SignIn');
  }, [selectedInstitution, navigation]);

  const handleDismiss = useCallback(() => {
    awaitingInstitution.current = false;
    navigation.goBack();
  }, [navigation]);

  // Not `signIn` — the store's own type excludes it, so replaying this after
  // sign-in cannot bounce the reader straight back out to the identity
  // provider. `resolveAccess`'s signed-out branch collapses every action to
  // the one `signIn` button, so the tap that actually brought the reader here
  // (Read, Download, ...) is not knowable — 'read' is the store's own
  // documented judgement call for exactly this case: "the intent is the
  // app's judgement about what to resume... rather than a button they
  // pressed."
  // Both options record the same intent, so it is recorded in one place.
  const rememberReadIntent = useCallback(() => {
    remember({
      action: 'read',
      itemId,
      institutionId: selectedInstitution?.id ?? null,
    });
  }, [remember, itemId, selectedInstitution]);

  const handleInstitution = useCallback(() => {
    rememberReadIntent();

    // In-stack navigation — pushes onto whichever stack this screen is
    // currently mounted in (Catalogue or Search), so a flow that started in
    // Search stays in Search rather than relocating the reader to a tab they
    // never chose.
    if (selectedInstitution !== null) {
      // Dismiss this screen first — otherwise AccessGate stays mounted
      // underneath SignIn instead of being replaced by it.
      navigation.goBack();
      navigation.navigate('SignIn');
    } else {
      // The effect above continues to SignIn once a selection lands.
      awaitingInstitution.current = true;
      navigation.navigate('InstitutionList');
    }
  }, [rememberReadIntent, selectedInstitution, navigation]);

  // No institution needed on this path — a personal subscriber belongs to none,
  // so it goes straight to the form. Dismiss first for the same reason the
  // institution path does: otherwise this sheet stays mounted underneath.
  const handlePersonal = useCallback(() => {
    rememberReadIntent();
    navigation.goBack();
    navigation.navigate('PersonalAccount', { mode: 'signIn' });
  }, [rememberReadIntent, navigation]);

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss"
      />
      {/* Stop taps on the sheet itself from bubbling up to the dismiss pressable.
          View + onStartShouldSetResponder claims the touch without wrapping children
          in an accessibility container (a Pressable would group them into one unit). */}
      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>Choose how to access</Text>

          <View style={styles.itemBlock}>
            <Text style={styles.itemLabel}>You&apos;re trying to access:</Text>
            <Text style={styles.itemTitle}>{title}</Text>
            {/* Authors only — no journal, volume or issue. Neither field
                exists on the model or in either contract (index.html:
                "Screen 03 — 'Jazz Perspectives, 2007, Volume 1, Issue 1' —
                No volume or issue field. Render the fields we have."), so
                the citation line the mockup shows is not reproduced here. */}
            {authors.length > 0 && <Text style={styles.itemAuthors}>{authors}</Text>}
          </View>

          <OfflineBanner
            visible={!isOnline}
            message="You're offline. Institutional sign-in needs a connection."
          />

          <AuthMethodCard
            testID="access-gate-institution"
            icon="business-outline"
            title="Through my institution"
            subtitle="Sign in via SAML/SSO"
            onPress={handleInstitution}
            disabled={!isOnline}
          />

          {/* Live as of the personal-account form landing. It was drawn disabled
              while B2C had no destination; the destination now exists, so the
              card behaves like the one above it. */}
          <AuthMethodCard
            testID="access-gate-personal-account"
            icon="person-outline"
            title="Personal account"
            subtitle="Sign in with email and password"
            onPress={handlePersonal}
            disabled={!isOnline}
          />

          <Pressable
            style={styles.laterButton}
            onPress={handleDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.laterLabel}>I&apos;ll decide later</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.navy,
    opacity: 0.5,
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingBottom: space.xl,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  handle: {
    width: space.xl + space.md,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
  },
  body: {
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  heading: {
    fontWeight: typeScale.sectionHeader.weight,
    fontFamily: typeScale.sectionHeader.fontFamily,
    fontSize: typeScale.sectionHeader.size,
    lineHeight: typeScale.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  itemBlock: {
    gap: space.xs,
  },
  itemLabel: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  itemTitle: {
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  itemAuthors: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  laterButton: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  laterLabel: {
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
});
