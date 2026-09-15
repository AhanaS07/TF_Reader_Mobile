// Personal account (OIDC) — sign in with an email and password, or create one.
//
// ONE SCREEN, TWO MODES, because the two forms differ by a single field and a
// handful of labels. `mode` lives in the route params rather than local state so
// the header title and the form cannot disagree after the reader flips between them.
//
// IT MAKES NO REQUEST ITSELF. Everything network-shaped is behind
// `@/auth/personalAccount`, which is a stub today — that file is the only edit
// needed when flambeau publishes the real routes.
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ErrorState from '@components/ErrorState';
import OfflineBanner from '@components/OfflineBanner';
import { PrimaryButton } from '@components/PrimaryButton';
import { TextField } from '@components/TextField';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import { useSessionStore } from '@store/sessionStore';
import { color, space, type as typeScale } from '@theme/tokens';
import {
  confirmPasswordError,
  emailError,
  newPasswordError,
  passwordError,
} from '@/auth/credentialRules';
import {
  signInWithPassword,
  signUpWithPassword,
  type PersonalAuthErrorCode,
  type PersonalAuthResult,
} from '@/auth/personalAccount';
import type { PersonalAccountMode } from '@navigation/types';

// Copy keyed on the code, never on an HTTP status — Design Spec §5.6. Denials say
// what happened and what to do about it; none of them apologise.
const FAILURE_MESSAGE: Record<PersonalAuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'That email and password do not match an account. Check both and try again.',
  EMAIL_ALREADY_REGISTERED: 'An account already exists for that email. Sign in instead.',
  WEAK_PASSWORD: 'Choose a longer password with a mix of letters and numbers.',
  NETWORK: 'Could not reach Taylor & Francis. Check your connection and try again.',
  UNKNOWN: 'Sign-in could not be completed. Try again.',
};

// Hand-typed for the same reason AccessGateScreen's is: this screen is registered
// in the Profile, Catalogue and Search stacks, so naming one stack's generated
// props would be wrong for the other two.
interface Props {
  route: { params: { mode: PersonalAccountMode } };
  navigation: {
    setParams: (params: { mode: PersonalAccountMode }) => void;
    popTo: (screen: 'ItemDetail', params: { itemId: string }) => void;
    goBack: () => void;
  };
}

export default function PersonalAccountScreen({ route, navigation }: Props) {
  const { mode } = route.params;
  const signingUp = mode === 'signUp';

  const setSession = useSessionStore((s) => s.setSession);
  const takeIntent = usePendingIntentStore((s) => s.take);
  const isOnline = useNetworkStatus();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // One piece of state per field rather than an errors object — three named
  // booleans-with-messages read more plainly than one bag to index into.
  const [emailFault, setEmailFault] = useState<string | undefined>(undefined);
  const [passwordFault, setPasswordFault] = useState<string | undefined>(undefined);
  const [confirmFault, setConfirmFault] = useState<string | undefined>(undefined);

  // The whole-form failure, as opposed to a single field's. Comes back from the
  // auth call, never from the client-side rules.
  const [formFault, setFormFault] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (submitting || !isOnline) return;

    const nextEmailFault = emailError(email);
    let nextPasswordFault: string | undefined;
    let nextConfirmFault: string | undefined;
    if (signingUp) {
      nextPasswordFault = newPasswordError(password);
      nextConfirmFault = confirmPasswordError(password, confirm);
    } else {
      nextPasswordFault = passwordError(password);
    }

    setEmailFault(nextEmailFault);
    setPasswordFault(nextPasswordFault);
    setConfirmFault(nextConfirmFault);
    setFormFault(undefined);

    if (
      nextEmailFault !== undefined ||
      nextPasswordFault !== undefined ||
      nextConfirmFault !== undefined
    ) {
      return;
    }

    setSubmitting(true);
    try {
      const credentials = { email: email.trim(), password };
      let result: PersonalAuthResult;
      if (signingUp) {
        result = await signUpWithPassword(credentials);
      } else {
        result = await signInWithPassword(credentials);
      }

      if (!result.ok) {
        setFormFault(FAILURE_MESSAGE[result.code]);
        return;
      }

      setSession(result.session);

      // Resume whatever the reader was trying to open before the gate stopped
      // them. Null when the flow started from Profile, which clears the intent on
      // the way in precisely so this cannot reach for a route the Profile stack
      // does not have.
      const intent = takeIntent();
      if (intent !== null && intent.action === 'read') {
        navigation.popTo('ItemDetail', { itemId: intent.itemId });
      } else {
        navigation.goBack();
      }
    } catch {
      setFormFault(FAILURE_MESSAGE.UNKNOWN);
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    isOnline,
    signingUp,
    email,
    password,
    confirm,
    setSession,
    takeIntent,
    navigation,
  ]);

  // Flipping mode empties the form. Carrying a half-typed password across from a
  // sign-in attempt into a create-account form is how someone sets their password
  // to a typo of their old one.
  const handleSwitchMode = useCallback(() => {
    setEmail('');
    setPassword('');
    setConfirm('');
    setEmailFault(undefined);
    setPasswordFault(undefined);
    setConfirmFault(undefined);
    setFormFault(undefined);
    navigation.setParams({ mode: signingUp ? 'signIn' : 'signUp' });
  }, [signingUp, navigation]);

  const heading = signingUp ? 'Create an account' : 'Sign in';
  const intro = signingUp
    ? 'A Taylor & Francis account gives you access to your personal subscriptions on any device.'
    : 'Use the email and password for your Taylor & Francis account.';
  const submitLabel = signingUp ? 'Create account' : 'Sign in';
  const switchPrompt = signingUp ? 'Already have an account?' : 'New to Taylor & Francis?';
  const switchLabel = signingUp ? 'Sign in instead' : 'Create an account';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      // So a tap on the submit button while the keyboard is open lands on the
      // button rather than being eaten by the keyboard dismissing.
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.intro}>{intro}</Text>

      <OfflineBanner
        visible={!isOnline}
        message="You're offline. Signing in needs a connection."
      />

      {formFault !== undefined && (
        <ErrorState variant="not_ready" message={formFault} onRetry={handleSubmit} />
      )}

      <View style={styles.form}>
        <TextField
          testID="personal-email"
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          error={emailFault}
          keyboardType="email-address"
          autoComplete="email"
          editable={!submitting}
          returnKeyType="next"
        />

        <TextField
          testID="personal-password"
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={signingUp ? 'At least 8 characters' : 'Your password'}
          error={passwordFault}
          secureTextEntry
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          editable={!submitting}
          returnKeyType={signingUp ? 'next' : 'go'}
          onSubmitEditing={signingUp ? undefined : handleSubmit}
        />

        {signingUp && (
          <TextField
            testID="personal-confirm"
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter your password"
            error={confirmFault}
            secureTextEntry
            autoComplete="new-password"
            editable={!submitting}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />
        )}
      </View>

      <PrimaryButton
        testID="personal-submit"
        label={submitLabel}
        onPress={handleSubmit}
        loading={submitting}
        disabled={!isOnline}
      />

      <View style={styles.switchBlock}>
        <Text style={styles.switchPrompt}>{switchPrompt}</Text>
        <PrimaryButton
          testID="personal-switch-mode"
          label={switchLabel}
          emphasis="quiet"
          onPress={handleSwitchMode}
          disabled={submitting}
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
  // Wider gap between fields than the page's own, so a validation message sits
  // clearly under its own field rather than floating between two.
  form: {
    gap: space.md,
    marginTop: space.sm,
  },
  switchBlock: {
    marginTop: space.lg,
    alignItems: 'center',
    gap: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    paddingTop: space.lg,
  },
  switchPrompt: {
    fontWeight: typeScale.smallLabel.weight,
    fontFamily: typeScale.smallLabel.fontFamily,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
});
