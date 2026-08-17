// src/search/browseLink.ts
// Query-parameter builder for the "all" shelf — the browse half of the shared
// query helper. `searchLink.ts` is the other half, for catalogue search.
//
// WHY A SEPARATE FUNCTION RATHER THAN ONE COVERING BOTH ENDPOINTS: browse and
// search take overlapping but not identical parameters, per wokay-api.yaml.
// `contentType` and `accessTier` are common to both. `sort` exists only on
// `getGroupFeed` (`/groups/{shelfId}`) — `searchCatalogue`'s own parameter list
// has no `sort`. `query` exists only on search — `groups/{shelfId}` takes no
// free-text term. A single function covering both would need a runtime check
// for which fields apply where; two functions make the difference a
// compile-time one instead: `BrowseFilters` has no `query`, `SearchFilters`
// has no `sort`.
//
// EXPANSION IS SHARED, NOT DUPLICATED. `expandSearchLink` is endpoint-agnostic —
// it turns any template or plain URL plus a parameter bag into a URL, whichever
// builder produced the bag. A shelf's own href is never templated (the frozen
// fixtures carry it as a plain '.../groups/all' or '.../groups/shelf_1'), so
// expansion here only ever exercises the "append what was supplied" path — the
// same path a `contentType` filter already takes against the search template.
import type { AccessTier, SortOrder } from '@model/types';
import type { ContentFormat } from '@/shared/types/primitives';

import type { SearchLinkParams } from './searchLink';

// Wire parameter names, spelled once — same reasoning as SEARCH_PARAM.
export const BROWSE_PARAM = {
  contentType: 'contentType',
  accessTier: 'accessTier',
  sort: 'sort',
} as const;

/**
 * The active filter dimensions for a browse request. No `query` — browsing a
 * shelf is not a search, it is asking for what is already there.
 */
export interface BrowseFilters {
  contentType?: ContentFormat;
  accessTier?: AccessTier;
}

/**
 * The query string a browse request carries, as parameters rather than a URL.
 *
 * SORT IS ACCEPTED ONLY FOR `shelfId === 'all'`. The contract is explicit that
 * `sort` is "ignored on a curated shelf, where the operator's order is the
 * order" — sending it for `shelf_1..3` would silently do nothing on the server,
 * so it is dropped here rather than shipped as a parameter that lies about what
 * it does.
 */
export function browseParams(
  shelfId: string,
  filters: BrowseFilters,
  sort?: SortOrder,
): SearchLinkParams {
  return {
    ...(filters.contentType !== undefined
      ? { [BROWSE_PARAM.contentType]: filters.contentType }
      : {}),
    ...(filters.accessTier !== undefined ? { [BROWSE_PARAM.accessTier]: filters.accessTier } : {}),
    ...(shelfId === 'all' && sort !== undefined ? { [BROWSE_PARAM.sort]: sort } : {}),
  };
}
