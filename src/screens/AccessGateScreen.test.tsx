// src/screens/AccessGateScreen.test.tsx
// Screen 03. No fetch happens here — the item's display data arrives via
// route params from whichever screen raised the gate (ItemDetailScreen), so
// unlike most screen tests there is no fake DataSource to inject.
//
// `await render(...)` is required — RTL 14's render is async.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore } from '@store/pendingIntentStore';
import type { Institution } from '@model/institution';

import AccessGateScreen from './AccessGateScreen';

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

function makeProps(over: Partial<{ itemId: string; title: string; authors: string }> = {}) {
  return {
    route: {
      params: {
        itemId: 'item_42',
        title: 'Rights for Robots',
        authors: 'Joshua C. Gellers',
        ...over,
      },
    },
    navigation: { navigate: mockNavigate, goBack: mockGoBack },
  };
}

afterEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockUseNetworkStatus.mockReturnValue(true);
  useInstitutionStore.setState({ selectedInstitution: null, recentlyUsedIds: [] });
  usePendingIntentStore.setState({ pending: null });
});

describe('AccessGateScreen content', () => {
  it('renders the item title', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByText('Rights for Robots')).toBeTruthy();
  });

  it('renders the authors', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByText('Joshua C. Gellers')).toBeTruthy();
  });

  // No journal, volume or issue — neither field exists on the model or in
  // either contract. See the code comment above the item block.
  it('does not crash, and still renders the title, when authors is empty', async () => {
    await render(<AccessGateScreen {...makeProps({ authors: '' })} />);

    expect(screen.getByText('Rights for Robots')).toBeTruthy();
  });
});

describe('AccessGateScreen institution option', () => {
  it('renders the institution card', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByText('Through my institution')).toBeTruthy();
    expect(screen.getByText('Sign in via SAML/SSO')).toBeTruthy();
  });

  it('stores the correct pending intent when an institution is selected', async () => {
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(usePendingIntentStore.getState().pending).toMatchObject({
      action: 'read',
      itemId: 'item_42',
      institutionId: 'inst_7f3',
    });
  });

  // `institutionId: null` is a real value on `PendingIntent`, matching
  // `AccessResult` — not missing data, the public open-access path.
  it('stores institutionId null when no institution is selected', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(usePendingIntentStore.getState().pending).toMatchObject({
      action: 'read',
      itemId: 'item_42',
      institutionId: null,
    });
  });

  it('navigates to SignIn when an institution is already selected', async () => {
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  // AccessGate must not stay mounted underneath SignIn — see review follow-up.
  it('dismisses AccessGate before navigating to SignIn', async () => {
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  it('navigates to InstitutionList when no institution is selected', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockNavigate).toHaveBeenCalledWith('InstitutionList');
  });

  // Nothing to dismiss yet at the moment of the tap — the screen is still
  // waiting on a selection. See the test below for what happens once one lands.
  it('does not dismiss AccessGate when no institution is selected', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockGoBack).not.toHaveBeenCalled();
  });

  // No second tap needed — the effect notices the selection landing in the
  // store and continues on its own, rather than requiring the reader to press
  // "Through my institution" again once they're back on this screen.
  it('continues on to SignIn once an institution is selected, without a second tap', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    await fireEvent.press(screen.getByLabelText('Through my institution'));
    expect(mockNavigate).toHaveBeenCalledWith('InstitutionList');
    mockNavigate.mockClear();

    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  // Dismissing first must cancel the wait — otherwise picking an institution
  // later some other way (e.g. Profile) would yank the reader into a stray
  // SignIn sheet for an item they already walked away from.
  it('does not continue to SignIn after being dismissed, even if a selection lands later', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    await fireEvent.press(screen.getByLabelText('Through my institution'));
    await fireEvent.press(screen.getByText("I'll decide later"));
    mockNavigate.mockClear();
    mockGoBack.mockClear();

    await act(async () => {
      useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('renders a trailing chevron on the institution card', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByTestId('access-gate-institution-chevron')).toBeTruthy();
  });
});

// This card was drawn disabled and inert while B2C had no destination. The
// personal-account form is that destination, so the four tests that pinned the
// inert behaviour now pin the wired behaviour instead.
describe('AccessGateScreen personal account option', () => {
  it('renders the personal account card', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByText('Personal account')).toBeTruthy();
    expect(screen.getByText('Sign in with email and password')).toBeTruthy();
  });

  it('is a button now that it has somewhere to go', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByLabelText('Personal account').props.accessibilityRole).toBe('button');
  });

  it('dismisses the sheet, then opens the sign-in form', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    // Dismiss first, or this sheet stays mounted underneath the form.
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('PersonalAccount', { mode: 'signIn' });
  });

  // Without this the reader signs in and lands back on the catalogue rather than
  // on the item that raised the gate.
  it('records a read intent for the item that raised the gate', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    expect(usePendingIntentStore.getState().pending).toMatchObject({
      action: 'read',
      itemId: 'item_42',
    });
  });

  // The intent's institution is the CONTEXT THE ITEM WAS FOUND IN, not a claim
  // about how the reader signs in — pendingIntentStore: "the same title resolves
  // differently per institution, so resuming in the wrong one would replay the
  // intent against different access rules." So it records the selection even on
  // the personal path, exactly as the institution path does.
  it('records the browsing institution, not null, on the personal path', async () => {
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    expect(usePendingIntentStore.getState().pending?.institutionId).toBe('inst_7f3');
  });

  it('is disabled while offline', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders a trailing chevron', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByTestId('access-gate-personal-account-chevron')).toBeTruthy();
  });
});

describe('AccessGateScreen — I\'ll decide later', () => {
  it('calls goBack', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByText("I'll decide later"));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('does not create a pending intent', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByText("I'll decide later"));

    expect(usePendingIntentStore.getState().pending).toBeNull();
  });
});

describe('AccessGateScreen offline', () => {
  it('shows the offline banner', async () => {
    mockUseNetworkStatus.mockReturnValue(false);

    await render(<AccessGateScreen {...makeProps()} />);

    expect(
      screen.getByText("You're offline. Institutional sign-in needs a connection."),
    ).toBeTruthy();
  });

  it('renders no offline banner while online', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(
      screen.queryByText("You're offline. Institutional sign-in needs a connection."),
    ).toBeNull();
  });

  it('disables the institution option while offline', async () => {
    mockUseNetworkStatus.mockReturnValue(false);

    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByLabelText('Through my institution').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  // SAML sign-in leaves the app for a browser — offering a button that
  // cannot work is the false affordance this codebase avoids elsewhere.
  it('does not navigate or store an intent when the institution option is pressed offline', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    useInstitutionStore.setState({ selectedInstitution: IMPERIAL });

    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(usePendingIntentStore.getState().pending).toBeNull();
  });
});
