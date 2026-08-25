// src/store/sessionStore.ts
// In-memory session — access token, expiry, and user identity.
//
// IN MEMORY, NOT PERSISTED — and this is the contract, not a shortcut.
// The flambeau auth design (§5) is explicit: the access token belongs in the JS
// auth store only. Persisting it to AsyncStorage adds attack surface for a token
// that expires in 15 minutes; the risk is real and the benefit is zero.
//
// The refresh token is the long-lived credential — it goes to expo-secure-store
// via secureStorage.ts, not here. On a cold start, the startup refresh flow reads
// it from secure storage and calls setSession once the new access token arrives.
// That flow is not built yet (depends on POST /api/v1/auth/refresh being live);
// when it lands, _hasHydrated flips false on init and true on completion so
// RootNavigator can gate on it the same way it gates on institutionStore.
//
// TOKEN PROVIDER IS WIRED ONCE AT MODULE LOAD — see the bottom of this file.
// `getToken` always reads the current store state, so a single setLicenceToken
// call handles every sign-in, sign-out, and refresh without touching config/licence.ts
// again. ApiLicenceClient's comment ("a signature that cannot await would have to
// be widened later") is why getToken is async even though reading getState() is not.
import { create } from 'zustand';

import { setLicenceToken } from '@/config/licence';

// 30-second buffer: treat a token expiring within this window as already expired
// so we never hand a request a token that will expire mid-flight.
const EXPIRY_BUFFER_MS = 30_000;

export interface SessionData {
  accessToken: string;
  // Seconds until expiry, as returned by POST /api/v1/auth/token { expiresIn: 900 }.
  // Converted to an absolute timestamp on write so every read is a plain comparison.
  expiresIn: number;
  userId: string;
  // Present for institutional users (SAML), absent for individual users (OIDC).
  institutionId?: string;
  roles: string[];
  collections: string[];
}

interface SessionState {
  accessToken: string | null;
  // Absolute ms timestamp derived from expiresIn at write time. Null when signed out.
  expiresAt: number | null;
  userId: string | null;
  institutionId: string | null;
  roles: string[];
  collections: string[];
  isAuthenticated: boolean;
  // Always true today — no AsyncStorage means no async hydration step. The flag is
  // here so RootNavigator can gate on it when the startup refresh flow lands without
  // needing a store shape change at that point.
  _hasHydrated: boolean;

  setSession: (data: SessionData) => void;
  clearSession: () => void;
  // Called internally by the startup refresh flow when it lands. Not for screens.
  setHasHydrated: (value: boolean) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  accessToken: null,
  expiresAt: null,
  userId: null,
  institutionId: null,
  roles: [],
  collections: [],
  isAuthenticated: false,
  _hasHydrated: true,

  setSession: ({ accessToken, expiresIn, userId, institutionId, roles, collections }) =>
    set({
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      userId,
      institutionId: institutionId ?? null,
      roles,
      collections,
      isAuthenticated: true,
    }),

  // ORDER: clear state first so any in-flight request that reads the store after
  // this returns sees no token, rather than seeing the old one for one more tick.
  clearSession: () =>
    set({
      accessToken: null,
      expiresAt: null,
      userId: null,
      institutionId: null,
      roles: [],
      collections: [],
      isAuthenticated: false,
    }),

  setHasHydrated: (value) => set({ _hasHydrated: value }),
}));

/**
 * Supplies the bearer token to ApiLicenceClient via config/licence.ts.
 *
 * Returns `undefined` (no Authorization header sent) when:
 * - not authenticated (accessToken is null), or
 * - the token is within EXPIRY_BUFFER_MS of expiry or already past it.
 *
 * The second case causes a 401, which the HTTP interceptor (not yet built)
 * will handle by reading the refresh token from secureStorage and rotating.
 */
export function getToken(): Promise<string | undefined> {
  const { accessToken, expiresAt } = useSessionStore.getState();
  if (accessToken === null) return Promise.resolve(undefined);
  if (expiresAt !== null && Date.now() >= expiresAt - EXPIRY_BUFFER_MS) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve(accessToken);
}

// Wire the token provider once at module load. This is the one edit that connects
// the session to the licence client — no further changes needed when the startup
// refresh flow lands or when sign-in is wired up.
setLicenceToken(getToken);
