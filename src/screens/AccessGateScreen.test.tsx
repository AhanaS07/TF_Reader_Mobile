// src/screens/AccessGateScreen.test.tsx
// Screen 03. No fetch happens here — the item's display data arrives via
// route params from whichever screen raised the gate (ItemDetailScreen), so
// unlike most screen tests there is no fake DataSource to inject.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen } from '@testing-library/react-native';

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

    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'SignIn' });
  });

  it('navigates to InstitutionList when no institution is selected', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Through my institution'));

    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'InstitutionList' });
  });
});

describe('AccessGateScreen personal account option', () => {
  it('renders the personal account card', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByText('Personal account')).toBeTruthy();
    expect(screen.getByText('Sign in with email')).toBeTruthy();
  });

  // Shown, not hidden — index.html: "screen 03's second option is reopened
  // rather than settled." No destination exists to navigate to.
  it('exposes a disabled accessibility state', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    expect(screen.getByLabelText('Personal account').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('does not navigate when pressed', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not create a pending intent when pressed', async () => {
    await render(<AccessGateScreen {...makeProps()} />);

    fireEvent.press(screen.getByLabelText('Personal account'));

    expect(usePendingIntentStore.getState().pending).toBeNull();
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
