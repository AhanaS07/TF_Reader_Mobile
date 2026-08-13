// src/search/pipeline.ts
// THE SEAM. Two methods, and everything else in this feature is on one side of
// them or the other.
//
// R3c is the reason this file exists as its own boundary rather than as an
// implementation detail: wokay's real catalogue search endpoint arrives in Week 4,
// which is also Team 1's integration and BDD week. There is no slack to redesign
// a search UI in that week, so the UI is built against this interface today and
// the Week-1 fixture sits behind it:
//
//     UI  →  CatalogueSearchPipeline  →  FixtureSearchPipeline   (Week 1)
//     UI  →  CatalogueSearchPipeline  →  ApiSearchPipeline       (Week 4)
//
// Swapping them is a `src/config/search.ts` change — the same trick
// `src/config/catalogue.ts` already plays for Mock vs Api, and the same reason
// team1_README can claim "integration is a configuration change" rather than
// hoping it will be.
//
// "WE FILTER, YOU RENDER." Catalogue search is server-side and
// entitlement-scoped. Matching, tokenisation and ranking all live behind this
// interface and none of them are ours — a client that re-ranked what came back
// would be second-guessing an entitlement boundary it cannot see. Nothing above
// this line sorts, scores or narrows a result set.
//
// METADATA ONLY. The searchable corpus is title, authors, subjects and
// description. It is NOT the text inside a book — in-book search is a separate
// capability with a separate index, owned by t4targaryen
// (`src/shared/contracts/search.ts`, per-book, built at ingestion, encrypted
// under the BEK). The two must not be conflated in copy or in code: promising a
// reader that a catalogue search sees inside books is a promise nothing here can
// keep.
import type { AccessTier, SearchFeed } from '@model/types';
import type { ContentFormat } from '@/shared/types/primitives';

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * The active filter dimensions, each `undefined` when unconstrained.
 *
 * BOTH UNIONS ARE IMPORTED, NOT REDECLARED. `ContentFormat` is described in
 * primitives.ts as the backend's own "source-of-truth contentType enum", and
 * `AccessTier` is the badge vocabulary in types.ts. Re-spelling either as local
 * string literals would create a second list to keep in step by hand, and the
 * compiler could not tell us when they drifted.
 *
 * ABSENT MEANS "NO CONSTRAINT", WHICH IS WHY THERE IS NO 'ALL' MEMBER. 'ALL' as a
 * fourth content type would have to be filtered out again before it reached the
 * wire, and every consumer would have to remember to. The UI renders an "All"
 * chip for `undefined`; the wire simply omits the parameter.
 *
 * SUBJECT IS ABSENT ON PURPOSE. Subject filtering needs facets to enumerate the
 * available values, no facet support exists on any surface we consume, and P0-8
 * blocks it. A dimension that cannot list its own values cannot be offered, so it
 * is not modelled here — adding it later is additive.
 */
export interface SearchFilters {
  contentType?: ContentFormat;
  accessTier?: AccessTier;
}

// ─── Request ─────────────────────────────────────────────────────────────────

export interface SearchRequest {
  // A PARAMETER, not pipeline state — the same reasoning `CatalogueSource`
  // documents for its own `institutionId`: CAP-3 lets the reader switch
  // institutions at runtime, and a pipeline that closed over one would have to be
  // rebuilt on every switch. It is also what makes the entitlement scope explicit
  // at every call site rather than implicit in a constructor.
  institutionId: string;
  // Raw, as typed. Trimming and encoding happen in `searchLink.ts`.
  query: string;
  filters: SearchFilters;
}

// ─── The interface ───────────────────────────────────────────────────────────

export interface CatalogueSearchPipeline {
  /**
   * First page for a query plus its filters.
   *
   * Discovers and expands the templated search link itself, so no caller ever
   * sees a URL. Rejects with `CatalogueFailure` — never resolves a page that
   * means "this failed", because the empty state and the error state are
   * different answers and the UI has to tell them apart.
   *
   * A zero-result search RESOLVES. It comes back as a `SearchFeed` with an empty
   * `publications` array and, where the server offers them, `browseInstead`
   * entries. That is a successful request with nothing in it, not a failure.
   */
  search(request: SearchRequest): Promise<SearchFeed>;

  /**
   * The next page, driven by the previous page's `next` value.
   *
   * THE VALUE IS PASSED BACK VERBATIM AND NEVER RECONSTRUCTED. No page numbers,
   * no offsets, no re-sending the query — the server said where the next page is
   * and following that is the client's whole contribution. It also means the
   * query and filter context is preserved by whoever actually knows it: a `next`
   * that drops a filter is the server's bug to fix, and a client that helpfully
   * re-appended the filters would hide it.
   *
   * Only ever called with a `next` that came off a `SearchFeed`.
   */
  next(next: string): Promise<SearchFeed>;
}
