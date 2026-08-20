// Screen 02 — Sign-in sheet (CAP-3, Keshav)
//
// Presented as a transparentModal so the screen below stays visible through
// the backdrop. BottomSheet is not used here because it wraps its own Modal,
// and nesting a Modal inside a transparentModal produces z-index issues on
// Android. The sheet chrome (backdrop, handle, radius) is reproduced inline.
//
// FLAMBEAU HANDOFF IS STUBBED. Sign-in is SAML: the app opens a browser,
// passes { institutionId, idpHint } to flambeau, and then leaves. How the
// token comes back (deep link vs polling authTxnId) is Question 5 — unanswered
// as of Week 2. Replace the stub in handleSignIn once flambeau publishes the
// handoff contract.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ErrorState from '@components/ErrorState';
import OfflineBanner from '@components/OfflineBanner';
import { useInstitutionStore } from '@store/institutionStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { color, radius, space, type as typeScale } from '@theme/tokens';
import type { CatalogueStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const institution = useInstitutionStore((s) => s.selectedInstitution);
  const isOnline = useNetworkStatus();

  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState(false);

  const handleDismiss = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSignIn = useCallback(async () => {
    if (!institution || submitting || !isOnline) return;
    setSignInError(false);
    setSubmitting(true);
    try {
      // STUB — replace when flambeau publishes the sign-in handoff contract.
      // What goes here:
      //   1. Call flambeau.beginSamlSignIn({ institutionId: institution.id, idpHint: institution.signIn?.idpHint })
      //      `idpHint` comes from GET /api/v1/institutions/{id} → signIn.idpHint
      //   2. Wire the token return path (deep link / polling authTxnId — Question 5)
      //   3. On token received: replay pendingIntentStore.take() if present
      navigation.goBack();
    } catch {
      setSubmitting(false);
      setSignInError(true);
    }
  }, [institution, submitting, isOnline, navigation]);

  const handleRetry = useCallback(() => {
    handleSignIn();
  }, [handleSignIn]);

  // Guard: institution must be selected before this sheet is navigated to.
  // If the store is empty (shouldn't happen in normal flow), go back silently.
  useEffect(() => {
    if (!institution) navigation.goBack();
  }, [institution, navigation]);

  if (!institution) return null;

  const signInDisabled = submitting || !isOnline;

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} accessibilityLabel="Dismiss" />
      {/* Stop taps on the sheet from reaching the absoluteFill dismiss pressable.
          View + onStartShouldSetResponder claims the touch without wrapping children
          in an accessibility container (a default-accessible Pressable would group
          all children into one unit, hiding inner buttons from assistive technology). */}
      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>Sign in</Text>

          {signInError ? (
            <ErrorState
              variant="not_ready"
              message="Sign-in could not be started. Please try again."
              onRetry={handleRetry}
            />
          ) : (
            <>
              <View style={styles.institutionBlock}>
                <Text style={styles.institutionName}>{institution.name}</Text>
                <Text style={styles.institutionMeta}>
                  {institution.city} · {institution.country}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !signInDisabled && styles.primaryButtonPressed,
                  signInDisabled && styles.primaryButtonDisabled,
                ]}
                onPress={handleSignIn}
                disabled={signInDisabled}
                accessibilityRole="button"
                accessibilityLabel="Sign in with institution"
                accessibilityState={{ disabled: signInDisabled }}
              >
                <Text style={styles.primaryLabel}>Sign in with institution</Text>
              </Pressable>
            </>
          )}

          <Pressable
            style={styles.cancelButton}
            onPress={handleDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
      <OfflineBanner visible={!isOnline} />
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
    backgroundColor: color.surface,
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
    fontSize: typeScale.sectionHeader.size,
    lineHeight: typeScale.sectionHeader.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  institutionBlock: {
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.sm,
  },
  institutionName: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
  },
  institutionMeta: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: color.primary,
    borderRadius: radius.pill,
    paddingVertical: space.sm + space.xs,
    alignItems: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.surface,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  cancelLabel: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
});
