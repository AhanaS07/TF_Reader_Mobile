// src/screens/SignInMethodScreen.test.tsx
// The method chooser reached from Profile when nobody is signed in.
//
// Covered behaviours:
//   1. Both methods render.
//   2. Institution with a selection already in the store → straight to SignIn.
//   3. Institution with nothing selected → InstitutionList, then SignIn once a
//      selection lands (the effect, so the reader taps once rather than twice).
//   4. A selection landing that this screen did NOT ask for is ignored.
//   5. Personal account carries sign-in mode.
//   6. Offline disables both, because neither can succeed.
//   7. A session arriving pops this screen, so the reader is not left on the
//      chooser they have just finished with.
//
// Create-account is NOT offered here — Profile already offers it directly, and
// repeating it on the chooser the reader reaches from "Sign in" was a second,
// redundant path to the same screen.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useInstitutionStore } from '@store/institutionStore';
import { useSessionStore } from '@store/sessionStore';
import type { Institution } from '@model/institution';

import SignInMethodScreen from './SignInMethodScreen';

const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const IMPERIAL: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
};

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

function makeProps() {
  return { navigation: { navigate: mockNavigate, goBack: mockGoBack } };
}

afterEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockUseNetworkStatus.mockReturnValue(true);
  useInstitutionStore.setState({ selectedInstitution: null, recentlyUsedIds: [] });
  useSessionStore.getState().clearSession();
});

describe('SignInMethodScreen content', () => {
  it('offers both sign-in methods', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    expect(screen.getByText('Through my institution')).toBeTruthy();
    expect(screen.getByText('Personal account')).toBeTruthy();
  });

  // Profile already offers Create an account as its own button; a second copy
  // of it here would be a redundant path to the same screen.
  it('does not repeat the create-account affordance Profile already offers', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    expect(screen.queryByTestId('method-create-account')).toBeNull();
    expect(screen.queryByText('New to Taylor & Francis?')).toBeNull();
  });
});

describe('SignInMethodScreen — through my institution', () => {
  it('goes straight to SignIn when an institution is already selected', async () => {
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    await render(<SignInMethodScreen {...makeProps()} />);

    await fireEvent.press(screen.getByTestId('method-institution'));

    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  it('asks for an institution first when none is selected', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    await fireEvent.press(screen.getByTestId('method-institution'));

    expect(mockNavigate).toHaveBeenCalledWith('InstitutionList');
  });

  // The whole point of the effect: one tap, not two.
  it('continues to SignIn on its own once a selection lands', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);
    await fireEvent.press(screen.getByTestId('method-institution'));
    mockNavigate.mockClear();

    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    });

    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  // Without the ref guard, an institution changed for any other reason while
  // this screen happens to be mounted would fire an unasked-for sign-in.
  it('ignores a selection it did not ask for', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not fire twice for one request', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);
    await fireEvent.press(screen.getByTestId('method-institution'));
    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    });
    mockNavigate.mockClear();

    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: { ...IMPERIAL, name: 'Renamed' } });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('SignInMethodScreen — personal account', () => {
  it('opens the form in sign-in mode', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    await fireEvent.press(screen.getByTestId('method-personal'));

    expect(mockNavigate).toHaveBeenCalledWith('PersonalAccount', { mode: 'signIn' });
  });
});

describe('SignInMethodScreen offline', () => {
  it('says why nothing can be done', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    await render(<SignInMethodScreen {...makeProps()} />);

    expect(screen.getByText("You're offline. Signing in needs a connection.")).toBeTruthy();
  });

  it.each(['method-institution', 'method-personal'])(
    'disables %s',
    async (testID) => {
      mockUseNetworkStatus.mockReturnValue(false);
      await render(<SignInMethodScreen {...makeProps()} />);

      await fireEvent.press(screen.getByTestId(testID));

      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );
});

describe('SignInMethodScreen — a session arriving', () => {
  it('pops itself, rather than leaving the reader on a finished chooser', async () => {
    await render(<SignInMethodScreen {...makeProps()} />);

    await act(async () => {
      useSessionStore.getState().setSession({
        accessToken: 'token',
        expiresIn: 3600,
        userId: 'reader@tf.com',
        roles: [],
        collections: [],
      });
    });

    expect(mockGoBack).toHaveBeenCalled();
  });
});
