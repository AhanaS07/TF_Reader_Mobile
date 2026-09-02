// src/store/sessionStore.ts
// In-memory session — access token, expiry, and user identity.
//
// IN MEMORY, NOT PERSISTED — and this is the contract, not a shortcut.
// The flambeau auth design (§5) is explicit: the access token belongs in the JS
// auth store only. Persisting it to AsyncStorage adds attack surface for a token
// that expires in 15 minutes; the risk is real and the benefit is zero.
//
// The refresh token is the long-lived credential — it goes to expo-secure-store
// via secureStorage.ts, not here. On a cold start, tokenRefresh.ts's bootstrapAuth
// reads it from secure storage and calls setSession once a new access token
// arrives (or clearSession if there's no valid refresh token). _authReady starts
// false and bootstrapAuth flips it true once that attempt settles, either way,
// so RootNavigator can gate on it the same way it gates on institutionStore.
import { create } from 'zustand';

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
  // False until tokenRefresh.ts's bootstrapAuth has run once, at app boot.
  _authReady: boolean;

  setSession: (data: SessionData) => void;
  clearSession: () => void;
  // Called internally by bootstrapAuth once the boot-time refresh settles.
  setAuthReady: (value: boolean) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  accessToken: null,
  expiresAt: null,
  userId: null,
  institutionId: null,
  roles: [],
  collections: [],
  isAuthenticated: false,
  _authReady: false,

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

  setAuthReady: (value) => set({ _authReady: value }),
}));

/**
 * Reads the current access token, applying the expiry buffer.
 *
 * Returns `undefined` (meaning "not usable, refresh it") when:
 * - not authenticated (accessToken is null), or
 * - the token is within EXPIRY_BUFFER_MS of expiry or already past it.
 *
 * tokenRefresh.ts's ensureFreshToken is what acts on an `undefined` result —
 * this function only reads the store, it never refreshes anything itself.
 */
export function getToken(): Promise<string | undefined> {
  const { accessToken, expiresAt } = useSessionStore.getState();
  if (accessToken === null) return Promise.resolve(undefined);
  if (expiresAt !== null && Date.now() >= expiresAt - EXPIRY_BUFFER_MS) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve(accessToken);
}
