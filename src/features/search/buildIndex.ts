// Owner: Search (Vaishnavi).
//
// The build half of the prototype. The `Extractor` (the format-aware stage) emits
// `IndexEntry[]` in reading order; this file's only job is to GROUP them by
// normalized word into the frozen `SearchIndex` / `BookSearchIndex`. Because the
// entries arrive in reading order, grouping preserves per-word reading order with
// no later sort.
//
// Two layers:
//   • buildIndexFromEntries(...) — PURE. No I/O, no crypto. The unit-testable core.
//   • createPrototypeBuildIndex(extractor) — wraps an `Extractor` in the frozen
//     `BuildIndex(bookId)` facade. Swap the extractor (sample -> server) and the
//     signature is unchanged.

import type { BookSearchIndex, BuildIndex, IndexEntry, SearchIndex } from '@/shared/contracts';
import type { Extractor } from './extractor';

// Index-format version, for future rebuilds/migrations (BookSearchIndex.version).
// Bumped 1 -> 2 when postings gained `seq` (token-sequence adjacency; see Posting.seq in
// search.ts). A v2 index phrase-matches correctly; a v1 index has no seq and degrades to
// single-word-only. The bump is the migration signal — nothing rejects a v1 index, it just
// cannot phrase-match until rebuilt.
const INDEX_VERSION = 2;

/**
 * PURE core: group flat entries by normalized word into the inverted index.
 * `format` describes the locator/query model the entries were built for.
 */
export function buildIndexFromEntries(
  bookId: string,
  format: BookSearchIndex['format'],
  entries: readonly IndexEntry[],
): BookSearchIndex {
  const index: SearchIndex = {};
  for (const { word, ...posting } of entries) {
    (index[word] ??= []).push(posting);
  }
  return { bookId, format, version: INDEX_VERSION, index };
}

/**
 * Wrap an `Extractor` in the frozen `BuildIndex(bookId)` facade. The prototype
 * passes `epubSampleExtractor`; production would pass a server-fetch extractor.
 * Nothing else changes.
 */
export function createPrototypeBuildIndex(extractor: Extractor): BuildIndex {
  return async (bookId: string): Promise<BookSearchIndex> => {
    const { format, entries } = await extractor.extract(bookId);
    return buildIndexFromEntries(bookId, format, entries);
  };
}
