// Owner: Reader (Ahana).
//
// The offset arithmetic a PDF highlight lives or dies by. A stored PDF highlight is two character
// offsets into a page's text (see pdfTextRange.ts's header for why it is not a rectangle), so every
// off-by-one here is a highlight that paints over the wrong words — visible on a device, invisible
// to any test that stops at the entry's door. Hence a pure module, and hence these.
//
// The running example is a three-item page, which is what pdf.js's text layer actually produces: one
// span per text run, no separators between them.
//
//   item 0: "Hello "   offsets 0..5
//   item 1: "brave"    offsets 6..10
//   item 2: " world"   offsets 11..16

import {
  itemStarts,
  locateOffset,
  offsetsForSelection,
  pageLength,
  slicesForRange,
} from './pdfTextRange';

const LENGTHS = [6, 5, 6];

describe('the page offset index', () => {
  it('starts each item where the previous one ended, with a total on the end', () => {
    // The trailing total is what lets "does offset X fall inside item i" read `starts[i+1]` with no
    // special case for the last item.
    expect(itemStarts(LENGTHS)).toEqual([0, 6, 11, 17]);
  });

  it('counts the whole page', () => {
    expect(pageLength(LENGTHS)).toBe(17);
    expect(pageLength([])).toBe(0);
  });
});

describe('locating one offset', () => {
  it('finds the item an offset falls inside', () => {
    expect(locateOffset(LENGTHS, 0)).toEqual({ index: 0, withinItem: 0 });
    expect(locateOffset(LENGTHS, 8)).toEqual({ index: 1, withinItem: 2 });
    expect(locateOffset(LENGTHS, 16)).toEqual({ index: 2, withinItem: 5 });
  });

  it('puts a boundary offset on the NEXT item when it starts a span', () => {
    expect(locateOffset(LENGTHS, 6)).toEqual({ index: 1, withinItem: 0 });
  });

  it('puts the same boundary offset on the PREVIOUS item when it ends one', () => {
    // The distinction that stops a range ending exactly on a boundary from claiming a zero-length
    // slice of the next item — which paints a stray sliver at the start of the following line.
    expect(locateOffset(LENGTHS, 6, true)).toEqual({ index: 0, withinItem: 6 });
  });

  it('clamps past the end rather than refusing', () => {
    // A stored offset can outrun the page if the same book is re-extracted by a different pdf.js.
    // Painting a slightly wrong span beats a highlight that silently vanishes with no explanation.
    expect(locateOffset(LENGTHS, 999, true)).toEqual({ index: 2, withinItem: 6 });
    expect(locateOffset(LENGTHS, -5)).toEqual({ index: 0, withinItem: 0 });
  });

  it('survives a page with no text at all', () => {
    // A scanned page with no text layer. Nothing to select, nothing to paint, and nothing that
    // should throw on the way to finding that out.
    expect(locateOffset([], 3)).toEqual({ index: 0, withinItem: 0 });
    expect(slicesForRange([], 0, 5)).toEqual([]);
  });
});

describe('a stored span -> the slices that paint it', () => {
  it('slices a span inside one item', () => {
    expect(slicesForRange(LENGTHS, 6, 11)).toEqual([{ index: 1, from: 0, to: 5 }]);
  });

  it('slices a span across several items, taking each one whole in the middle', () => {
    expect(slicesForRange(LENGTHS, 3, 13)).toEqual([
      { index: 0, from: 3, to: 6 },
      { index: 1, from: 0, to: 5 },
      { index: 2, from: 0, to: 2 },
    ]);
  });

  it('covers the whole page when asked for the whole page', () => {
    expect(slicesForRange(LENGTHS, 0, 17)).toEqual([
      { index: 0, from: 0, to: 6 },
      { index: 1, from: 0, to: 5 },
      { index: 2, from: 0, to: 6 },
    ]);
  });

  it('emits no zero-length slice at a boundary', () => {
    // A span ending exactly where item 1 begins must not produce an empty slice of item 1.
    expect(slicesForRange(LENGTHS, 0, 6)).toEqual([{ index: 0, from: 0, to: 6 }]);
  });

  it('returns nothing for an empty or reversed span', () => {
    expect(slicesForRange(LENGTHS, 5, 5)).toEqual([]);
    expect(slicesForRange(LENGTHS, 9, 2)).toEqual([]);
  });
});

describe('a live selection -> the span to store', () => {
  it('turns two anchors into page offsets', () => {
    expect(
      offsetsForSelection(LENGTHS, { index: 0, withinItem: 3 }, { index: 2, withinItem: 2 }),
    ).toEqual({ startOffset: 3, endOffset: 13 });
  });

  it('normalises a BACKWARDS drag', () => {
    // A selection dragged right-to-left reports its anchor after its focus. A highlight has no
    // direction, and storing one reversed saves successfully and paints nothing — the worst kind of
    // failure, because it looks like the save is broken rather than the order.
    expect(
      offsetsForSelection(LENGTHS, { index: 2, withinItem: 2 }, { index: 0, withinItem: 3 }),
    ).toEqual({ startOffset: 3, endOffset: 13 });
  });

  it('clamps an anchor that overruns its item', () => {
    expect(
      offsetsForSelection(LENGTHS, { index: 1, withinItem: 99 }, { index: 1, withinItem: 0 }),
    ).toEqual({ startOffset: 6, endOffset: 11 });
  });
});
