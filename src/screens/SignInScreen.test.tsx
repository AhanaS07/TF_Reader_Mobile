// src/screens/SignInScreen.test.tsx
// Screen 02. Scope: the pending-intent replay wired into the sign-in stub
// (see the comment above `handleSignIn` in SignInScreen.tsx for why this is
// a replay of the stub's own "tap = signed in" behaviour, not a real
// token-received event). Full screen coverage — loading/error/offline
// states — is a separate, larger gap tracked outside this change.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { useInstitutionStore } from '@store/institutionStore';
import { usePendingIntentStore, INTENT_MAX_AGE_MS } from '@store/pendingIntentStore';
import type { Institution } from '@model/institution';

import SignInScreen from './SignInScreen';

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

// Only `navigation.navigate`/`goBack` are ever read, so the rest of the
// typed NativeStackScreenProps navigation object is cast rather than
// constructed — same convention as InstitutionDetailScreen.test.tsx.
type SignInProps = {
  navigation: { navigate: jest.Mock; goBack: jest.Mock };
};

function makeProps() {
  return {
    navigation: { navigate: mockNavigate, goBack: mockGoBack },
  } as unknown as Parameters<typeof SignInScreen>[0] & SignInProps;
}

beforeEach(() => {
  useInstitutionStore.setState({ selectedInstitution: IMPERIAL, recentlyUsedIds: [] });
});

afterEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useInstitutionStore.setState({ selectedInstitution: null, recentlyUsedIds: [] });
  usePendingIntentStore.setState({ pending: null });
});

describe('SignInScreen pending-intent replay', () => {
  it('resumes ItemDetail when a pending intent exists', async () => {
    usePendingIntentStore.setState({
      pending: {
        action: 'read',
        itemId: 'item_42',
        institutionId: 'inst_7f3',
        createdAt: Date.now(),
      },
    });

    await render(<SignInScreen {...makeProps()} />);

    fireEvent.press(screen.getByText('Sign in with institution'));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('falls back to goBack when no intent is pending', async () => {
    await render(<SignInScreen {...makeProps()} />);

    fireEvent.press(screen.getByText('Sign in with institution'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls back to goBack when the pending intent is stale', async () => {
    usePendingIntentStore.setState({
      pending: {
        action: 'read',
        itemId: 'item_42',
        institutionId: 'inst_7f3',
        createdAt: Date.now() - INTENT_MAX_AGE_MS - 1,
      },
    });

    await render(<SignInScreen {...makeProps()} />);

    fireEvent.press(screen.getByText('Sign in with institution'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
