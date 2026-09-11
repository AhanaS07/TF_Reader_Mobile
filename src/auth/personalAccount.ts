// Personal-account (email/password) sign-in and sign-up — the seam the screens call.
//
// Both are REAL, end to end, against flambeau's own Mongo-backed credential
// store (confirmed against tf_reader_backend_temp's AuthController/
// ReaderAuthService — the vendored flambeau-api.yaml has no signup/login
// section at all, a doc-drift gap of its own).
//
// NOT OIDC. An earlier version of signInWithPassword called
// startOidcSignIn/exchangeOidcTxn (see ApiAuthClient.ts) — those check a
// completely separate identity source, an external OIDC provider, which never
// sees an account signUpWithPassword created. That mismatch produced "email
// and password do not match" for every signup-then-signin attempt. Fixed by
// switching to the login endpoint, the actual counterpart to signup. See
// AUTH_CONTEXT.md's "signup vs OIDC sign-in" update for the full story — OIDC
// sign-in is still implemented and available on ApiAuthClient for a genuine
// external-provider flow, just not what this screen uses.
//
//   signUpWithPassword: POST /api/v1/auth/signup { email, password } — signs
//     the reader in immediately, so a TokenPair comes back directly. Duplicate
//     email refuses with errorCode EMAIL_TAKEN.
//   signInWithPassword: POST /api/v1/auth/login { email, password } — checks
//     the same store signup wrote to. Unknown email and wrong password both
//     refuse identically with errorCode UNAUTHENTICATED (401).
//
// Both then: GET /api/v1/auth/me with the access token, to learn who signed
// in, then write the refresh token to secureStorage (Keychain/Keystore).
// Unlike institutionSignIn.ts, neither writes to sessionStore itself —
// PersonalAccountScreen already owns that call on ok:true.
import type { SessionData } from '@store/sessionStore';
import { saveRefreshToken } from '@store/secureStorage';
import { ApiAuthClient } from './ApiAuthClient';
import { getDefaultAuthClient } from './defaultAuthClient';
import { AuthError, AuthFailure } from './AuthFailure';

export interface PersonalCredentials {
  email: string;
  password: string;
}

// Typed reasons, so the copy is keyed on the code rather than on an HTTP status
// (Design Spec §5.6). This file holds no user-facing strings — the screen maps
// these to sentences.
export type PersonalAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'WEAK_PASSWORD'
  | 'NETWORK'
  | 'UNKNOWN';

export type PersonalAuthResult =
  | { ok: true; session: SessionData }
  | { ok: false; code: PersonalAuthErrorCode };

export interface PersonalSignInDeps {
  authClient?: ApiAuthClient;
}

export async function signInWithPassword(
  credentials: PersonalCredentials,
  deps: PersonalSignInDeps = {},
): Promise<PersonalAuthResult> {
  const authClient = deps.authClient ?? getDefaultAuthClient();

  try {
    const tokenPair = await authClient.login({
      email: credentials.email,
      password: credentials.password,
    });
    console.log('signInWithPassword: token pair received', tokenPair);

    const currentSession = await authClient.getCurrentSession(tokenPair.accessToken);
    console.log('signInWithPassword: current session received', currentSession);

    // NO institutionId, and that is the contract rather than an omission: a personal
    // subscriber belongs to no institution, and sessionStore reads an absent
    // institutionId as exactly that.
    const session: SessionData = {
      accessToken: tokenPair.accessToken,
      expiresIn: tokenPair.expiresIn,
      userId: currentSession.userId,
      institutionId: currentSession.institutionId,
      roles: currentSession.roles,
      collections: currentSession.collections,
    };
    await saveRefreshToken(tokenPair.refreshToken);
    console.log('signInWithPassword: refresh token stored, session is', session);

    return { ok: true, session };
  } catch (error) {
    return { ok: false, code: mapLoginFailure(error) };
  }
}

function mapLoginFailure(error: unknown): PersonalAuthErrorCode {
  if (!(error instanceof AuthFailure)) return 'UNKNOWN';
  if (error.code === AuthError.NETWORK_UNAVAILABLE || error.code === AuthError.TIMEOUT) {
    return 'NETWORK';
  }
  if (error.code === AuthError.REFUSED && error.errorCode === 'UNAUTHENTICATED') {
    return 'INVALID_CREDENTIALS';
  }
  // Covers MALFORMED_RESPONSE and any REFUSED with no/unknown errorCode.
  return 'UNKNOWN';
}

export async function signUpWithPassword(
  credentials: PersonalCredentials,
  deps: PersonalSignInDeps = {},
): Promise<PersonalAuthResult> {
  const authClient = deps.authClient ?? getDefaultAuthClient();

  console.log('signUpWithPassword: starting signup', { email: credentials.email });

  try {
    const tokenPair = await authClient.signUpWithPassword({
      email: credentials.email,
      password: credentials.password,
    });
    console.log('signUpWithPassword: token pair received', tokenPair);

    const currentSession = await authClient.getCurrentSession(tokenPair.accessToken);
    console.log('signUpWithPassword: current session received', currentSession);

    // Same contract as signInWithPassword: no institutionId for a personal subscriber.
    const session: SessionData = {
      accessToken: tokenPair.accessToken,
      expiresIn: tokenPair.expiresIn,
      userId: currentSession.userId,
      institutionId: currentSession.institutionId,
      roles: currentSession.roles,
      collections: currentSession.collections,
    };
    await saveRefreshToken(tokenPair.refreshToken);
    console.log('signUpWithPassword: refresh token stored, session is', session);

    return { ok: true, session };
  } catch (error) {
    const code = mapSignupFailure(error);
    console.log('signUpWithPassword: failed, mapped to', code, error);
    return { ok: false, code };
  }
}

function mapSignupFailure(error: unknown): PersonalAuthErrorCode {
  if (!(error instanceof AuthFailure)) return 'UNKNOWN';
  if (error.code === AuthError.NETWORK_UNAVAILABLE || error.code === AuthError.TIMEOUT) {
    return 'NETWORK';
  }
  if (error.code === AuthError.REFUSED && error.errorCode === 'EMAIL_TAKEN') {
    return 'EMAIL_ALREADY_REGISTERED';
  }
  return 'UNKNOWN';
}
