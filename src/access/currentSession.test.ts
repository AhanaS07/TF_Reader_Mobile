// src/access/currentSession.test.ts
// useIsSignedIn is the plain "is anyone signed in" check for screens that
// aren't about catalogue-item access — useCurrentSession/resolveAccess cover
// that separately and are exercised via each screen's own test file.
import { act, renderHook } from '@testing-library/react-native';

import { useSessionStore } from '@store/sessionStore';
import { useIsSignedIn } from './currentSession';

afterEach(() => {
  useSessionStore.getState().clearSession();
});

describe('useIsSignedIn', () => {
  it('is false when no one is signed in', async () => {
    const { result } = await renderHook(() => useIsSignedIn());

    expect(result.current).toBe(false);
  });

  it('is true once a session is set', async () => {
    const { result } = await renderHook(() => useIsSignedIn());

    await act(async () => {
      useSessionStore.getState().setSession({
        accessToken: 'tok',
        expiresIn: 900,
        userId: 'user_1',
        roles: [],
        collections: [],
      });
    });

    expect(result.current).toBe(true);
  });
});
