// src/auth/tokenRefresh.ts
// Keeps the access token fresh two ways: reactively, on demand right before
// an authenticated call needs one (ensureFreshToken), and proactively, once
// at app boot (bootstrapAuth). Both go through ensureFreshToken so there is
// exactly one place that decides whether a refresh is worth making and
// exactly one place that calls the refresh endpoint.
import { getToken, useSessionStore } from '@store/sessionStore';
import { getRefreshToken, saveRefreshToken } from '@store/secureStorage';
import { setLicenceToken } from '@/config/licence';
import { getDefaultAuthClient } from './defaultAuthClient';
import type { ApiAuthClient, TokenPair } from './ApiAuthClient';

export interface EnsureFreshTokenDeps {
  authClient?: ApiAuthClient;
}

// Concurrent callers (an auth-dependent call and a licence call landing in
// the same tick, say) must share one in-flight refresh rather than each
// starting their own. The refresh token always rotates, so a second,
// independent refresh would hand the endpoint a refresh token the first
// call already burned — that gets refused, and clears a session that was
// actually fine seconds earlier.
let inFlightRefresh: Promise<string | undefined> | null = null;

export async function ensureFreshToken(
  deps: EnsureFreshTokenDeps = {},
): Promise<string | undefined> {
  const currentToken = await getToken();
  if (currentToken !== undefined) {
    console.log('ensureFreshToken: current token is still valid, no refresh needed');
    return currentToken;
  }

  if (inFlightRefresh !== null) {
    console.log('ensureFreshToken: a refresh is already in flight, waiting on it');
    return inFlightRefresh;
  }

  console.log('ensureFreshToken: token missing/expired, starting a refresh');
  inFlightRefresh = refreshFromStoredToken(deps);
  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

async function refreshFromStoredToken(
  deps: EnsureFreshTokenDeps,
): Promise<string | undefined> {
  const storedRefreshToken = await getRefreshToken();
  if (storedRefreshToken === null) {
    console.log('ensureFreshToken: no refresh token in secure storage, clearing session');
    useSessionStore.getState().clearSession();
    return undefined;
  }

  const authClient = deps.authClient ?? getDefaultAuthClient();

  try {
    const tokenPair = await authClient.refreshSession(storedRefreshToken);
    console.log('ensureFreshToken: refresh succeeded, new token expires in', tokenPair.expiresIn, 's');
    await applyRefreshedToken(tokenPair, authClient);
    return tokenPair.accessToken;
  } catch (error) {
    console.log('ensureFreshToken: refresh was refused, clearing session', error);
    useSessionStore.getState().clearSession();
    return undefined;
  }
}

// refreshSession() returns only {accessToken, refreshToken, expiresIn} — no
// identity. If the store already knows who's signed in (the normal
// in-session case), reuse that identity rather than asking again. Identity
// is only ever missing right after a cold boot, before anything has loaded
// it this process — that's the one case worth an extra getCurrentSession call.
async function applyRefreshedToken(
  tokenPair: TokenPair,
  authClient: ApiAuthClient,
): Promise<void> {
  const existing = useSessionStore.getState();

  if (existing.userId !== null) {
    const institutionId = existing.institutionId === null ? undefined : existing.institutionId;
    useSessionStore.getState().setSession({
      accessToken: tokenPair.accessToken,
      expiresIn: tokenPair.expiresIn,
      userId: existing.userId,
      institutionId,
      roles: existing.roles,
      collections: existing.collections,
    });
  } else {
    const currentSession = await authClient.getCurrentSession(tokenPair.accessToken);
    useSessionStore.getState().setSession({
      accessToken: tokenPair.accessToken,
      expiresIn: tokenPair.expiresIn,
      userId: currentSession.userId,
      institutionId: currentSession.institutionId,
      roles: currentSession.roles,
      collections: currentSession.collections,
    });
  }

  await saveRefreshToken(tokenPair.refreshToken);
}

export interface BootstrapAuthDeps {
  authClient?: ApiAuthClient;
}

export async function bootstrapAuth(deps: BootstrapAuthDeps = {}): Promise<void> {
  // Wired here, not at module scope: a bare top-level setLicenceToken(...)
  // call used to run the instant ANYTHING imported this file — including
  // tests with no interest in auth at all, which mock '@config/licence' for
  // their own reasons and don't supply setLicenceToken in that mock, and
  // crashed on import as a result. Calling it here means it only ever runs
  // when bootstrapAuth is actually invoked (real app boot, or a test that
  // deliberately calls it), and it's idempotent — safe to call every time
  // bootstrapAuth runs, which is once, at app start.
  setLicenceToken(ensureFreshToken);

  console.log('bootstrapAuth: starting boot-time token check');
  await ensureFreshToken(deps);
  console.log('bootstrapAuth: done, isAuthenticated =', useSessionStore.getState().isAuthenticated);
  useSessionStore.getState().setAuthReady(true);
}
