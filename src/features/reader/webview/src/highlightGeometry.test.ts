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

import {
  anyRectOnScreen,
  highlightAt,
  rangesOverlap,
  readingZoneScrollDelta,
} from './highlightGeometry';

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

describe('whether any rect is on screen', () => {
  const VIEWPORT = { left: 0, top: 0, right: 100, bottom: 50 };

  it('is true for a rect fully inside the viewport', () => {
    expect(anyRectOnScreen([{ left: 10, top: 10, width: 20, height: 10 }], VIEWPORT)).toBe(true);
  });

  it('is false for a rect entirely past the right edge', () => {
    expect(anyRectOnScreen([{ left: 100, top: 0, width: 20, height: 10 }], VIEWPORT)).toBe(false);
  });

  it('is false for a rect entirely past the bottom edge', () => {
    expect(anyRectOnScreen([{ left: 0, top: 50, width: 20, height: 10 }], VIEWPORT)).toBe(false);
  });

  it('is true for a rect straddling an edge — partial overlap counts', () => {
    // The case this exists for: a sentence painted where it starts, on this page, that runs on
    // past the edge into the next. It is visible where it starts, so it is not "off-screen."
    expect(anyRectOnScreen([{ left: 90, top: 0, width: 20, height: 10 }], VIEWPORT)).toBe(true);
  });

  it('ignores a zero-width or zero-height rect', () => {
    expect(anyRectOnScreen([{ left: 10, top: 10, width: 0, height: 10 }], VIEWPORT)).toBe(false);
    expect(anyRectOnScreen([{ left: 10, top: 10, width: 10, height: 0 }], VIEWPORT)).toBe(false);
  });

  it('is true if ANY rect in the list is on screen, even if others are not', () => {
    expect(
      anyRectOnScreen(
        [
          { left: 200, top: 0, width: 10, height: 10 },
          { left: 10, top: 10, width: 10, height: 10 },
        ],
        VIEWPORT,
      ),
    ).toBe(true);
  });

  it('works against a viewport NOT anchored at the origin', () => {
    // epub.entry.ts's actual caller: both the rect and the viewport are `getBoundingClientRect()`s
    // in the outer document, and the outer document's stage is not at (0,0) — a toolbar above it,
    // say. A rect at (10, 10) is inside a viewport starting at (0, 0) but not one starting at
    // (500, 500), even though the rect's own numbers didn't change.
    const offsetViewport = { left: 500, top: 500, right: 600, bottom: 550 };
    expect(anyRectOnScreen([{ left: 10, top: 10, width: 20, height: 10 }], offsetViewport)).toBe(
      false,
    );
    expect(anyRectOnScreen([{ left: 510, top: 510, width: 20, height: 10 }], offsetViewport)).toBe(
      true,
    );
  });

  it('is false for an empty list', () => {
    expect(anyRectOnScreen([], VIEWPORT)).toBe(false);
  });
});

describe('the teleprompter reading-zone reposition delta', () => {
  // A 0-100 tall viewport (anchored at the origin for readability), reposition triggers past 75%
  // down and lands the target's deepest point at 35% down.
  const VIEWPORT = { left: 0, top: 0, right: 200, bottom: 100 };
  const ZONE = { triggerFraction: 0.75, targetFraction: 0.35 };

  it('is null when the target is comfortably inside the zone', () => {
    // Deepest bottom at 50 -> 50% down, well short of the 75% trigger.
    expect(
      readingZoneScrollDelta([{ left: 0, top: 40, width: 100, height: 10 }], VIEWPORT, ZONE),
    ).toBeNull();
  });

  it('returns a positive (downward) delta once the target reaches the trigger fraction', () => {
    // Deepest bottom at 80 -> 80% down, past the 75% trigger. Target lands at 35% (=35), so the
    // delta scrolls the content up by 80 - 35 = 45.
    const delta = readingZoneScrollDelta(
      [{ left: 0, top: 70, width: 100, height: 10 }],
      VIEWPORT,
      ZONE,
    );
    expect(delta).toBe(45);
  });

  it('fires exactly AT the trigger fraction, not only past it', () => {
    // Deepest bottom at exactly 75 -> boundary case, must still reposition.
    const delta = readingZoneScrollDelta(
      [{ left: 0, top: 65, width: 100, height: 10 }],
      VIEWPORT,
      ZONE,
    );
    expect(delta).not.toBeNull();
  });

  it('never fires for a target above the zone — this mechanism only ever scrolls forward', () => {
    // Deepest bottom at 10 -> 10% down, comfortably above the trigger. There is no "scroll up"
    // branch to reach here regardless of how far above the zone the target sits.
    expect(
      readingZoneScrollDelta([{ left: 0, top: 0, width: 100, height: 10 }], VIEWPORT, ZONE),
    ).toBeNull();
    // Even a target that starts negative (partially scrolled past the top already) must not
    // trigger — this mechanism does not correct for that direction at all.
    expect(
      readingZoneScrollDelta([{ left: 0, top: -50, width: 100, height: 5 }], VIEWPORT, ZONE),
    ).toBeNull();
  });

  it('judges a multi-line (multi-rect) target by its DEEPEST rect, not its first', () => {
    // The sentence starts comfortably in view (first rect at 10% down) but wraps down to 90% —
    // the part that would actually be cut off first. Must reposition off the second rect.
    const delta = readingZoneScrollDelta(
      [
        { left: 0, top: 10, width: 100, height: 10 }, // first line: 10-20%, in view
        { left: 0, top: 85, width: 100, height: 5 }, // second line: 85-90%, past trigger
      ],
      VIEWPORT,
      ZONE,
    );
    expect(delta).not.toBeNull();
    expect(delta).toBe(90 - 35); // deepest bottom (90) minus the target position (35)
  });

  it('is null for an empty rects list — nothing to measure', () => {
    expect(readingZoneScrollDelta([], VIEWPORT, ZONE)).toBeNull();
  });

  it('is null for a degenerate zero-height viewport rather than dividing by zero', () => {
    const flatViewport = { left: 0, top: 50, right: 200, bottom: 50 };
    expect(
      readingZoneScrollDelta([{ left: 0, top: 40, width: 100, height: 10 }], flatViewport, ZONE),
    ).toBeNull();
  });
});
