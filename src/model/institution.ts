// src/model/institution.ts
// The Institution shape — ENTIRELY OURS.
//
// Foundation Spec Appendix C.3: "OPDS does not model institutions and neither
// does the design specification. The `Institution` shape in P0-3 is entirely ours
// and is the one being sent to wokay." So unlike everything in `opds/`, there is
// no upstream format to be faithful to — this file IS the proposal, and wokay's
// job is to correct it rather than design it.
//
// CLAUDE.md flags the institution shape as a cross-team contract: add wokay's
// lead as a reviewer on any PR that touches this file, and flambeau's on
// `authType`, since that field is what routes into their sign-in flow (CAP-3).
//
// Kept in its own file rather than added to `types.ts` because it is a separate
// domain (nothing here derives from a catalogue feed) and because `src/model/
// types.js` is Akriti's P0-3 deliverable — a smaller file is a smaller merge
// conflict when her version lands.
import { CatalogueError, CatalogueFailure } from '@model/errors';

// Declared as a runtime array first, with the type derived from it.
//
// The Foundation Spec calls this out explicitly (§P0-3): the unions must exist as
// VALUES, because three consumers enumerate them — the validator, a component's
// `PropTypes.oneOf()`, and the state gallery rendering every variant. A bare
// TypeScript union type would erase and leave those three with nothing, so the
// array is the definition and `AuthType` is derived from it. One definition,
// three consumers, no retyped literals.
export const AUTH_TYPES = ['saml', 'oidc', 'email', 'unknown'] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

export interface Institution {
  id: string;
  name: string;
  country: string;
  // Absent when the institution has no crest — InstitutionRow falls back to
  // initials (W-17). Never an empty string; see normalizeInstitution.
  crestUrl?: string;
  // Which sign-in flow this institution routes to. 'unknown' is a REAL value,
  // not missing data: it means flambeau could not classify the institution and
  // the UI must offer the fallback path (CAP-3).
  authType: AuthType;
}

// Institutions are not a feed, but the failure codes are the same set (absent
// thing / unusable payload), so CatalogueFailure is reused rather than cloned.
// Read MALFORMED_FEED here as "malformed payload from a data source".
function malformed(what: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, what);
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(`institution is missing ${field}`);
  }
  return value;
}

function isAuthType(value: unknown): value is AuthType {
  return AUTH_TYPES.includes(value as AuthType);
}

export function normalizeInstitution(doc: unknown): Institution {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw malformed('institution is not an object');
  }
  const raw = doc as Record<string, unknown>;

  const authType = raw.authType;
  // Not defaulted to 'unknown'. An unrecognised value means the vocabulary moved
  // or the payload is wrong; quietly coercing it would route a SAML institution
  // down the email sign-in path, which fails at the worst possible moment.
  if (!isAuthType(authType)) {
    throw malformed(`institution has an unrecognised authType: ${String(authType)}`);
  }

  // An empty crestUrl is treated as no crest. Otherwise the row would try to
  // load '' and render a broken image instead of taking the initials path.
  const crestUrl = typeof raw.crestUrl === 'string' && raw.crestUrl.length > 0
    ? raw.crestUrl
    : undefined;

  return {
    id: reqString(raw.id, 'id'),
    name: reqString(raw.name, 'name'),
    country: reqString(raw.country, 'country'),
    ...(crestUrl !== undefined ? { crestUrl } : {}),
    authType,
  };
}

export function normalizeInstitutionList(doc: unknown): Institution[] {
  // Accepts both a bare array and an `{ institutions: [...] }` envelope. The
  // envelope is PROVISIONAL — we invented it so wokay has somewhere to add paging
  // later — so tolerating both costs one line and avoids a breaking change if
  // they hand back the plainer shape.
  const entries = Array.isArray(doc)
    ? doc
    : typeof doc === 'object' && doc !== null && Array.isArray((doc as Record<string, unknown>).institutions)
      ? ((doc as Record<string, unknown>).institutions as unknown[])
      : undefined;

  if (entries === undefined) throw malformed('payload has no institutions array');

  return entries.map(normalizeInstitution);
}
