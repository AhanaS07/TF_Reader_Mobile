/**
 * @jest-environment jsdom
 */
// Owner: Reader (Ahana).
//
// The box hit test both shells press-to-delete on, and the range-overlap rule that decides whether
// a selection meets an existing highlight.
//
// jsdom for the second half: `Range.compareBoundaryPoints` is real DOM behaviour over real document
// order, and reimplementing it in a fake would be testing the fake. No layout is involved — an
// overlap is a question about tree positions, not pixels — so jsdom answers it exactly as WebKit
// does. The box half needs no DOM at all and is plain arithmetic.
//
// The box hit test both shells press-to-delete on. Moved here with `highlightAt` itself when the
// EPUB shell stopped converting a touch to a caret and started measuring rects like the PDF shell
// always has — see highlightGeometry.ts's header for why a caret was the wrong primitive.

import { highlightAt, rangesOverlap } from './highlightGeometry';

describe('hit-testing a tap against painted boxes', () => {
  const BOXES = [
    { id: 'under', left: 0, top: 0, width: 100, height: 20 },
    { id: 'over', left: 40, top: 0, width: 100, height: 20 },
  ];

  it('finds the box a point is inside', () => {
    expect(highlightAt(BOXES, 10, 10)).toBe('under');
  });

  it('returns null outside every box', () => {
    expect(highlightAt(BOXES, 10, 50)).toBeNull();
    expect(highlightAt(BOXES, 200, 10)).toBeNull();
    expect(highlightAt([], 1, 1)).toBeNull();
  });

  it('prefers the LAST box where two overlap, which is the one on top', () => {
    // Boxes are appended in paint order, so the last is the topmost. A tap on overlapping highlights
    // must delete the one the user can actually see.
    expect(highlightAt(BOXES, 50, 10)).toBe('over');
  });

  it('counts the edges as inside', () => {
    expect(highlightAt([BOXES[0]], 0, 0)).toBe('under');
    expect(highlightAt([BOXES[0]], 100, 20)).toBe('under');
  });
});

describe('whether a selection meets an existing highlight', () => {
  /** One paragraph of plain text, so every range below is expressed as two character offsets into
   * it — the same shape as a reader dragging across a line. */
  function text(): Text {
    document.body.innerHTML = '<p>Call me Ishmael.</p>';
    const node = document.querySelector('p')?.firstChild;
    if (!(node instanceof Text)) throw new Error('fixture did not build');
    return node;
  }

  function range(node: Text, start: number, end: number): Range {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  }

  it('finds a selection that lies inside a highlight', () => {
    const node = text();
    expect(rangesOverlap(range(node, 5, 7), range(node, 0, 16))).toBe(true);
  });

  it('finds a selection that a highlight lies inside', () => {
    const node = text();
    expect(rangesOverlap(range(node, 0, 16), range(node, 5, 7))).toBe(true);
  });

  it('finds a selection dragged INTO a highlight from outside it', () => {
    // The case the old point-at-touchstart test got wrong: the press began on plain text, so
    // `pressedHighlightId` was null, the menu offered "Highlight", and taking it painted a second
    // annotation over the first.
    const node = text();
    expect(rangesOverlap(range(node, 0, 8), range(node, 5, 16))).toBe(true);
  });

  it('finds a selection dragged OUT of a highlight', () => {
    const node = text();
    expect(rangesOverlap(range(node, 5, 16), range(node, 0, 8))).toBe(true);
  });

  it('does not count a selection that merely abuts a highlight', () => {
    // Highlighting the sentence after the one you already highlighted must still be allowed, so
    // touching at exactly one boundary point is not touching.
    const node = text();
    expect(rangesOverlap(range(node, 0, 8), range(node, 8, 16))).toBe(false);
    expect(rangesOverlap(range(node, 8, 16), range(node, 0, 8))).toBe(false);
  });

  it('does not count a selection that misses entirely', () => {
    const node = text();
    expect(rangesOverlap(range(node, 0, 4), range(node, 8, 16))).toBe(false);
  });

  it('counts a collapsed range INSIDE a highlight, and that is the right answer', () => {
    // Not a special case dressed up as one: a caret resting inside a highlight is a reader pointing
    // at it, and pointing at a highlight is exactly what should offer to delete it. Recorded
    // because it looks like an oversight — the callers all guard on `isCollapsed` before they get
    // here, so it changes nothing today, and a future caller that drops the guard gets sensible
    // behaviour rather than a surprise.
    const node = text();
    expect(rangesOverlap(range(node, 5, 5), range(node, 0, 16))).toBe(true);
  });

  it('does not count a collapsed range outside every highlight', () => {
    const node = text();
    expect(rangesOverlap(range(node, 2, 2), range(node, 8, 16))).toBe(false);
  });

  it('throws across documents, which is how another chapter is recognised', () => {
    // The painted map is not chapter-scoped, so a highlight from a different spine document is
    // reached every time. `epub.entry.ts` catches this and skips; it must not read as a match.
    const node = text();
    const other = document.implementation.createHTMLDocument('other');
    other.body.innerHTML = '<p>Some years ago.</p>';
    const otherNode = other.querySelector('p')?.firstChild;
    if (!(otherNode instanceof Text)) throw new Error('fixture did not build');
    const foreign = other.createRange();
    foreign.setStart(otherNode, 0);
    foreign.setEnd(otherNode, 4);

    expect(() => rangesOverlap(range(node, 0, 4), foreign)).toThrow();
  });
});
