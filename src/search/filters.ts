// src/search/filters.ts
// The filter and sort half of the search shell. Pure — no React, no adapter.
//
// THREE OF THESE DIMENSIONS HAVE NO FIELD BEHIND THEM YET, and each says so in
// its own type rather than pretending. `Publication` carries `format`,
// `published` and `title`; it carries no work type, no access tier and no
// citation count. The design asks for all three anyway, so they are modelled
// here and reported as unsupported at the edge — the UI can render the control,
// the reader is told it cannot act yet, and the day the field lands the change
// is one function in this file.
//
// The alternative — quietly returning everything for an unsupported filter — is
// worse than a disabled control, because it looks like the filter ran.
import type { ContentFormat } from '@/shared/types/primitives';
import type { Publication } from '@model/types';

// ─── Content type ────────────────────────────────────────────────────────────

// 'ALL' is the absence of a constraint, not a fourth type.
export const CONTENT_TYPES = ['ALL', 'JOURNALS', 'BOOKS', 'AUDIO'] as const;
export type ContentTypeFilter = (typeof CONTENT_TYPES)[number];

// Which formats each type covers. JOURNALS is deliberately EMPTY: a journal is a
// work type, and the only work-type signal is OPDS `@type`, whose journal and
// article values are still a guess (Q-1b) and which `Publication` does not carry
// at all. An empty list is honest; mapping journals onto PDF would silently
// relabel every PDF book as a journal.
const FORMATS_BY_CONTENT_TYPE: Record<
  Exclude<ContentTypeFilter, 'ALL'>,
  readonly ContentFormat[]
> = {
  JOURNALS: [],
  BOOKS: ['EPUB', 'PDF'],
  AUDIO: ['AUDIO'],
};

/** True when the catalogue can actually answer this content type today. */
export function isContentTypeSupported(contentType: ContentTypeFilter): boolean {
  return contentType === 'ALL' || FORMATS_BY_CONTENT_TYPE[contentType].length > 0;
}

export function filterByContentType(
  publications: Publication[],
  contentType: ContentTypeFilter,
): Publication[] {
  if (contentType === 'ALL') return publications;

  const formats = FORMATS_BY_CONTENT_TYPE[contentType];
  return publications.filter((publication) => formats.includes(publication.format));
}

// ─── Access type ─────────────────────────────────────────────────────────────

// Q-D closed on 11 Aug: there is no `accessTier` field, and the tier is DERIVED
// from the acquisition link's licenceModel. Crucially, team1_README puts that
// derivation "in the adapter, never in a component", and `src/access/` is named
// as the only place access logic may live. Neither exists yet.
//
// So this dimension is modelled and NOT applied. Deriving it here would move
// access logic into the search pipeline, which is the one rule Design Spec §5.1
// states outright: "the UI must never calculate access rights". A filter is not
// worth breaking that for — when `resolveAccess` lands, `filterByAccess` takes a
// resolved tier per publication and this comment goes away.
export const ACCESS_FILTERS = ['ALL', 'OPEN_ACCESS', 'SUBSCRIPTION', 'ELITE'] as const;
export type AccessFilter = (typeof ACCESS_FILTERS)[number];

/** False for every real tier — nothing can resolve one yet. See above. */
export function isAccessFilterSupported(access: AccessFilter): boolean {
  return access === 'ALL';
}

// ─── Date range ──────────────────────────────────────────────────────────────

export const DATE_RANGES = ['ANY', 'LAST_YEAR', 'LAST_5_YEARS'] as const;
export type DateRangeFilter = (typeof DATE_RANGES)[number];

const YEARS_BY_RANGE: Record<Exclude<DateRangeFilter, 'ANY'>, number> = {
  LAST_YEAR: 1,
  LAST_5_YEARS: 5,
};

/**
 * Narrows by publication date.
 *
 * `now` is a PARAMETER, not `Date.now()` read inside. A function that reads the
 * clock cannot be tested without freezing time, and this one is the only part of
 * the pipeline that would need it.
 *
 * A publication with no `published` date is EXCLUDED from a bounded range: the
 * reader asked for the last year, and "we don't know when this was published"
 * is not an answer to that. It still appears under ANY.
 */
export function filterByDateRange(
  publications: Publication[],
  range: DateRangeFilter,
  now: number,
): Publication[] {
  if (range === 'ANY') return publications;

  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - YEARS_BY_RANGE[range]);
  const cutoffMs = cutoff.getTime();

  return publications.filter((publication) => {
    if (!publication.published) return false;

    const publishedMs = Date.parse(publication.published);
    // An unparseable date is missing data, not a date of zero.
    if (Number.isNaN(publishedMs)) return false;

    return publishedMs >= cutoffMs;
  });
}

// ─── Sort ────────────────────────────────────────────────────────────────────

export const SORT_OPTIONS = ['RELEVANCE', 'MOST_RECENT', 'MOST_CITED', 'ALPHABETICAL'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

// MOST_CITED has no field behind it — `Publication` carries no citation count and
// no surface we consume supplies one. Reported as unsupported rather than
// silently falling back to relevance, which would look like a working sort that
// simply disagrees with the reader.
export function isSortSupported(sort: SortOption): boolean {
  return sort !== 'MOST_CITED';
}

/**
 * Reorders an already-matched, already-ranked list.
 *
 * RELEVANCE is the identity: the ranking `searchPublications` produced is the
 * relevance order, so re-sorting would throw away the scores that produced it.
 * Anything unsupported is likewise left alone.
 */
export function sortPublications(publications: Publication[], sort: SortOption): Publication[] {
  if (sort === 'RELEVANCE' || !isSortSupported(sort)) return publications;

  // Copy before sorting — the caller's array is not ours to reorder in place.
  const sorted = [...publications];

  if (sort === 'ALPHABETICAL') {
    return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }

  // MOST_RECENT. Undated publications sink to the bottom rather than being
  // dropped: the reader asked for an order, not a filter.
  return sorted.sort((a, b) => {
    const aMs = a.published ? Date.parse(a.published) : Number.NaN;
    const bMs = b.published ? Date.parse(b.published) : Number.NaN;
    const aMissing = Number.isNaN(aMs);
    const bMissing = Number.isNaN(bMs);

    if (aMissing && bMissing) return a.title.localeCompare(b.title);
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (aMs !== bMs) return bMs - aMs;

    // Same date ties break on title, so the order is stable between renders.
    return a.title.localeCompare(b.title);
  });
}

// ─── Format (kept: the inline chip row uses it) ──────────────────────────────

export const ALL_FORMATS = 'ALL';
export type FormatFilter = ContentFormat | typeof ALL_FORMATS;

/** The formats actually present, in first-seen order. */
export function availableFormats(publications: Publication[]): ContentFormat[] {
  const seen: ContentFormat[] = [];

  for (const publication of publications) {
    if (!seen.includes(publication.format)) seen.push(publication.format);
  }

  return seen;
}

export function filterByFormat(
  publications: Publication[],
  format: FormatFilter,
): Publication[] {
  if (format === ALL_FORMATS) return publications;

  return publications.filter((publication) => publication.format === format);
}
