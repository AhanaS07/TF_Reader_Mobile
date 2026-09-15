// src/screens/PersonalAccountScreen.test.tsx
// The email-and-password form, in both of its modes.
//
// Covered behaviours:
//   1. Mode drives the heading, the submit label and the confirm field.
//   2. Client-side rules run before any call, and block it.
//   3. A successful sign-in writes the session.
//   4. A pending intent is replayed with popTo; its absence goes back instead.
//   5. A failed call shows the copy for its code, and Retry re-submits.
//   6. A thrown call is caught rather than escaping as an unhandled rejection.
//   7. Offline and in-flight both refuse a submit.
//   8. Switching mode empties the form, so a half-typed password cannot carry over.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { usePendingIntentStore } from '@store/pendingIntentStore';
import { useSessionStore } from '@store/sessionStore';
import * as personalAccount from '@/auth/personalAccount';

import PersonalAccountScreen from './PersonalAccountScreen';

const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockGoBack = jest.fn();
const mockPopTo = jest.fn();
const mockSetParams = jest.fn();

function makeProps(mode: 'signIn' | 'signUp' = 'signIn') {
  return {
    route: { params: { mode } },
    navigation: { goBack: mockGoBack, popTo: mockPopTo, setParams: mockSetParams },
  };
}

// Fills both fields with values that pass every client-side rule, so a test about
// the call itself is not also a test about validation.
async function fillValidCredentials() {
  await fireEvent.changeText(screen.getByTestId('personal-email-input'), 'reader@tf.com');
  await fireEvent.changeText(screen.getByTestId('personal-password-input'), 'hunter2000');
}

/**
 * NOT AWAITED, and that is the point. `handleSubmit` is async, so the Pressable's
 * onPress returns a promise and `await fireEvent.press` would wait for the whole
 * call to settle — which is exactly what an in-flight test is trying to observe.
 */
function pressSubmit() {
  fireEvent.press(screen.getByTestId('personal-submit'));
}

/**
 * A call the test finishes by hand, so it can look at the screen mid-flight and
 * then let the component settle rather than leaving a promise pending at teardown.
 */
function deferredCall() {
  let release: () => void = () => {};
  const promise = new Promise<personalAccount.PersonalAuthResult>((resolve) => {
    release = () => resolve({ ok: false, code: 'UNKNOWN' });
  });
  return {
    promise,
    finish: () =>
      act(async () => {
        release();
        await promise;
      }),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  mockGoBack.mockClear();
  mockPopTo.mockClear();
  mockSetParams.mockClear();
  mockUseNetworkStatus.mockReturnValue(true);
  usePendingIntentStore.setState({ pending: null });
  useSessionStore.getState().clearSession();
});

describe('PersonalAccountScreen — mode', () => {
  // The heading and the submit button both read "Sign in" in this mode, so the
  // heading is identified by its own intro line rather than by that text.
  it('reads as a sign-in form in signIn mode', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    expect(
      screen.getByText('Use the email and password for your Taylor & Francis account.'),
    ).toBeTruthy();
    expect(screen.getByTestId('personal-submit').props.accessibilityLabel).toBe('Sign in');
  });

  it('reads as a create-account form in signUp mode', async () => {
    await render(<PersonalAccountScreen {...makeProps('signUp')} />);

    expect(screen.getByText('Create an account')).toBeTruthy();
    expect(screen.getByTestId('personal-submit').props.accessibilityLabel).toBe('Create account');
  });

  it('asks for a confirmation only when creating an account', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    expect(screen.queryByTestId('personal-confirm-input')).toBeNull();

    await render(<PersonalAccountScreen {...makeProps('signUp')} />);
    expect(screen.getByTestId('personal-confirm-input')).toBeTruthy();
  });
});

describe('PersonalAccountScreen — validation', () => {
  it('reports an empty email and never makes the call', async () => {
    const signIn = jest.spyOn(personalAccount, 'signInWithPassword');
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText('Enter your email address.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('reports a malformed email', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.changeText(screen.getByTestId('personal-email-input'), 'not-an-address');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('reports an empty password', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.changeText(screen.getByTestId('personal-email-input'), 'reader@tf.com');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText('Enter your password.')).toBeTruthy();
  });

  it('enforces a password length only when creating an account', async () => {
    await render(<PersonalAccountScreen {...makeProps('signUp')} />);

    await fireEvent.changeText(screen.getByTestId('personal-email-input'), 'reader@tf.com');
    await fireEvent.changeText(screen.getByTestId('personal-password-input'), 'short');
    await fireEvent.changeText(screen.getByTestId('personal-confirm-input'), 'short');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
  });

  it('reports a confirmation that does not match', async () => {
    await render(<PersonalAccountScreen {...makeProps('signUp')} />);

    await fireEvent.changeText(screen.getByTestId('personal-email-input'), 'reader@tf.com');
    await fireEvent.changeText(screen.getByTestId('personal-password-input'), 'hunter2000');
    await fireEvent.changeText(screen.getByTestId('personal-confirm-input'), 'hunter2001');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  });
});

const SUCCESSFUL_SESSION: personalAccount.PersonalAuthResult = {
  ok: true,
  session: {
    accessToken: 'access_1',
    expiresIn: 3600,
    userId: 'reader@tf.com',
    roles: ['read'],
    collections: ['col_1'],
  },
};

describe('PersonalAccountScreen — a successful call', () => {
  // signInWithPassword is real now (it calls /auth/login), so these tests
  // stub it directly rather than exercising the network.
  beforeEach(() => {
    jest.spyOn(personalAccount, 'signInWithPassword').mockResolvedValue(SUCCESSFUL_SESSION);
    jest.spyOn(personalAccount, 'signUpWithPassword').mockResolvedValue(SUCCESSFUL_SESSION);
  });

  it('writes the session', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(useSessionStore.getState().isAuthenticated).toBe(true);
    });
    expect(useSessionStore.getState().userId).toBe('reader@tf.com');
  });

  // A personal session must not claim an institution, or the catalogue is scoped
  // to entitlements the reader does not have.
  it('leaves institutionId null on the session', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(useSessionStore.getState().isAuthenticated).toBe(true);
    });
    expect(useSessionStore.getState().institutionId).toBeNull();
  });

  it('trims the email before sending it', async () => {
    const signIn = jest.spyOn(personalAccount, 'signInWithPassword');
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.changeText(screen.getByTestId('personal-email-input'), '  reader@tf.com ');
    await fireEvent.changeText(screen.getByTestId('personal-password-input'), 'hunter2000');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith({ email: 'reader@tf.com', password: 'hunter2000' });
    });
  });

  it('calls the sign-up route in signUp mode, not the sign-in one', async () => {
    const signUp = jest.spyOn(personalAccount, 'signUpWithPassword');
    const signIn = jest.spyOn(personalAccount, 'signInWithPassword');
    await render(<PersonalAccountScreen {...makeProps('signUp')} />);

    await fillValidCredentials();
    await fireEvent.changeText(screen.getByTestId('personal-confirm-input'), 'hunter2000');
    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalled();
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  // popTo, not navigate — the ItemDetail that raised the gate is already in the
  // stack underneath, and navigate would leave a duplicate.
  it('replays a pending read intent with popTo', async () => {
    usePendingIntentStore.getState().remember({
      action: 'read',
      itemId: 'item_42',
      institutionId: 'inst_7f3',
    });
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(mockPopTo).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('just goes back when there is nothing to resume', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
    expect(mockPopTo).not.toHaveBeenCalled();
  });
});

describe('PersonalAccountScreen — a failed call', () => {
  it('shows the copy for the returned code', async () => {
    jest
      .spyOn(personalAccount, 'signInWithPassword')
      .mockResolvedValue({ ok: false, code: 'INVALID_CREDENTIALS' });
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(
      await screen.findByText(
        'That email and password do not match an account. Check both and try again.',
      ),
    ).toBeTruthy();
  });

  it('does not write a session', async () => {
    jest
      .spyOn(personalAccount, 'signInWithPassword')
      .mockResolvedValue({ ok: false, code: 'NETWORK' });
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Could not reach Taylor & Francis/)).toBeTruthy();
    });
    expect(useSessionStore.getState().isAuthenticated).toBe(false);
  });

  it('re-submits when Retry is pressed', async () => {
    const signIn = jest
      .spyOn(personalAccount, 'signInWithPassword')
      .mockResolvedValue({ ok: false, code: 'UNKNOWN' });
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();
    await fireEvent.press(screen.getByTestId('personal-submit'));
    await screen.findByLabelText('Retry');

    await fireEvent.press(screen.getByLabelText('Retry'));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(2);
    });
  });

  // A rejection from the real client must surface as copy, not as an unhandled
  // promise rejection that takes the screen down.
  it('catches a thrown call', async () => {
    jest
      .spyOn(personalAccount, 'signInWithPassword')
      .mockRejectedValue(new Error('socket hang up'));
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(await screen.findByText('Sign-in could not be completed. Try again.')).toBeTruthy();
    expect(useSessionStore.getState().isAuthenticated).toBe(false);
  });
});

describe('PersonalAccountScreen — refusing to submit', () => {
  it('says why while offline, and does not call', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    const signIn = jest.spyOn(personalAccount, 'signInWithPassword');
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.press(screen.getByTestId('personal-submit'));

    expect(screen.getByText("You're offline. Signing in needs a connection.")).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('does not fire a second call while the first is in flight', async () => {
    const call = deferredCall();
    const signIn = jest
      .spyOn(personalAccount, 'signInWithPassword')
      .mockReturnValue(call.promise);
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    pressSubmit();
    await waitFor(() => {
      expect(screen.getByTestId('personal-submit-spinner')).toBeTruthy();
    });
    pressSubmit();

    expect(signIn).toHaveBeenCalledTimes(1);
    await call.finish();
  });

  it('locks the fields while a call is in flight', async () => {
    const call = deferredCall();
    jest.spyOn(personalAccount, 'signInWithPassword').mockReturnValue(call.promise);
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    pressSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('personal-submit-spinner')).toBeTruthy();
    });
    expect(screen.getByTestId('personal-email-input').props.editable).toBe(false);
    await call.finish();
  });
});

describe('PersonalAccountScreen — switching mode', () => {
  it('flips the route param rather than holding mode locally', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);

    await fireEvent.press(screen.getByTestId('personal-switch-mode'));

    expect(mockSetParams).toHaveBeenCalledWith({ mode: 'signUp' });
  });

  it('flips back the other way', async () => {
    await render(<PersonalAccountScreen {...makeProps('signUp')} />);

    await fireEvent.press(screen.getByTestId('personal-switch-mode'));

    expect(mockSetParams).toHaveBeenCalledWith({ mode: 'signIn' });
  });

  // Carrying a half-typed password from a sign-in attempt into a create-account
  // form is how someone sets their password to a typo of their old one.
  it('empties the form', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fillValidCredentials();

    await fireEvent.press(screen.getByTestId('personal-switch-mode'));

    expect(screen.getByTestId('personal-email-input').props.value).toBe('');
    expect(screen.getByTestId('personal-password-input').props.value).toBe('');
  });

  it('clears a validation message left over from the other mode', async () => {
    await render(<PersonalAccountScreen {...makeProps('signIn')} />);
    await fireEvent.press(screen.getByTestId('personal-submit'));
    expect(screen.getByText('Enter your email address.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('personal-switch-mode'));

    expect(screen.queryByText('Enter your email address.')).toBeNull();
  });
});
