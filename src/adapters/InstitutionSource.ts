// src/adapters/InstitutionSource.ts
// The institution half of the data seam (CAP-2 listing, CAP-3 selection).
//
// SEPARATE FROM CatalogueSource on purpose. The two have different lifetimes and
// different owners upstream: the catalogue is wokay's OPDS feed, while the
// institution list is a shape we invented and flambeau consumes for sign-in
// routing. A screen that only picks an institution should not have to depend on a
// type carrying three catalogue methods it never calls.
//
// The Foundation Spec's `DataAdapter` is one interface with all six methods, so
// `DataSource` below is the composition that satisfies it — an adapter implements
// both halves, and callers depend on whichever half they actually use.
import type { CatalogueSource } from '@adapters/CatalogueSource';
import type { Institution } from '@model/institution';

// Optional search/filter params for getInstitutions.
// Defined here so MockAdapter and ApiAdapter share one type — a mismatch between
// them is the bug class the conformance suite exists to prevent.
export interface InstitutionQueryParams {
  // Exact match on institution id — used when re-resolving a persisted selection.
  institutionId?: string;
  // Free-text search against institution name. Diacritic-folded and
  // case-insensitive so "Zurich" matches "Zürich".
  q?: string;
  // Case-insensitive exact match on country name.
  country?: string;
  // Zero-based page index. Defaults to 0 when omitted.
  page?: number;
  // Items per page. Defaults to the full result set when omitted.
  size?: number;
}

export interface InstitutionSource {
  // Every institution the user may pick from (CAP-2).
  // All params are optional — calling with none returns the full list, so the
  // conformance suite and any caller that does not need filtering are unaffected.
  getInstitutions(params?: InstitutionQueryParams): Promise<Institution[]>;

  // One institution, for the selected-institution header and for re-resolving a
  // persisted selection on app start (FL-5).
  //
  // Rejects CatalogueFailure(NOT_FOUND) for an unknown id — never resolves
  // undefined, which is the failure mode the conformance suite exists to prevent.
  getInstitution(institutionId: string): Promise<Institution>;
}

// The full six-method seam, matching the Foundation Spec's `DataAdapter`.
// `src/config/` hands this out; individual screens narrow to the half they need.
export type DataSource = CatalogueSource & InstitutionSource;
