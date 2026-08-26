// src/model/institution.ts
// The Institution shape — cross-team contract with wokay (CAP-2 listing,
// CAP-3 selection). wokay owns the field names; we own the normalizer.
//
// CLAUDE.md flags this as a cross-team contract: add wokay's lead as a
// reviewer on any PR that touches this file.
//
// Kept in its own file rather than added to `types.ts` because it is a
// separate domain (nothing here derives from a catalogue feed) and because
// `src/model/types.ts` is Akriti's P0-3 deliverable.
import { CatalogueError, CatalogueFailure } from '@model/errors';

export interface InstitutionBranding {
  // Absent when the institution has no logo — InstitutionRow falls back to
  // initials (W-17). Never an empty string; see normalizeInstitution.
  logoUrl: string;
}

export interface Institution {
  id: string;
  name: string;
  country: string;
  // Short identifier code, e.g. "ICL". Required by the published contract.
  code: string;
  city: string;
  // The root OPDS URL for this institution's catalogue. Optional: the real
  // backend does not send this field yet, unlike the frozen contract's
  // assumption — see Q-D in CLAUDE.md's unsettled-decisions table.
  catalogueUrl?: string;
  // Absent when the institution has no branding asset.
  branding?: InstitutionBranding;
}

// Institutions are not a feed, but the failure codes are the same set (absent
// thing / unusable payload), so CatalogueFailure is reused rather than cloned.
function malformed(what: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, what);
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(`institution is missing ${field}`);
  }
  return value;
}

export function normalizeInstitution(doc: unknown): Institution {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw malformed('institution is not an object');
  }
  const raw = doc as Record<string, unknown>;

  // An empty logoUrl is treated as no branding. Otherwise InstitutionRow
  // would try to load '' and render a broken image instead of initials (W-17).
  const brandingRaw = raw.branding as Record<string, unknown> | undefined;
  const branding =
    typeof brandingRaw?.logoUrl === 'string' && brandingRaw.logoUrl.length > 0
      ? { logoUrl: brandingRaw.logoUrl }
      : undefined;

  const catalogueUrl =
    typeof raw.catalogueUrl === 'string' && raw.catalogueUrl.length > 0
      ? raw.catalogueUrl
      : undefined;

  return {
    id: reqString(raw.id, 'id'),
    name: reqString(raw.name, 'name'),
    country: reqString(raw.country, 'country'),
    code: reqString(raw.code, 'code'),
    city: reqString(raw.city, 'city'),
    ...(catalogueUrl !== undefined ? { catalogueUrl } : {}),
    ...(branding !== undefined ? { branding } : {}),
  };
}

export function normalizeInstitutionList(doc: unknown): Institution[] {
  // The published wokay contract wraps the list in a paged envelope:
  // { items: [...], total: N, page: N, size: N }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw malformed('institution list is not an object');
  }
  const raw = doc as Record<string, unknown>;

  if (!Array.isArray(raw.items)) {
    throw malformed('payload has no items array');
  }

  return raw.items.map(normalizeInstitution);
}
