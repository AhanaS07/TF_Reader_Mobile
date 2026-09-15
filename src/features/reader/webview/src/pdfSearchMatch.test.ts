// Owner: Reader (Ahana).
//
// >>> THIS FILE EXISTS BECAUSE OF ONE OFF-BY-N THAT NOTHING ELSE COULD SEE. <<<
// A PDF search hit's `Locator.offset` and the text layer's character offsets are counted by two
// different extractions of the same page, and they DISAGREE: `search/extractor.ts`'s
// `pageItemsToText` appends a separator after every text item, and `pdfHighlightSeam.ts`'s
// `setPageText` appends nothing. Feeding one to the other paints a box one character per preceding
// item too far along — a plausible-looking outline around the wrong word, which reads as a search
// bug rather than an arithmetic one and is invisible in every screenshot that does not include the
// word the reader actually typed.
//
// So the fixtures below are built the way BOTH sides build them, from one shared list of items, and
// the assertions compare positions rather than restating the formula.

import {
  aggregateSearchOutcome,
  indexOffsetToPageOffset,
  resolveMatchOffset,
} from './pdfSearchMatch';

/** One page's text runs, as pdf.js hands them back. Two lines, four runs. */
const ITEMS = ['The quick', 'brown fox', 'jumps over', 'the lazy dog'];
const LENGTHS = ITEMS.map((item) => item.length);

/** How SEARCH sees the page: a separator after every run (`extractor.ts:299-306`). */
const indexText = ITEMS.map((item) => `${item} `).join('');
/** How THE READER sees it: the runs, concatenated (`pdfTextRange.ts`'s header). */
const pageText = ITEMS.join('');

/** Where a term sits in the search index's space — i.e. what a `SearchHit` would carry. */
function indexOffsetOf(term: string): number {
  const at = indexText.indexOf(term);
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

/** Where the same term sits in the text layer's space — i.e. what `slicesForRange` wants. */
function pageOffsetOf(term: string): number {
  const at = pageText.indexOf(term);
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

describe('index-space offset -> text-layer-space offset', () => {
  it('is the identity inside the FIRST item, where no separator has been passed yet', () => {
    // The reason this defect is so easy to miss: the first run always looks right.
    expect(indexOffsetToPageOffset(LENGTHS, indexOffsetOf('quick'))).toBe(pageOffsetOf('quick'));
    expect(indexOffsetToPageOffset(LENGTHS, 0)).toBe(0);
  });

  it('drifts by exactly one character per preceding item, and corrects it', () => {
    for (const term of ['brown', 'jumps', 'lazy']) {
      const index = indexOffsetOf(term);
      const page = pageOffsetOf(term);
      // The defect, stated as a fact about the fixtures rather than as a restatement of the
      // formula: the raw offset is wrong, and wrong by exactly the number of runs before it — one
      // separator each. `brown` is in run 1, `jumps` in run 2, `lazy` in run 3.
      expect(index).not.toBe(page);
      expect(index - page).toBe(ITEMS.findIndex((item) => item.includes(term)));
      // The fix.
      expect(indexOffsetToPageOffset(LENGTHS, index)).toBe(page);
    }
  });

  it('maps an offset landing on a separator to the END of the item before it', () => {
    // The one position with no counterpart in text-layer space. The separator is whitespace the
    // reader never sees, so the end of the run it follows is where it visually belongs.
    expect(indexOffsetToPageOffset(LENGTHS, LENGTHS[0])).toBe(LENGTHS[0]);
  });

  it('refuses an offset past the end of the page rather than clamping to it', () => {
    // Clamping is right for a stored HIGHLIGHT (painting a slightly wrong span beats a note that
    // vanishes — `locateOffset`'s own note). It is wrong here: a transient match has no user data
    // to lose, and null buys the page-level cue instead of a box at an arbitrary place.
    expect(indexOffsetToPageOffset(LENGTHS, indexText.length + 1)).toBeNull();
    expect(indexOffsetToPageOffset([], 0)).toBeNull();
  });

  it('refuses a negative or non-integer offset', () => {
    expect(indexOffsetToPageOffset(LENGTHS, -1)).toBeNull();
    expect(indexOffsetToPageOffset(LENGTHS, 2.5)).toBeNull();
  });

  it('treats a negative recorded length as zero rather than walking backwards', () => {
    // A zero-length run still costs its separator in index space, so index offset 1 is the start of
    // the second run — page offset 0, because the first contributed no characters.
    expect(indexOffsetToPageOffset([-4, 5], 1)).toBe(0);
  });
});

describe('verifying the offset against the page it will paint on', () => {
  it('accepts an offset that already lands on the term', () => {
    const at = pageOffsetOf('brown');
    expect(resolveMatchOffset(ITEMS, at, 'brown')).toBe(at);
  });

  it('is case-insensitive, because queryIndex is and the reader types the query', () => {
    expect(resolveMatchOffset(ITEMS, pageOffsetOf('brown'), 'BROWN')).toBe(pageOffsetOf('brown'));
  });

  it('REPAIRS an offset that does not land on the term — the guard that earns this function', () => {
    // Exactly the failure `indexOffsetToPageOffset` prevents, arriving anyway: a hint carrying the
    // raw index-space offset. Rather than paint there, find where the term really is.
    expect(resolveMatchOffset(ITEMS, indexOffsetOf('brown'), 'brown')).toBe(pageOffsetOf('brown'));
  });

  it('picks the occurrence NEAREST the hint, not the first one on the page', () => {
    // A page can hold the term many times and the index already knows which one this hit is. First
    // -match would make every match on a page paint on the same word, so stepping through results
    // would look stuck.
    const items = ['alpha beta', 'gamma beta', 'delta beta'];
    const text = items.join('');
    const third = text.lastIndexOf('beta');
    expect(resolveMatchOffset(items, third + 1, 'beta')).toBe(third);
    expect(resolveMatchOffset(items, 0, 'beta')).toBe(text.indexOf('beta'));
  });

  it('finds overlapping occurrences, so the nearest is really the nearest', () => {
    expect(resolveMatchOffset(['aaa'], 2, 'aa')).toBe(1);
  });

  it('gives up on a term that is not on the page — the signal for the page-level cue', () => {
    expect(resolveMatchOffset(ITEMS, 0, 'zebra')).toBeNull();
  });

  it('gives up on a PHRASE split across two runs, which is the known limit', () => {
    // This space has no separators, so 'The quick' + 'brown fox' reads as 'The quickbrown fox'. The
    // caller answers with the page cue: the PAGE is right, only the box is unknown. Recorded as a
    // test rather than a comment so it cannot quietly change into a wrong box.
    expect(resolveMatchOffset(ITEMS, 0, 'quick brown')).toBeNull();
  });

  it('gives up on an empty term or an empty page', () => {
    expect(resolveMatchOffset(ITEMS, 0, '   ')).toBeNull();
    expect(resolveMatchOffset([], 0, 'brown')).toBeNull();
    expect(resolveMatchOffset(['', ''], 0, 'brown')).toBeNull();
  });
});

// --- deciding what to tell the host, across the visible pages ------------------------------------

describe('aggregating what the visible surfaces did', () => {
  it('reports PENDING when no surface holds the match page yet — the false-notice guard', () => {
    // THE CASE THIS EXISTS FOR. The host sends `paintSearchMatch` immediately after `goTo`, and
    // rasterising the target page is async — so `pageSurfaces` still holds the pages the reader was
    // on before the jump, and every one of them correctly answers `cleared`. Reading that as "could
    // not paint" puts a notice on screen for a match that paints correctly a frame later, and
    // nothing would retract it.
    expect(aggregateSearchOutcome(['cleared', 'cleared'], false)).toBe('pending');
  });

  it('reports CLEARED only when the match page IS on screen and cleared', () => {
    expect(aggregateSearchOutcome(['cleared', 'cleared'], true)).toBe('cleared');
  });

  it('takes the best outcome, because a spread always has one page that correctly clears', () => {
    // Two surfaces, one match: the other page clearing is the normal case, not a partial failure.
    expect(aggregateSearchOutcome(['cleared', 'painted'], true)).toBe('painted');
    expect(aggregateSearchOutcome(['cued', 'cleared'], true)).toBe('cued');
    expect(aggregateSearchOutcome(['painted', 'cued'], true)).toBe('painted');
  });

  it('prefers a real answer over pending, but pending over a bare clear', () => {
    expect(aggregateSearchOutcome(['pending', 'painted'], true)).toBe('painted');
    expect(aggregateSearchOutcome(['pending', 'cleared'], true)).toBe('pending');
  });

  it('reports CLEARED for a genuine clear, where there is no match page to look for', () => {
    // `searchMatch === null`, so the caller passes `true` — nothing is pending.
    expect(aggregateSearchOutcome([], true)).toBe('cleared');
  });

  it('reports PENDING when there are no surfaces at all and a match is waiting', () => {
    expect(aggregateSearchOutcome([], false)).toBe('pending');
  });
});
