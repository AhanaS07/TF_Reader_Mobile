// Screen 03 — access gate. Raised when `resolveAccess` returns
// `requires_signin` and the reader taps the one button that state offers
// (`signIn`) — see ItemDetailScreen.tsx's `handleAction`.
//
// PRESENTED LIKE SignInScreen, NOT VIA `BottomSheet`, for the same reason
// SignInScreen gives: BottomSheet wraps its own Modal, and nesting a Modal
// inside this screen's `transparentModal` presentation produces z-index
// issues on Android. The sheet chrome (backdrop, handle, radius) is
// reproduced inline, matching SignInScreen's existing pattern exactly rather
// than inventing a second way to build a sheet.
//
// TWO ROUTES FORWARD, AND ONLY ONE OF THEM GOES ANYWHERE YET.
// "Through my institution" is a real, wired path: it remembers the tapped
// item, then hands off to whichever of SignIn or InstitutionList the reader
// needs next. "Personal account" is shown, per the mockup, but disabled —
// index.html: "screen 03's second option is reopened rather than settled."
// B2C as a concept was answered 13 Aug (retained; `subscribe` resolves an
// entitled reader like a Subscription) — but that answers the resolveAccess
// layer, not where this button goes. Screen 13 (email sign-in) is
// flambeau's and still reopened, so there is no destination or contract to
// wire here yet.
//
// NO AUTHENTICATION HAPPENS IN THIS FILE. This screen decides where the
// reader goes next and what to remember on the way; SignInScreen (and,
// eventually, flambeau's SAML handoff) is what actually signs anyone in.
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { OfflineBanner } from '@components/OfflineBanner';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import { color, radius, space, type as typeScale } from '@theme/tokens';

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
    navigate: (screen: 'SignIn' | 'InstitutionList') => void;
    goBack: () => void;
  };
}

const ICON_SIZE = 28;

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
  const handleInstitution = useCallback(() => {
    remember({
      action: 'read',
      itemId,
      institutionId: selectedInstitution?.id ?? null,
    });

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
  }, [remember, itemId, selectedInstitution, navigation]);

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss"
      />
      {/* Stop taps on the sheet itself from bubbling up to the dismiss pressable. */}
      <Pressable style={styles.sheet} onPress={() => {}}>
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

          <Pressable
            style={[styles.card, !isOnline && styles.cardDisabled]}
            onPress={isOnline ? handleInstitution : undefined}
            disabled={!isOnline}
            accessibilityRole="button"
            accessibilityLabel="Through my institution"
            accessibilityState={{ disabled: !isOnline }}
          >
            <Ionicons name="business-outline" size={ICON_SIZE} color={color.primary} />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Through my institution</Text>
              <Text style={styles.cardSubtitle}>Sign in via SAML/SSO</Text>
            </View>
            <Ionicons
              testID="access-gate-institution-chevron"
              name="chevron-forward"
              size={20}
              color={color.textSecondary}
            />
          </Pressable>

          {/* Shown, not hidden — same rule as every other unsettled mockup
              element in this codebase. No onPress, no navigation, no pending
              intent: there is nowhere for a tap here to go until B2C's
              destination is settled (index.html: "screen 03's second option
              is reopened rather than settled"). */}
          <View
            style={[styles.card, styles.cardDisabled]}
            accessibilityRole="text"
            accessibilityLabel="Personal account"
          >
            <Ionicons name="person-outline" size={ICON_SIZE} color={color.textSecondary} />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Personal account</Text>
              <Text style={styles.cardSubtitle}>Sign in with email</Text>
            </View>
            <Ionicons
              testID="access-gate-personal-account-chevron"
              name="chevron-forward"
              size={20}
              color={color.textSecondary}
            />
          </View>

          <Pressable
            style={styles.laterButton}
            onPress={handleDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.laterLabel}>I&apos;ll decide later</Text>
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
  },
  itemBlock: {
    gap: space.xs,
  },
  itemLabel: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  itemTitle: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  itemAuthors: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
  },
  cardDisabled: {
    opacity: 0.4,
  },
  cardText: {
    flex: 1,
    gap: space.xs / 2,
  },
  cardTitle: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  cardSubtitle: {
    fontWeight: typeScale.meta.weight,
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
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
});
