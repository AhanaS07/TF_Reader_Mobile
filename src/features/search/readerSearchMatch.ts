// src/features/search/readerSearchMatch.ts
// Owner: Search (Vaishnavi).
//
// The host-side "writes" half of search-match painting, exactly parallel to readerHighlights.ts:
// it turns the active search hit into a FORMAT-FREE, primitive-only payload the reader can paint, and
// the pure call/clear decision that feeds it. It does NOT touch the bridge or src/features/reader/ —
// it produces what the future `paintSearchMatch` command will carry. Ahana owns the "applies" half
// (the bridge command + the actual painting: EPUB via the highlight seam, PDF via a new spread-aware
// overlay seam). The seam is the boundary, the same way toReaderHighlights writes and the Reader paints.
//
// WHY THIS SHAPE EXISTS — it keeps a frozen contract OFF the WebView bridge, the same reason
// ReaderHighlights/ReaderAppearance are bridge-local flat shapes. A `SearchHit.locator` is the frozen
// `Locator` union, discriminated on `type: 'PDF' | 'EPUB'` — those are `ContentFormat` literals, a
// frozen contract WEBVIEW_BRIDGE.md forbids on the wire (format is routed by COMMAND NAME, not carried
// as a value; readerBridge.test.ts's "never puts a ContentFormat value into a command payload" pins it).
// So the `Locator` must NOT be forwarded as-is. This file maps it host-side into a per-shell payload
// that carries no `type`/`format` field at all — the partition IS the routing, done host-side. Same
// move as `targetOf` unwrapping the locator into a `ReaderTarget` for `goTo`, and `toReaderHighlights`.
//
// SEARCH is a distinct highlight owner (`'search'`, the outline/box channel) from `user` and `tts` —
// see HIGHLIGHT_LAYERS.md §3. Its paint must COMPOSE over a user fill, not replace it, and only ONE
// search match is active at a time (the current result), so painting a new match clears the previous:
// that is what `searchMatchFor` models — the active hit paints, everything else clears.

import type { SearchHit } from '@/shared/contracts';

/**
 * One EPUB search match to paint, format-free. `startCfi` is the hit's POINT CFI (the extractor emits
 * a collapsed CFI at the matched token's start — see search/extractor.ts). A point cannot be drawn as
 * a box, so the reader expands it to a range covering `matchText` at paint time (Decision A in the
 * scope: reader-side expansion, no index change). CFIs are position-independent, so nothing here needs
 * to know single- vs double-spread.
 */
export interface EpubSearchMatch {
  startCfi: string;
  /** The searched term; the reader sizes the painted range from it. Self-contained on purpose. */
  matchText: string;
}

/**
 * One PDF search match to paint, format-free. `page` is 1-based and is what makes this SPREAD-AWARE:
 * in a double-page spread two pages render on two canvases, and `page` routes the paint to the correct
 * one (`goTo(page)` already lands on the right spread; this paints on it). `startOffset` is the char
 * offset into that page's text — kept for a precise match box (Decision B v2); the v1 page-level cue
 * needs only `page`.
 */
export interface PdfSearchMatch {
  page: number;
  startOffset: number;
  matchText: string;
}

/**
 * The match to paint, split by which shell would render it. A book is one format (one shell per book),
 * so exactly one side is non-null for a painted match — the reader sends the one matching the shell it
 * opened. Both null = CLEAR (no active match): the panel closed, or nothing is selected yet. Split
 * rather than a single tagged object precisely so no `type`/`format` discriminant has to travel.
 */
export interface ReaderSearchMatch {
  epub: EpubSearchMatch | null;
  pdf: PdfSearchMatch | null;
}

/** The CLEAR payload — nothing painted. `searchMatchFor` returns this when no hit is active. */
export const NO_SEARCH_MATCH: ReaderSearchMatch = { epub: null, pdf: null };

/**
 * The pure core: one `SearchHit` (+ the searched term) -> the format-free per-shell payload. The
 * `Locator` discriminant stops here; fields are copied EXPLICITLY (not spread-minus-type) so it is
 * impossible for a `ContentFormat` value to leak into the payload and obvious what crosses the bridge.
 */
export function toReaderSearchMatch(hit: SearchHit, term: string): ReaderSearchMatch {
  const matchText = term.trim();
  const locator = hit.locator;
  if (locator.type === 'EPUB') {
    return { epub: { startCfi: locator.cfi, matchText }, pdf: null };
  }
  return { epub: null, pdf: { page: locator.page, startOffset: locator.offset ?? 0, matchText } };
}

/**
 * The call/clear decision, pure: the payload the reader should paint given the current hit list and
 * which one is active. `activeIndex` is `-1` when a search has run but nothing is selected (see
 * useBookSearch), and can momentarily point past the list while results are swapping — both yield
 * CLEAR rather than a paint, so the reader always dispatches exactly one authoritative payload. The
 * reader calls this whenever `activeIndex`/`hits` change and sends the result via `paintSearchMatch`.
 */
export function searchMatchFor(
  hits: readonly SearchHit[],
  activeIndex: number,
  term: string,
): ReaderSearchMatch {
  const hit = activeIndex >= 0 ? hits[activeIndex] : undefined;
  return hit ? toReaderSearchMatch(hit, term) : NO_SEARCH_MATCH;
}
