// Owner: Reader (Ahana).
//
// The arithmetic behind painting a PDF search match. Pure and unit-tested, for the reason CLAUDE.md
// gives: `pdf.entry.ts` and `pdfHighlightSeam.ts` read the DOM, so anything with a `+1` in it lives
// here where a test can call it. And this file is nothing BUT a `+1`.
//
// >>> THE SEARCH INDEX AND THE TEXT LAYER COUNT CHARACTERS DIFFERENTLY. THAT IS WHAT THIS FIXES. <<<
// Two independent extractions of the same page disagree about where character N is:
//
//   Search  (`search/extractor.ts`, `pageItemsToText`)  item.str + A SEPARATOR AFTER EVERY ITEM
//                                                       ('\n' when hasEOL, otherwise ' ')
//   Reader  (`pdfHighlightSeam.ts`, `setPageText`)      itemsStr.map(s => s.length), NO separator
//                                                       ("item boundaries add nothing" —
//                                                        pdfTextRange.ts's own header)
//
// Both are right for their own purpose. Search needs the separator or two runs fuse into one token
// and phrase adjacency breaks; the reader must not invent one, or every stored highlight offset
// would depend on a joining convention only that file knows about. But a `SearchHit`'s
// `Locator.offset` is in the FIRST space and `slicesForRange` addresses the SECOND, so handing one
// straight to the other paints a box one character per preceding item too far along — tens of
// characters into a page, on a plausible-looking wrong word. Silently.
//
// The conversion is exact: the drift is the number of separators passed, which is the number of
// items passed, regardless of WHICH separator each was. `extractor.ts` is Search's file and its
// offsets are what is stored in every index already built, so the conversion belongs on this side.
//
// It is still VERIFIED before use (`resolveMatchOffset`), because exactness here assumes the two
// extractions saw the same items — the same document, through the same pdf.js item filter. That
// holds today and is not something this shell can prove, so it checks rather than trusts, and the
// caller falls back to a page-level cue when the check fails.

/**
 * An index-space offset (a separator after every item) -> text-layer space (no separators).
 *
 * Null when the offset is negative, not an integer, or past the end of the page — all of which mean
 * "this hit does not address this page's text", and all of which the caller answers with the page
 * cue rather than a box in the wrong place.
 *
 * An offset landing exactly ON a separator maps to the END of the item before it. That is the one
 * position with no counterpart in text-layer space, and the end of the preceding item is where it
 * visually belongs — the separator is whitespace the reader never sees.
 */
export function indexOffsetToPageOffset(
  lengths: readonly number[],
  indexOffset: number,
): number | null {
  if (!Number.isInteger(indexOffset) || indexOffset < 0) return null;

  let indexStart = 0;
  let pageStart = 0;

  for (const raw of lengths) {
    const length = Math.max(0, raw);
    // `<=`, not `<`: the item's own end is inside it (see the separator note above).
    if (indexOffset <= indexStart + length) return pageStart + (indexOffset - indexStart);
    indexStart += length + 1; // the +1 IS the separator, and this whole file is that +1
    pageStart += length;
  }

  return null;
}

/**
 * Confirm a text-layer offset actually lands on the term, repairing it to the nearest occurrence if
 * it does not — or null if the term is not on this page at all.
 *
 * >>> WHY VERIFY AT ALL, WHEN `indexOffsetToPageOffset` IS EXACT. <<< Its exactness rests on the
 * two extractions having seen the same items in the same order: the same pdf.js, agreeing on which
 * marked-content entries are text. That is true today and is not something this shell can check
 * directly — but it can check the ANSWER, cheaply, by looking at what is actually at the offset.
 * The failure it guards against is the worst kind: a box drawn confidently on the wrong word, which
 * looks like a search bug rather than an offset bug and cannot be told apart from a correct box in
 * a screenshot.
 *
 * NEAREST rather than first: a page can contain the term many times and the index already knows
 * which occurrence this hit is. If the mapping is off, it is off by a bounded drift, so the
 * occurrence closest to where it pointed is the one it meant — that keeps stepping through matches
 * on one page landing on successive occurrences rather than all on the first.
 *
 * CASE-FOLDED, because `queryIndex` matches case-insensitively and the reader typed the query.
 *
 * A PHRASE SPANNING TWO ITEMS WILL NOT BE FOUND HERE, and that is the documented limit: this space
 * has no separators, so "the cat" laid out as two text runs reads as "thecat". The caller answers
 * with the page cue, which is the honest response — the page IS right, only the box is unknown.
 */
export function resolveMatchOffset(
  texts: readonly string[],
  hintOffset: number,
  matchText: string,
): number | null {
  const needle = matchText.trim().toLowerCase();
  if (needle === '') return null;

  const haystack = texts.join('').toLowerCase();
  if (haystack === '') return null;

  if (Number.isInteger(hintOffset) && hintOffset >= 0 && haystack.startsWith(needle, hintOffset)) {
    return hintOffset;
  }

  let best: number | null = null;
  // `at + 1`, not `at + needle.length`: overlapping occurrences ("aa" in "aaa") are still distinct
  // positions, and skipping one could hand back a further match as the nearest.
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (best === null || Math.abs(at - hintOffset) < Math.abs(best - hintOffset)) best = at;
  }

  return best;
}

/** What painting the search match did across every visible page. See `aggregateSearchOutcome`. */
export type SearchPaintOutcome = 'cleared' | 'pending' | 'painted' | 'cued';

/**
 * One answer from the 1–3 surfaces that were asked to paint.
 *
 * >>> "NO SURFACE HAS THIS PAGE" IS `pending`, NOT A FAILURE, AND GETTING THAT WRONG IS VISIBLE. <<<
 * The host sends `paintSearchMatch` immediately after `goTo`, and rasterising the target page is
 * async — so at the moment the payload lands, `pageSurfaces` usually still holds the pages the
 * reader was looking at BEFORE the jump. Every surface then answers `cleared` (correctly: none of
 * them is the match's page), and reading that as "could not paint" puts a notice on screen for a
 * match that paints correctly a frame later. Worse, nothing would retract it: the repaint that
 * follows the render is what reports the real outcome.
 *
 * So the caller passes whether a surface for the match's page EXISTS at all, and the two cases are
 * kept apart: no surface yet -> stay silent; a surface that could not paint -> say so.
 *
 * `painted` outranks `cued` outranks `pending`: in a double-page spread exactly one surface is the
 * match's page and the other correctly clears, so the aggregate has to be "the best thing that
 * happened", not "did everything succeed".
 */
export function aggregateSearchOutcome(
  outcomes: readonly SearchPaintOutcome[],
  hasSurfaceForMatch: boolean,
): SearchPaintOutcome {
  if (outcomes.includes('painted')) return 'painted';
  if (outcomes.includes('cued')) return 'cued';
  if (outcomes.includes('pending')) return 'pending';
  // Every surface cleared. That is a real clear only if the page the match names is on screen and
  // said so; otherwise the page simply is not up yet.
  return hasSurfaceForMatch ? 'cleared' : 'pending';
}
