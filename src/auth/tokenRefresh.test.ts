// src/auth/tokenRefresh.test.ts
//
// ensureFreshToken is the one place that decides whether the current token
// is good enough to hand out, and the one place that calls the refresh
// endpoint when it isn't. Covered here:
//   1. a valid token is returned with no network call at all
//   2. no refresh token stored -> clearSession, no network call
//   3. an expired token with known identity already in the store -> refresh,
//      reuse identity, do NOT call getCurrentSession
//   4. an expired token with no identity yet (the cold-boot case) -> refresh,
//      then getCurrentSession to learn who signed in
//   5. a refusal from either call -> clearSession
//   6. two concurrent calls while a refresh is in flight -> one network call,
//      both callers get the same result (the refresh token rotates, so a
//      second independent refresh would burn the first call's new token)
import { useSessionStore, type SessionData } from '@store/sessionStore';
import { getRefreshToken, saveRefreshToken } from '@store/secureStorage';
import { ensureFreshToken, bootstrapAuth } from './tokenRefresh';
import type { ApiAuthClient } from './ApiAuthClient';

jest.mock('@store/secureStorage', () => ({
  getRefreshToken: jest.fn(),
  saveRefreshToken: jest.fn(),
}));

const mockGetRefreshToken = getRefreshToken as jest.Mock;
const mockSaveRefreshToken = saveRefreshToken as jest.Mock;

const SIGNED_IN_SESSION: SessionData = {
  accessToken: 'stale_token',
  expiresIn: 3600,
  userId: 'user_1',
  institutionId: 'inst_7f3',
  roles: ['read'],
  collections: ['col_1'],
};

function fakeAuthClient(overrides: Partial<ApiAuthClient> = {}): ApiAuthClient {
  const base = {
    refreshSession: jest.fn(),
    getCurrentSession: jest.fn(),
  };
  return { ...base, ...overrides } as unknown as ApiAuthClient;
}

afterEach(() => {
  useSessionStore.getState().clearSession();
  useSessionStore.getState().setAuthReady(false);
  jest.clearAllMocks();
});

describe('ensureFreshToken — valid token', () => {
  it('returns the current token without touching secure storage or the network', async () => {
    useSessionStore.getState().setSession(SIGNED_IN_SESSION);

    const token = await ensureFreshToken();

    expect(token).toBe('stale_token');
    expect(mockGetRefreshToken).not.toHaveBeenCalled();
  });
});

describe('ensureFreshToken — no refresh token stored', () => {
  it('clears the session and makes no network call', async () => {
    mockGetRefreshToken.mockResolvedValue(null);
    const authClient = fakeAuthClient();

    const token = await ensureFreshToken({ authClient });

    expect(token).toBeUndefined();
    expect(useSessionStore.getState().isAuthenticated).toBe(false);
    expect(authClient.refreshSession).not.toHaveBeenCalled();
  });
});

describe('ensureFreshToken — refresh with known identity', () => {
  it('reuses the existing identity and updates only the token fields', async () => {
    useSessionStore.getState().setSession(SIGNED_IN_SESSION);
    useSessionStore.setState({ expiresAt: Date.now() - 1000 }); // force expired
    mockGetRefreshToken.mockResolvedValue('old_refresh_token');
    const authClient = fakeAuthClient({
      refreshSession: jest.fn().mockResolvedValue({
        accessToken: 'new_token',
        refreshToken: 'new_refresh_token',
        expiresIn: 900,
      }),
    });

    const token = await ensureFreshToken({ authClient });

    expect(token).toBe('new_token');
    const state = useSessionStore.getState();
    expect(state.accessToken).toBe('new_token');
    expect(state.userId).toBe('user_1');
    expect(state.institutionId).toBe('inst_7f3');
    expect(authClient.getCurrentSession).not.toHaveBeenCalled();
    expect(mockSaveRefreshToken).toHaveBeenCalledWith('new_refresh_token');
  });
});

describe('ensureFreshToken — refresh with no identity yet (cold boot)', () => {
  it('fetches identity via getCurrentSession and populates the session', async () => {
    mockGetRefreshToken.mockResolvedValue('stored_refresh_token');
    const authClient = fakeAuthClient({
      refreshSession: jest.fn().mockResolvedValue({
        accessToken: 'new_token',
        refreshToken: 'new_refresh_token',
        expiresIn: 900,
      }),
      getCurrentSession: jest.fn().mockResolvedValue({
        userId: 'user_9',
        type: 'INDIVIDUAL',
        roles: ['read'],
        collections: ['col_2'],
      }),
    });

    const token = await ensureFreshToken({ authClient });

    expect(token).toBe('new_token');
    const state = useSessionStore.getState();
    expect(state.userId).toBe('user_9');
    expect(state.collections).toEqual(['col_2']);
    expect(authClient.getCurrentSession).toHaveBeenCalledWith('new_token');
  });
});

describe('ensureFreshToken — refresh fails', () => {
  it('clears the session when refreshSession is refused', async () => {
    mockGetRefreshToken.mockResolvedValue('stored_refresh_token');
    const authClient = fakeAuthClient({
      refreshSession: jest.fn().mockRejectedValue(new Error('refused')),
    });

    const token = await ensureFreshToken({ authClient });

    expect(token).toBeUndefined();
    expect(useSessionStore.getState().isAuthenticated).toBe(false);
  });
});

describe('ensureFreshToken — concurrent calls', () => {
  it('shares one in-flight refresh between two simultaneous callers', async () => {
    mockGetRefreshToken.mockResolvedValue('stored_refresh_token');
    let resolveRefresh: (value: unknown) => void = () => {};
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const authClient = fakeAuthClient({
      refreshSession: jest.fn().mockReturnValue(refreshPromise),
      getCurrentSession: jest.fn().mockResolvedValue({
        userId: 'user_9',
        type: 'INDIVIDUAL',
        roles: [],
        collections: [],
      }),
    });

    const firstCall = ensureFreshToken({ authClient });
    const secondCall = ensureFreshToken({ authClient });

    resolveRefresh({ accessToken: 'new_token', refreshToken: 'new_refresh_token', expiresIn: 900 });
    const [firstToken, secondToken] = await Promise.all([firstCall, secondCall]);

    expect(firstToken).toBe('new_token');
    expect(secondToken).toBe('new_token');
    expect(authClient.refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('bootstrapAuth', () => {
  it('sets authReady to true when there is nothing to refresh', async () => {
    mockGetRefreshToken.mockResolvedValue(null);

    await bootstrapAuth();

    expect(useSessionStore.getState()._authReady).toBe(true);
  });

  it('sets authReady to true even when the refresh fails', async () => {
    mockGetRefreshToken.mockResolvedValue('stored_refresh_token');
    const authClient = fakeAuthClient({
      refreshSession: jest.fn().mockRejectedValue(new Error('refused')),
    });

    await bootstrapAuth({ authClient });

    expect(useSessionStore.getState()._authReady).toBe(true);
  });
});
