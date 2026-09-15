// src/store/sessionStore.test.ts
//
// Four concerns:
//   1. setSession — all fields written, isAuthenticated flips true, expiresAt
//      is an absolute ms timestamp derived from expiresIn.
//   2. clearSession — returns every field to initial state and flips
//      isAuthenticated false; in-flight requests that read the store see no token.
//   3. _authReady — starts false, flipped true by bootstrapAuth once boot-time refresh settles.
//   4. getToken — the expiry buffer (30 s) is the line between "serve this token"
//      and "return undefined so the caller gets a 401 it can refresh through".
//
// sessionStore is NOT persisted — _authReady starts false until bootstrapAuth runs.
import { useSessionStore, getToken, type SessionData } from './sessionStore';

const BASE_SESSION: SessionData = {
  accessToken: 'tok_abc123',
  expiresIn: 3600,
  userId: 'user_1',
  institutionId: 'inst_7f3',
  roles: ['read'],
  collections: ['col_1'],
};

afterEach(() => {
  useSessionStore.getState().clearSession();
  useSessionStore.getState().setAuthReady(false);
});

describe('sessionStore — setSession', () => {
  it('writes all fields and marks the user as authenticated', () => {
    useSessionStore.getState().setSession(BASE_SESSION);

    const state = useSessionStore.getState();
    expect(state.accessToken).toBe('tok_abc123');
    expect(state.userId).toBe('user_1');
    expect(state.institutionId).toBe('inst_7f3');
    expect(state.roles).toEqual(['read']);
    expect(state.collections).toEqual(['col_1']);
    expect(state.isAuthenticated).toBe(true);
  });

  it('sets expiresAt to an absolute ms timestamp in the future', () => {
    const before = Date.now();
    useSessionStore.getState().setSession(BASE_SESSION);
    const after = Date.now();

    const { expiresAt } = useSessionStore.getState();
    // expiresAt = setTime + expiresIn * 1000; setTime is between before and after.
    expect(expiresAt).toBeGreaterThanOrEqual(before + BASE_SESSION.expiresIn * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + BASE_SESSION.expiresIn * 1000);
  });

  it('uses null for institutionId when omitted (individual OIDC user)', () => {
    useSessionStore.getState().setSession({
      ...BASE_SESSION,
      institutionId: undefined,
    });
    expect(useSessionStore.getState().institutionId).toBeNull();
  });
});

describe('sessionStore — clearSession', () => {
  it('resets every field and marks the user as unauthenticated', () => {
    useSessionStore.getState().setSession(BASE_SESSION);
    useSessionStore.getState().clearSession();

    const state = useSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.institutionId).toBeNull();
    expect(state.roles).toEqual([]);
    expect(state.collections).toEqual([]);
    expect(state.isAuthenticated).toBe(false);
  });
});

describe('sessionStore — _authReady', () => {
  // Starts false — tokenRefresh.ts's bootstrapAuth is what flips it, once the
  // boot-time refresh attempt settles either way. A stuck false means a
  // permanent splash screen; a wrongly-true default would let RootNavigator
  // render before boot-time sign-in state is known.
  it('is false by default, before bootstrapAuth has run', () => {
    expect(useSessionStore.getState()._authReady).toBe(false);
  });

  it('flips to true when setAuthReady(true) is called', () => {
    useSessionStore.getState().setAuthReady(true);
    expect(useSessionStore.getState()._authReady).toBe(true);
  });
});

describe('getToken', () => {
  it('returns undefined when there is no token', async () => {
    expect(await getToken()).toBeUndefined();
  });

  it('returns the token when it is well outside the 30-second expiry buffer', async () => {
    useSessionStore.setState({
      accessToken: 'tok_abc123',
      expiresAt: Date.now() + 60_000, // 60 s remaining — safely past the 30-s buffer
    });

    expect(await getToken()).toBe('tok_abc123');
  });

  it('returns undefined when the token expires within 30 seconds (inside the buffer)', async () => {
    useSessionStore.setState({
      accessToken: 'tok_abc123',
      expiresAt: Date.now() + 15_000, // 15 s remaining — inside the buffer
    });

    expect(await getToken()).toBeUndefined();
  });

  it('returns undefined when the token has already expired', async () => {
    useSessionStore.setState({
      accessToken: 'tok_abc123',
      expiresAt: Date.now() - 1_000, // 1 s in the past
    });

    expect(await getToken()).toBeUndefined();
  });

  it('returns undefined when expiresAt is exactly at the buffer boundary', async () => {
    // Condition: Date.now() >= expiresAt - 30_000.
    // At the boundary, expiresAt - 30_000 === Date.now() → >= is satisfied → undefined.
    useSessionStore.setState({
      accessToken: 'tok_abc123',
      expiresAt: Date.now() + 30_000, // exactly 30 s — boundary is inclusive
    });

    expect(await getToken()).toBeUndefined();
  });
});
