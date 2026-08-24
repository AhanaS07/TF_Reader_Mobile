// Screen 02 — Sign-in sheet (CAP-3).
// transparentModal, not BottomSheet — nesting a Modal inside transparentModal causes z-index issues on Android.
// STUB: handleSignIn has no real SAML call — replace when flambeau publishes the sign-in contract.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ActionButton from '@components/ActionButton';
import ErrorState from '@components/ErrorState';
import OfflineBanner from '@components/OfflineBanner';
import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { color, radius, space, type as typeScale } from '@theme/tokens';
import type { CatalogueStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const institution = useInstitutionStore((s) => s.selectedInstitution);
  const takeIntent = usePendingIntentStore((s) => s.take);
  const isOnline = useNetworkStatus();

  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState(false);

  const handleDismiss = useCallback(() => {
    if (submitting) return;
    navigation.goBack();
  }, [navigation, submitting]);

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
      //
      // `popTo`, NOT `navigate` — for the common case the same ItemDetail is
      // already in the stack underneath AccessGate and this screen (the reader
      // never left the app), and `navigate` does not reliably collapse back to
      // it, leaving a duplicate with a stranded sheet beneath. `popTo` pops to
      // the existing entry, and pushes a fresh one if it genuinely isn't there.
      const intent = takeIntent();
      if (intent?.action === 'read') {
        navigation.popTo('ItemDetail', { itemId: intent.itemId });
      } else {
        navigation.goBack();
      }
    } catch {
      setSignInError(true);
    } finally {
      setSubmitting(false);
    }
  }, [institution, submitting, isOnline, navigation, takeIntent]);

  const handleRetry = useCallback(() => {
    handleSignIn();
  }, [handleSignIn]);

  // Guard: institution must be selected before this sheet is navigated to.
  // If the store is empty (shouldn't happen in normal flow), go back silently.
  useEffect(() => {
    if (!institution) navigation.goBack();
  }, [institution, navigation]);

  if (!institution) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} accessibilityLabel="Dismiss" />
      {/* Stop taps on the sheet from reaching the absoluteFill dismiss pressable.
          View + onStartShouldSetResponder claims the touch without wrapping children
          in an accessibility container (a default-accessible Pressable would group
          all children into one unit, hiding inner buttons from assistive technology). */}
      <View testID="sign-in-sheet" style={styles.sheet} onStartShouldSetResponder={() => true}>
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

              <ActionButton
                action="signIn"
                state={submitting ? 'loading' : 'idle'}
                disabled={!isOnline}
                onPress={handleSignIn}
              />
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
