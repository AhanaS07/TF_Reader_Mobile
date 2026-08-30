// Personal-account (OIDC) sign-in and sign-up — the seam the screens call.
//
// STUB: no request is made yet. PersonalAccountScreen imports these two functions
// and no HTTP client at all, so wiring the real endpoints is an edit to THIS FILE
// ALONE — replace the bodies, keep the signatures and the result shape.
//
// flambeau has not published a username/password route yet (their
// `/auth/oidc/start` is a browser redirect). Whichever route lands has to answer
// the same two questions this shape already asks: did it work, and if not, why.
import type { SessionData } from '@store/sessionStore';

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

// NO institutionId, and that is the contract rather than an omission: a personal
// subscriber belongs to no institution, and sessionStore reads an absent
// institutionId as exactly that. Any string here would scope the catalogue to an
// institution the reader has no entitlement to.
//
// `userId` carries the email because AuthMeResponse has no name or email field to
// read — see the note at the top of ProfileScreen. It is the identifier the reader
// recognises, standing in until flambeau publishes a display name.
function stubSession(email: string): SessionData {
  return {
    accessToken: `stub-personal:${email}`,
    expiresIn: 3600,
    userId: email,
    roles: [],
    collections: [],
  };
}

/**
 * STUB — succeeds for any credentials that passed the client-side rules. The
 * failure branches in `PersonalAuthErrorCode` are unreachable until a real
 * request replaces this body; the screen handles them already.
 */
export function signInWithPassword(
  credentials: PersonalCredentials,
): Promise<PersonalAuthResult> {
  return Promise.resolve({ ok: true, session: stubSession(credentials.email) });
}

/**
 * STUB — as `signInWithPassword`. Kept as a separate function rather than a flag
 * because the real routes will be two different endpoints with two different
 * failure sets, and a boolean would have to be unpicked again at that point.
 */
export function signUpWithPassword(
  credentials: PersonalCredentials,
): Promise<PersonalAuthResult> {
  return Promise.resolve({ ok: true, session: stubSession(credentials.email) });
}
