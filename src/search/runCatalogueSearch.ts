// src/search/runCatalogueSearch.ts
// The one call a search surface makes: narrow, rank, then reorder.
//
// THE ORDER IS FIXED HERE, NOT AT THE CALL SITE.
//   1. filters   — cheapest first, so ranking only scores survivors
//   2. ranking   — scores are then comparable within the set actually shown
//   3. sort      — a chosen order overrides relevance, never the reverse
// Two screens free to compose these themselves would eventually disagree about
// the result order for the same inputs, which is untraceable from a screenshot.
import type { Publication } from '@model/types';

import {
  ALL_FORMATS,
  filterByContentType,
  filterByDateRange,
  filterByFormat,
  sortPublications,
  type ContentTypeFilter,
  type DateRangeFilter,
  type FormatFilter,
  type SortOption,
} from './filters';
import { searchPublications } from './searchPublications';

export interface CatalogueSearchInput {
  // Everything currently in hand. The caller fetched it; this never fetches.
  publications: Publication[];
  // Raw, straight from the field. Blank means no constraint, not no results.
  query: string;
  // Every filter is optional and every default is "no constraint", so a caller
  // that only has a query passes only a query.
  contentType?: ContentTypeFilter;
  dateRange?: DateRangeFilter;
  format?: FormatFilter;
  sort?: SortOption;
  // Injected so the date filter stays testable without freezing the clock. The
  // screen passes Date.now(); nothing in `src/search` reads it.
  now?: number;
}

export function runCatalogueSearch({
  publications,
  query,
  contentType = 'ALL',
  dateRange = 'ANY',
  format = ALL_FORMATS,
  sort = 'RELEVANCE',
  now = Date.now(),
}: CatalogueSearchInput): Publication[] {
  const narrowed = filterByDateRange(
    filterByContentType(filterByFormat(publications, format), contentType),
    dateRange,
    now,
  );

  return sortPublications(searchPublications(narrowed, query), sort);
}
