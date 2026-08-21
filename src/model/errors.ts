// src/model/errors.ts
// Catalogue failures — the adapter layer's rejection carrier.
//
// WHY THIS EXISTS ALONGSIDE shared/contracts/errors.ts (read before merging the
// two — they are deliberately separate):
//
//   ContentFailure is FAIL-CLOSED and keyed by bookId. Every one of its codes
//   means "a decrypt or licence check failed, render NOTHING" — showing stale or
//   partial output there is a security bug, and retrying is pointless.
//
//   Catalogue failures are the opposite shape: they are RECOVERABLE and not
//   necessarily about a book at all. A dropped connection fetching a shelf
//   listing should show a retry affordance, and getHomeCatalogue has no bookId
//   to key on. Forcing these through ContentFailure would mean either inventing
//   a fake bookId or widening a frozen security type to be laxer — so this is a
//   sibling, intentionally not a subclass.
//
// The carrier PATTERN is copied exactly (Error subclass, typed `.code`
// discriminant, `.cause`, prototype fixup) so catch sites read identically
// whichever layer threw.

// String-valued so the code survives logging, crash reports and the sync wire.
export enum CatalogueError {
  // No such institution, shelf or publication. The request was well-formed and
  // the server understood it — the thing simply is not there. Distinct from
  // MALFORMED_FEED: nothing is broken, so this is a normal empty-state, not a bug.
  NOT_FOUND = 'NOT_FOUND',

  // Offline, DNS failure, or an unreachable host. RETRYABLE and expected on
  // mobile — this is the code the UI turns into "you appear to be offline".
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',

  // The response parsed as JSON but violates the OPDS shape we require: a
  // publication with no acquisition link, an unrecognised encryption algorithm,
  // a missing title. LOUD BY DESIGN — normalizing a feed we do not understand
  // would surface later as a blank screen with no explanation, so it fails at
  // the boundary instead. Always a bug in the feed or in our normalizer.
  MALFORMED_FEED = 'MALFORMED_FEED',

  // The request exceeded its deadline. Retryable, kept separate from
  // NETWORK_UNAVAILABLE because a slow server and no connection call for
  // different copy and different retry behaviour.
  TIMEOUT = 'TIMEOUT',

  // getItemsBatch was asked for more than 100 ids in one call — checked
  // client-side before the request goes out, and mapped from the server's
  // own 400 TOO_MANY_IDS if it ever disagrees with our cap.
  TOO_MANY_IDS = 'TOO_MANY_IDS',
}

// What every CatalogueSource method rejects with. Never reject with a bare
// CatalogueError: it is a string, so it loses the stack, fails `instanceof Error`
// and carries no context to the catch site.
//
// This is a real runtime class — import it as a VALUE, not with `import type`.
export class CatalogueFailure extends Error {
  readonly code: CatalogueError;
  // What was being fetched: an institution, shelf or publication id, or a URL.
  // Free-form because the three methods key on different things, and optional
  // because a malformed home catalogue has no single id to blame.
  readonly target?: string;
  readonly cause?: unknown;

  constructor(code: CatalogueError, target?: string, cause?: unknown) {
    super(target ? `${code} for ${target}` : code);
    this.name = 'CatalogueFailure';
    this.code = code;
    this.target = target;
    this.cause = cause;
    // Preserve the prototype chain under downlevel targets so `instanceof` holds.
    Object.setPrototypeOf(this, CatalogueFailure.prototype);
  }
}

// Guard for catch sites, which receive `unknown`. Prefer this over
// `instanceof CatalogueFailure` when the value may have crossed a module
// boundary that duplicated the class (jest module registry, split bundles),
// where instanceof silently returns false.
export function isCatalogueFailure(err: unknown): err is CatalogueFailure {
  return err instanceof Error && err.name === 'CatalogueFailure';
}
