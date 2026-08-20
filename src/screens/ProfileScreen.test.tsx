// src/screens/ProfileScreen.test.tsx
// Screen 10 — profile and settings.
//
// WHAT IS NOT TESTED HERE, AND WHY: there is no `/auth/me` call to assert on.
// The endpoint has a contract (`docs/contracts/flambeau-api.yaml`) but no client
// in this repo, no session store behind it, and its `AuthMeResponse` carries no
// name, email or avatar to render — see the header comment on ProfileScreen.tsx.
// A test for it would be a test of an invention.
//
// `await render(...)` is required — RTL 14's render is async. See App.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Institution } from '@model/institution';
import { useInstitutionStore } from '@store/institutionStore';

import ProfileScreen from './ProfileScreen';

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock". Same shape
// as CatalogueScreen.test.tsx and SearchScreen.test.tsx.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const OXFORD: Institution = {
  id: 'inst_7f3',
  name: 'University of Oxford',
  country: 'United Kingdom',
  code: 'OXF',
  city: 'Oxford',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

// Same institution with no branding asset — W-17's initials fallback.
const NO_CREST: Institution = {
  id: 'inst_a21',
  name: 'Deakin University',
  country: 'Australia',
  code: 'DKN',
  city: 'Melbourne',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_a21/catalogue',
};

function selectInstitution(institution: Institution | null) {
  useInstitutionStore.setState({
    selectedInstitution: institution,
    recentlyUsedIds: institution === null ? [] : [institution.id],
  });
}

beforeEach(() => {
  selectInstitution(OXFORD);
});

afterEach(() => {
  mockNavigate.mockClear();
  useInstitutionStore.setState({ selectedInstitution: null, recentlyUsedIds: [] });
});

describe('ProfileScreen institution, from the store', () => {
  it('renders the selected institution name', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByText('University of Oxford')).toBeTruthy();
  });

  it('renders the crest when the institution has branding', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByLabelText('University of Oxford logo')).toBeTruthy();
  });

  it('falls back to initials when the institution has no crest', async () => {
    selectInstitution(NO_CREST);
    await render(<ProfileScreen />);
    expect(screen.queryByLabelText('Deakin University logo')).toBeNull();
    expect(screen.getByText('DU')).toBeTruthy();
  });

  it('offers the picker instead when no institution is selected', async () => {
    selectInstitution(null);
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Select institution' })).toBeTruthy();
    expect(screen.queryByText('University of Oxford')).toBeNull();
  });
});

describe('ProfileScreen change institution', () => {
  // Screen 06 is `InstitutionList` in the Catalogue stack — the route
  // CatalogueScreen's own picker pushes. Asserted by name so a rename in
  // navigation/types.ts cannot silently strand this row.
  it('pushes screen 06 from the Change institution row', async () => {
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Change institution' }));
    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'InstitutionList' });
  });

  it('pushes screen 06 from the institution row itself', async () => {
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'University of Oxford' }));
    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'InstitutionList' });
  });

  it('pushes screen 06 from the empty-state row', async () => {
    selectInstitution(null);
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Select institution' }));
    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'InstitutionList' });
  });
});

describe('ProfileScreen sign out', () => {
  it('drops the institution selection and lands on the catalogue', async () => {
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(useInstitutionStore.getState().selectedInstitution).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('Catalogue', { screen: 'CatalogueHome' });
  });

  it('leaves the recently-used list alone — it is a device history, not a session', async () => {
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_7f3']);
  });

  it('is not offered when there is nothing to sign out of', async () => {
    selectInstitution(null);
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});

describe('ProfileScreen rows with nothing behind them', () => {
  // Drawn, not dropped — the screen 12 rule. Each is announced as disabled so a
  // screen reader gets the same answer the greying gives a sighted reader.
  const UNAVAILABLE = [
    'Reading Preferences',
    'Download Settings',
    'Privacy & Security',
    'About T&F Reader',
  ];

  it.each(UNAVAILABLE)('renders %s and announces it as disabled', async (title) => {
    await render(<ProfileScreen />);
    const row = screen.getByRole('button', { name: title });
    expect(row.props.accessibilityState.disabled).toBe(true);
  });

  it('renders Notifications as a disabled toggle', async () => {
    await render(<ProfileScreen />);
    const row = screen.getByRole('switch', { name: 'Notifications' });
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  it('navigates nowhere when a disabled row is tapped', async () => {
    await render(<ProfileScreen />);
    for (const title of UNAVAILABLE) {
      fireEvent.press(screen.getByRole('button', { name: title }));
    }
    fireEvent.press(screen.getByRole('switch', { name: 'Notifications' }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('ProfileScreen developer entry', () => {
  // `__DEV__` is a global under Jest rather than an inlined constant, so both
  // sides of the branch are reachable here. In a release bundle Metro replaces
  // it with `false` and drops the branch outright — which is the guarantee, and
  // the half a test cannot observe.
  const globalWithDev = globalThis as typeof globalThis & { __DEV__: boolean };

  afterEach(() => {
    globalWithDev.__DEV__ = true;
  });

  it('offers the State Gallery in a dev build', async () => {
    globalWithDev.__DEV__ = true;
    await render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'State Gallery' }));
    expect(mockNavigate).toHaveBeenCalledWith('Gallery');
  });

  it('renders no gallery entry when __DEV__ is false', async () => {
    globalWithDev.__DEV__ = false;
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'State Gallery' })).toBeNull();
    expect(screen.queryByText('Developer')).toBeNull();
  });
});
