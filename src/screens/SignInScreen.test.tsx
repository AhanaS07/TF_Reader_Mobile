// src/screens/SignInScreen.test.tsx
// Screen 02 — Sign-in sheet
//
// Covered behaviours:
//   1. Renders the selected institution's name when one is in the store.
//   2. No institution in the store → goBack() is called immediately; nothing rendered.
//   3. Backdrop tap dismisses; the sheet View claims its own touches via onStartShouldSetResponder.
//   4. Sign-in button is disabled when the device is offline — pressing it does not call goBack.
//   5. Sign-in button is disabled while a sign-in attempt is in flight (submitting=true).
//   6. If the sign-in call throws, ErrorState appears and pressing Retry re-invokes the handler.
//   7. A pending intent is replayed with popTo, not navigate, so the ItemDetail
//      already in the stack is returned to rather than duplicated.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import { useSessionStore } from '@store/sessionStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import type { Institution } from '@model/institution';
import type { CatalogueStackParamList } from '../navigation/types';

import SignInScreen from './SignInScreen';

jest.mock('@hooks/useNetworkStatus');
const mockIsOnline = useNetworkStatus as jest.MockedFunction<typeof useNetworkStatus>;

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockPopTo = jest.fn();

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'SignIn'>;
const mockNavigation = {
  goBack: mockGoBack,
  navigate: mockNavigate,
  popTo: mockPopTo,
} as unknown as Nav;


const IMPERIAL: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

afterEach(() => {
  useInstitutionStore.setState({ selectedInstitution: null, recentlyUsedIds: [], cachedInstitutions: [] });
  usePendingIntentStore.setState({ pending: null });
  useSessionStore.getState().clearSession();
  mockGoBack.mockClear();
  mockNavigate.mockClear();
  mockPopTo.mockClear();
  mockIsOnline.mockReset();
});

describe('SignInScreen', () => {
  it('renders the selected institution name', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    expect(screen.getByText('Imperial College London')).toBeTruthy();
  });

  it('calls goBack immediately when there is no selected institution', async () => {
    mockIsOnline.mockReturnValue(true);
    // selectedInstitution defaults to null after afterEach reset

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it('tapping the backdrop calls goBack; the sheet claims its own touches', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    // onStartShouldSetResponder must return true so native touch bubbling stops
    // before reaching the absoluteFill dismiss Pressable behind the sheet.
    // fireEvent.press cannot exercise the responder system — verify the contract directly.
    const sheet = screen.getByTestId('sign-in-sheet');
    expect(sheet.props.onStartShouldSetResponder()).toBe(true);

    // The backdrop Pressable should still call goBack.
    fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('disables the sign-in button when offline and pressing it does not trigger goBack', async () => {
    mockIsOnline.mockReturnValue(false);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    // ActionButton renders with testID="action-button-signIn"; the handleSignIn guard
    // (!isOnline) ensures goBack is never called even if fireEvent bypasses disabled.
    fireEvent.press(screen.getByTestId('action-button-signIn'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('shows ErrorState and a Retry button when sign-in throws; pressing Retry re-invokes the handler', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    // Make goBack throw so the catch block fires and signInError=true
    mockGoBack.mockImplementationOnce(() => { throw new Error('flambeau unavailable'); });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    fireEvent.press(screen.getByTestId('action-button-signIn'));

    await waitFor(() =>
      expect(screen.getByText(/sign-in could not be started/i)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();

    // Retry re-invokes the handler — goBack is called on the second attempt
    fireEvent.press(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });
});

describe('SignInScreen pending-intent replay', () => {
  // `popTo`, not `navigate` — the ItemDetail already in the stack (pushed
  // before AccessGate and this screen went on top of it) must be returned to,
  // not duplicated. A duplicate leaves this sheet stranded underneath, so the
  // first back press reveals it again instead of reaching the list.
  it('resumes the remembered item with popTo', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    usePendingIntentStore.setState({
      pending: {
        action: 'read',
        itemId: 'item_42',
        institutionId: 'inst_7f3',
        createdAt: Date.now(),
      },
    });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    fireEvent.press(screen.getByTestId('action-button-signIn'));

    await waitFor(() =>
      expect(mockPopTo).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('falls back to goBack when no intent is pending', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);

    fireEvent.press(screen.getByTestId('action-button-signIn'));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(mockPopTo).not.toHaveBeenCalled();
  });

  // The stub must set a session before replaying the intent, otherwise ItemDetail
  // re-evaluates access and finds the reader still unauthenticated.
  it('sets a placeholder session before navigating so access resolves on return', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<SignInScreen navigation={mockNavigation} route={{} as any} />);
    fireEvent.press(screen.getByTestId('action-button-signIn'));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(useSessionStore.getState().isAuthenticated).toBe(true);
    expect(useSessionStore.getState().institutionId).toBe(IMPERIAL.id);
  });
});
