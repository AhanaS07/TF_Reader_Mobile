// src/adapters/CatalogueSource.ts
// The seam between the app and wherever catalogue data comes from.
//
// Screens, stores and hooks depend on THIS TYPE ONLY — never on MockAdapter or
// ApiAdapter directly, and never on the OPDS shapes behind them. `src/config/`
// picks the implementation once at startup; nothing downstream can tell which it
// got, which is what lets the whole app run on fixtures before api.tf exists.
//
// Both implementations are held to `conformance.ts`. If a method's contract
// changes, change it here and the suite will fail for both until they agree.
import type { BookId } from '@/shared/types/primitives';
import type { Catalogue, Publication, Shelf } from '@model/types';

export interface CatalogueSource {
  // The institution's home screen: which sections exist, plus preview shelves.
  //
  // `institutionId` is a PARAMETER, not adapter state. CAP-3 lets the user switch
  // institutions at runtime, and an adapter that closed over one id would have to
  // be rebuilt on every switch — plus the same instance can then serve a
  // multi-institution cache later without changing this signature.
  //
  // Rejects CatalogueFailure(NOT_FOUND) if the institution is unknown.
  getHomeCatalogue(institutionId: string): Promise<Catalogue>;

  // One shelf/section as a paginated listing. `page` is a zero-based index, not a
  // URL: paging is the adapter's problem, so no caller ever builds an href.
  // Omitting it means the first page.
  //
  // Rejects CatalogueFailure(NOT_FOUND) if the institution or shelf is unknown.
  getShelf(institutionId: string, shelfId: string, page?: number): Promise<Shelf>;

  // Full detail for one publication — richer than the summary the shelf carried
  // (subtitle, description, page count, larger imagery).
  //
  // Rejects CatalogueFailure(NOT_FOUND) if the institution or publication is
  // unknown.
  getPublication(institutionId: string, bookId: BookId): Promise<Publication>;
}
