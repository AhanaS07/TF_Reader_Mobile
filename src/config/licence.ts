// src/config/licence.ts
// The ONE place Mock vs Api is chosen for the licence calls.
//
// Same principle as config/catalogue.ts, and separate from it on purpose: the catalogue
// is wokay's and the licence calls are flambeau's, and the two backends will not become
// real on the same day. flambeau have built two of six; wokay's catalogue endpoints
// arrive Week 3 at the earliest. One switch for both would force a choice nobody wants
// to make — real licences against fixture books, or the reverse.
//
// No `if (__DEV__)` and no `useMock` anywhere above this file.
import { ApiLicenceClient, MockLicenceClient, type LicenceSource } from '@/licence';

export type LicenceSourceKind = 'mock' | 'api';

// Named only for error messages. THE READS BELOW USE THE LITERALS, and that is not
// lint-appeasement: Expo's babel plugin replaces `process.env.EXPO_PUBLIC_*` with the
// value at BUILD time by matching the text. A dynamic `process.env[SOME_VAR]` is not
// matched, so it survives into the bundle as a lookup on an object that is not there and
// evaluates to `undefined` — silently, and only in a production build.
//
// For this file that would mean a release build ignoring `api` and using the mock: a
// reader shown a borrow that never happened. `resolveLicenceSourceKind` throws on a typo
// precisely to stop that, and a dynamic read would walk straight around it.
const ENV_VAR = 'EXPO_PUBLIC_LICENCE_SOURCE';
const BASE_URL_VAR = 'EXPO_PUBLIC_FLAMBEAU_BASE_URL';

/**
 * Interprets the configured source kind.
 *
 * Throws on an unrecognised value rather than defaulting, for the reason
 * config/catalogue.ts gives: a typo that quietly fell back to `mock` produces a build
 * that looks fine, talks to nothing, and would show a reader a borrow that never
 * happened.
 */
export function resolveLicenceSourceKind(raw: string | undefined): LicenceSourceKind {
  // Unset is not a mistake. Mock is correct while four of the six calls do not exist.
  if (raw === undefined || raw.trim() === '') return 'mock';

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'mock' || normalized === 'api') return normalized;

  throw new Error(
    `${ENV_VAR} must be 'mock' or 'api', got '${raw}'. Leave it unset to use the mock.`,
  );
}

export interface LicenceSourceDeps {
  // Where the bearer token comes from. Defaults to "no token", which is honest rather
  // than convenient: the session store is Keshav's and unbuilt, so until it lands the
  // real client should send no Authorization header and take flambeau's 401 — not send
  // a fabricated one and get a subtler failure.
  getToken?: () => Promise<string | undefined>;
  // Items with no free copies, so `borrow` refuses and the queue becomes reachable.
  // Mock only, ignored for `api`. Without one of these the Elite sequence cannot be
  // demonstrated at all, because every borrow succeeds.
  contendedItems?: string[];
}

let cached: LicenceSource | undefined;

/**
 * The app's licence source. One instance, because `MockLicenceClient` holds state — a
 * second one would forget the loan the first just wrote, and the Elite sequence would
 * come apart between two screens.
 */
export function getLicenceSource(deps: LicenceSourceDeps = {}): LicenceSource {
  if (cached !== undefined) return cached;

  const kind = resolveLicenceSourceKind(process.env.EXPO_PUBLIC_LICENCE_SOURCE);

  if (kind === 'mock') {
    cached = new MockLicenceClient({
      // A default so the flow is demonstrable out of the box. Overridable, and it has
      // to line up with an ELITE title in the catalogue fixtures to be reachable.
      contendedItems: deps.contendedItems ?? ['item_42'],
    });
    return cached;
  }

  const baseUrl = process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new Error(`${BASE_URL_VAR} must be set when ${ENV_VAR} is 'api'.`);
  }

  cached = new ApiLicenceClient({
    baseUrl,
    getToken: deps.getToken ?? (async () => undefined),
  });
  return cached;
}

/** Drops the cached instance. Tests only — it is how one test's loans stay out of the next. */
export function resetLicenceSource(): void {
  cached = undefined;
}
