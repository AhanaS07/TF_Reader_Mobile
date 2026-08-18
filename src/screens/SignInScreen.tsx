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
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useInstitutionStore } from '@store/institutionStore';
import { color, radius, space, type as typeScale } from '@theme/tokens';
import type { CatalogueStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const institution = useInstitutionStore((s) => s.selectedInstitution);

  const handleDismiss = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSignIn = useCallback(() => {
    if (!institution) return;

    // STUB — replace when flambeau publishes the sign-in handoff contract.
    // What goes here:
    //   1. Call flambeau.beginSamlSignIn({ institutionId: institution.id, idpHint: institution.signIn?.idpHint })
    //      `idpHint` comes from GET /api/v1/institutions/{id} → signIn.idpHint
    //   2. Wire the token return path (deep link / polling authTxnId — Question 5)
    //   3. On token received: replay pendingIntentStore.take() if present
    navigation.goBack();
  }, [institution, navigation]);

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
      {/* Stop taps on the sheet itself from bubbling up to the dismiss pressable. */}
      <Pressable style={styles.sheet} onPress={() => {}}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>Sign in</Text>

          <View style={styles.institutionBlock}>
            <Text style={styles.institutionName}>{institution.name}</Text>
            <Text style={styles.institutionMeta}>
              {institution.city} · {institution.country}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={handleSignIn}
            accessibilityRole="button"
          >
            <Text style={styles.primaryLabel}>Sign in with institution</Text>
          </Pressable>

          <Pressable
            style={styles.cancelButton}
            onPress={handleDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
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
