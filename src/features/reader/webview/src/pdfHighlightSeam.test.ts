/**
 * @jest-environment jsdom
 */
// Owner: Reader (Ahana).
//
// The PDF highlight seam, exercised against a REAL DOM.
//
// >>> WHY THIS FILE EXISTS WHEN ITS SUBJECT IS "NOT UNIT TESTED". <<< `pdfHighlightSeam.ts` is the
// same tier as `highlightSeam.ts` — it touches the DOM, so it is not pure — and the arithmetic it
// leans on is already tested next door in `pdfTextRange.test.ts`. What is NOT covered by either is
// the part that actually broke things on a device: whether the boxes are re-measured when the page
// changes size. A highlight that is painted correctly once and then never re-measured looks perfect
// in every screenshot taken before the reader zooms.
//
// jsdom does no layout, so the geometry is supplied by the fake below — deliberately, and it does
// not weaken the test. What is under test is whether this module RE-READS the geometry at the right
// moments and does the right arithmetic with it, not whether WebKit measures text correctly. The
// fake's whole job is to change its answers when `scale` changes, which is exactly what a zoom does.

import {
  clearTextLayer,
  ensureSurface,
  highlightAtClientPoint,
  paintPage,
  paintSearchPage,
  selectionInSurface,
  setPageText,
  type PdfPageSurface,
} from './pdfHighlightSeam';

// --- the fake layout ---------------------------------------------------------------------------
//
// One text item per line. At scale 1 a character is 10px wide and a line is 20px tall, and the page
// sits at (100, 50) in the viewport. Everything scales together, the way a zoomed PDF page does.

const CHAR_PX = 10;
const LINE_PX = 20;
const PAGE_ORIGIN = { left: 100, top: 50 };

let scale = 1;
/** Which text item each span is, so the fake can place it without reading any real layout. */
const spanIndex = new WeakMap<Node, number>();

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    // Only the page root is ever measured by this module; anything else can answer with the same
    // box without affecting what is under test.
    return rect(PAGE_ORIGIN.left, PAGE_ORIGIN.top, 300 * scale, 400 * scale);
  };

  Range.prototype.getClientRects = function (this: Range): DOMRectList {
    const index = spanIndex.get(this.startContainer.parentElement as Node);
    if (index === undefined) return [] as unknown as DOMRectList;

    const from = this.startOffset;
    const to = this.endOffset;
    if (to <= from) return [] as unknown as DOMRectList;

    // Absolute viewport coordinates, exactly as a browser reports them — the seam is responsible
    // for subtracting the page origin, and getting that wrong is one of the things this catches.
    const boxes = [
      rect(
        PAGE_ORIGIN.left + from * CHAR_PX * scale,
        PAGE_ORIGIN.top + index * LINE_PX * scale,
        (to - from) * CHAR_PX * scale,
        LINE_PX * scale,
      ),
    ];
    return boxes as unknown as DOMRectList;
  };
});

beforeEach(() => {
  scale = 1;
  document.body.replaceChildren();
});

/** A page container with `items` laid out in it, wired the way `renderPageSurface` wires a real one. */
function makeSurface(page: number, items: string[]): PdfPageSurface {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const surface = ensureSurface(page, root);
  const divs = items.map((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    surface.textLayer.appendChild(span);
    spanIndex.set(span, surface.textLayer.children.length - 1);
    return span;
  });
  setPageText(surface, divs, items);
  return surface;
}

const LINES = ['Hello there', 'brave new', 'world again'];

/** `{id, page, startOffset, endOffset, color}` with the boring fields filled in. */
function highlight(startOffset: number, endOffset: number, page = 1, id = 'h1') {
  return { id, page, startOffset, endOffset, color: 'yellow' };
}

function boxesOf(surface: PdfPageSurface): { left: number; top: number; width: number }[] {
  return [...surface.highlightLayer.children].map((el) => {
    const style = (el as HTMLElement).style;
    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
    };
  });
}

describe('the layers a page needs', () => {
  it('creates a text layer and a highlight layer', () => {
    const surface = makeSurface(1, LINES);
    expect(surface.root.querySelectorAll('.pdf-text-layer')).toHaveLength(1);
    expect(surface.root.querySelectorAll('.pdf-highlight-layer')).toHaveLength(1);
  });

  it('is idempotent, so re-rendering a page does not stack a second pair', () => {
    // Every zoom, rotation and spread flip calls this again on the SAME container. A second text
    // layer underneath the first would stay selectable and would double every highlight.
    const surface = makeSurface(1, LINES);
    ensureSurface(1, surface.root);
    ensureSurface(1, surface.root);
    expect(surface.root.querySelectorAll('.pdf-text-layer')).toHaveLength(1);
    expect(surface.root.querySelectorAll('.pdf-highlight-layer')).toHaveLength(1);
  });

  it('hands back a NEW surface object over the SAME elements, which is what makes a stale render dangerous', () => {
    // >>> THE PROPERTY THE RENDER TOKEN IN `pdf.entry.ts` EXISTS TO CONTAIN. <<< Two overlapping
    // `renderPageSurface` passes for one page — rapid zoom, where nothing serialises them — get two
    // surface OBJECTS that share one set of DOM layers. So the older pass finishing last is not
    // merely redundant: `paintPage` is a whole-layer `replaceChildren`, so painting through the
    // stale object ERASES what the live one drew, and the live object's own `boxes` array still
    // claims the boxes are there. Correct pixels, no hit-testing.
    //
    // Asserted here rather than in the entry because this seam is where the sharing is decided; the
    // guard is `surfaceRenderTokens`, which is the half that cannot be reached from a unit test.
    const live = makeSurface(1, LINES);
    paintPage(live, [highlight(0, 5)]);
    expect(boxesOf(live)).toHaveLength(1);

    const stale = ensureSurface(1, live.root);
    expect(stale).not.toBe(live);
    expect(stale.highlightLayer).toBe(live.highlightLayer);

    // A stale pass painting nothing (its `divs` are empty, as a fresh surface's always are) still
    // clears the layer the live pass owns.
    paintPage(stale, [highlight(0, 5)]);
    expect(boxesOf(live)).toHaveLength(0);
    expect(live.boxes).toHaveLength(1);
  });

  it('paints the highlight layer OVER the text layer', () => {
    // Order is what puts the colour on top of the transparent text. Safe only because the boxes take
    // no pointer events — see the module header.
    const surface = makeSurface(1, LINES);
    const children = [...surface.root.children].map((el) => el.className);
    expect(children.indexOf('pdf-highlight-layer')).toBeGreaterThan(
      children.indexOf('pdf-text-layer'),
    );
  });

  it('empties BOTH layers and forgets the boxes when a page is re-rendered', () => {
    // The window between "start re-rendering" and "the new text arrives" is async. Boxes left
    // standing through it hit-test against a page that is no longer there.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);
    expect(surface.boxes.length).toBeGreaterThan(0);

    clearTextLayer(surface);
    expect(surface.textLayer.children).toHaveLength(0);
    expect(surface.highlightLayer.children).toHaveLength(0);
    expect(surface.boxes).toEqual([]);
  });
});

describe('painting a stored highlight', () => {
  it("places one box per line, in the page's own coordinates", () => {
    // The page origin is subtracted: the boxes are absolutely positioned INSIDE the page container,
    // so leaving them in viewport coordinates would offset every highlight by the page's position.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);

    expect(boxesOf(surface)).toEqual([{ left: 0, top: 0, width: 5 * CHAR_PX }]);
  });

  it('spans several lines, taking the middle ones whole', () => {
    // 'Hello there' is 11 chars, 'brave new' is 9. Offsets 6..24 cover the tail of line 0, all of
    // line 1, and the head of line 2.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(6, 24)]);

    expect(boxesOf(surface)).toEqual([
      { left: 6 * CHAR_PX, top: 0, width: 5 * CHAR_PX },
      { left: 0, top: LINE_PX, width: 9 * CHAR_PX },
      { left: 0, top: 2 * LINE_PX, width: 4 * CHAR_PX },
    ]);
  });

  it('carries the stored colour and the id it can be deleted by', () => {
    const surface = makeSurface(1, LINES);
    paintPage(surface, [{ ...highlight(0, 5), color: 'rgb(255, 0, 0)' }]);

    const box = surface.highlightLayer.firstElementChild as HTMLElement;
    expect(box.style.background).toBe('rgb(255, 0, 0)');
    expect(box.dataset.hlId).toBe('h1');
    expect(box.className).toBe('tf-hl-user--saved');
  });

  it('retains multiply blend mode and stored color even when dark theme bg is passed', () => {
    // In PDF, the page is rendered to canvas by pdf.js and theme is not applied directly
    // to the page (the canvas stays white). Highlights must keep multiply blend mode
    // and stored color across all themes rather than switching to screen in dark mode.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [{ ...highlight(0, 5), color: 'yellow' }], '#121212');

    const box = surface.highlightLayer.firstElementChild as HTMLElement;
    expect(box.style.background).toBe('yellow');
    expect(box.style.mixBlendMode).toBe('multiply');
    expect(box.style.opacity).toBe('0.25');
  });

  it("paints only THIS page's highlights — the spread routing", () => {
    // Both pages of a spread are live at once, and each surface must ignore the other's. `page` is
    // in the payload for exactly this.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5, 1, 'mine'), highlight(0, 5, 2, 'theirs')]);

    expect(surface.boxes.map((b) => b.id)).toEqual(['mine']);
  });

  it('replaces the previous paint rather than adding to it', () => {
    // Every repaint is whole-layer. Two calls must not leave two sets of boxes over the same words.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);
    paintPage(surface, [highlight(0, 5)]);

    expect(surface.highlightLayer.children).toHaveLength(1);
  });

  it('clears the page when the last highlight is deleted', () => {
    // An empty set is a legitimate payload, not a no-op: it is what the host sends once the reader
    // has deleted everything.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);
    paintPage(surface, []);

    expect(surface.highlightLayer.children).toHaveLength(0);
    expect(surface.boxes).toEqual([]);
  });

  it('paints nothing on a page with no text layer, instead of throwing', () => {
    // A scanned page. Nothing to select and nothing to anchor to — it must still open and turn.
    const surface = makeSurface(1, []);
    expect(() => {
      paintPage(surface, [highlight(0, 5)]);
    }).not.toThrow();
    expect(surface.highlightLayer.children).toHaveLength(0);
  });

  it('survives a stored offset that runs past the end of the page', () => {
    // What a corrupt row, or the same book re-extracted by a different pdf.js, looks like. Painting a
    // clamped span beats a highlight that silently vanishes.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 9999)]);
    expect(surface.boxes.length).toBeGreaterThan(0);
  });
});

describe('ZOOM: the boxes follow the page, they do not stay where they were painted', () => {
  it('re-measures every box when the page is re-rendered larger', () => {
    // THE CASE THIS FILE WAS WRITTEN FOR. The boxes are absolute pixels measured at paint time, so a
    // zoom that does not repaint leaves the highlight over the wrong words — and looks fine in any
    // screenshot taken before the reader zooms.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(6, 24)]);
    const before = boxesOf(surface);

    // What `renderCurrent`/`renderScrollPage` do on a zoom: the page is rasterised again, the text
    // layer is rebuilt at the new scale, and the highlights are repainted against it.
    scale = 2;
    clearTextLayer(surface);
    const reflowed = makeSurfaceInto(surface, LINES);
    paintPage(reflowed, [highlight(6, 24)]);

    expect(boxesOf(reflowed)).toEqual(
      before.map((b) => ({
        left: b.left * 2,
        top: b.top * 2,
        width: b.width * 2,
      })),
    );
  });

  it('keeps a hit test correct after the zoom, not just the paint', () => {
    // The delete gesture reads `boxes`, so a repaint that updated the DOM but not the recorded
    // geometry would paint correctly and delete the wrong thing.
    const surface = makeSurface(1, LINES);
    scale = 2;
    clearTextLayer(surface);
    const reflowed = makeSurfaceInto(surface, LINES);
    paintPage(reflowed, [highlight(0, 5)]);

    // Line 0 now spans 0..100 across and 0..40 down, in page coordinates -> +origin for the viewport.
    expect(highlightAtClientPoint(reflowed, PAGE_ORIGIN.left + 90, PAGE_ORIGIN.top + 30)).toBe(
      'h1',
    );
    // Where the box USED to end at scale 1.
    expect(highlightAtClientPoint(reflowed, PAGE_ORIGIN.left + 90, PAGE_ORIGIN.top + 5)).toBe('h1');
  });
});

/** Re-lay the same items into an existing surface, as a re-render does. */
function makeSurfaceInto(surface: PdfPageSurface, items: string[]): PdfPageSurface {
  const divs = items.map((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    surface.textLayer.appendChild(span);
    spanIndex.set(span, surface.textLayer.children.length - 1);
    return span;
  });
  setPageText(surface, divs, items);
  return surface;
}

describe('pressing a painted highlight', () => {
  it('finds the highlight under the finger', () => {
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);

    expect(highlightAtClientPoint(surface, PAGE_ORIGIN.left + 25, PAGE_ORIGIN.top + 10)).toBe('h1');
  });

  it('finds it from ONE word inside a multi-line highlight', () => {
    // The reader is told they can press anywhere in it. The middle line is the case a
    // first-box-only implementation would miss.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(6, 24)]);

    expect(
      highlightAtClientPoint(surface, PAGE_ORIGIN.left + 40, PAGE_ORIGIN.top + LINE_PX + 10),
    ).toBe('h1');
  });

  it('answers null off the highlight, so an ordinary press does nothing', () => {
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(0, 5)]);

    expect(
      highlightAtClientPoint(surface, PAGE_ORIGIN.left + 200, PAGE_ORIGIN.top + 10),
    ).toBeNull();
  });
});

describe('turning a selection into the span to store', () => {
  function select(surface: PdfPageSurface, from: [number, number], to: [number, number]) {
    const selection = window.getSelection();
    selection?.setBaseAndExtent(
      surface.divs[from[0]].firstChild as Node,
      from[1],
      surface.divs[to[0]].firstChild as Node,
      to[1],
    );
    return selection as Selection;
  }

  it('maps a selection inside one line to page offsets', () => {
    const surface = makeSurface(1, LINES);
    expect(selectionInSurface(surface, select(surface, [0, 2], [0, 7]))).toEqual({
      startOffset: 2,
      endOffset: 7,
    });
  });

  it('maps a selection across lines, counting the items in between', () => {
    const surface = makeSurface(1, LINES);
    expect(selectionInSurface(surface, select(surface, [0, 6], [2, 4]))).toEqual({
      startOffset: 6,
      endOffset: 24,
    });
  });

  it('normalises a BACKWARDS drag', () => {
    // Dragging right to left reports the anchor after the focus. A highlight has no direction, and
    // one stored reversed saves successfully and paints nothing.
    const surface = makeSurface(1, LINES);
    expect(selectionInSurface(surface, select(surface, [2, 4], [0, 6]))).toEqual({
      startOffset: 6,
      endOffset: 24,
    });
  });

  it('refuses a collapsed selection', () => {
    const surface = makeSurface(1, LINES);
    expect(selectionInSurface(surface, select(surface, [0, 3], [0, 3]))).toBeNull();
  });

  it('refuses a selection that started on ANOTHER page of the spread', () => {
    // `SelectionRange` is single-page by construction, so half of a cross-page drag would be stored
    // silently and the other half lost. Refused rather than truncated.
    const left = makeSurface(1, LINES);
    const right = makeSurface(2, LINES);
    const selection = window.getSelection();
    selection?.setBaseAndExtent(
      left.divs[0].firstChild as Node,
      2,
      right.divs[0].firstChild as Node,
      4,
    );

    expect(selectionInSurface(left, selection as Selection)).toBeNull();
    expect(selectionInSurface(right, selection as Selection)).toBeNull();
  });
});

// --- the search-match layer ----------------------------------------------------------------------
//
// Same harness, third layer. What is under test here is what jsdom CAN see and a device screenshot
// cannot argue with: which layer a box lands in, which page of a spread paints, and whether the
// fallback fires instead of a confidently-wrong box.

const STROKE = '#0a84ff';

function searchBoxesOf(surface: PdfPageSurface): { left: number; top: number; width: number }[] {
  return [...surface.searchLayer.children].map((el) => {
    const style = (el as HTMLElement).style;
    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
    };
  });
}

/** `{page, startOffset, matchText}` — the payload `toReaderSearchMatch` builds. `startOffset` is in
 * the SEARCH INDEX's space (a separator after every run), which is the whole reason the seam
 * converts before it paints. */
function match(page: number, startOffset: number, matchText: string) {
  return { page, startOffset, matchText };
}

describe('painting the search match', () => {
  it('boxes the matched word, and puts it in the SEARCH layer, not the highlight layer', () => {
    const surface = makeSurface(1, LINES);
    // 'brave' is at index-space offset 12: 'Hello there' (11) + one separator.
    expect(paintSearchPage(surface, match(1, 12, 'brave'), STROKE)).toBe('painted');

    expect(searchBoxesOf(surface)).toEqual([{ left: 0, top: LINE_PX, width: 5 * CHAR_PX }]);
    // The user layer is untouched — the two compose (HIGHLIGHT_LAYERS.md §3) rather than sharing a
    // layer where one repaint would wipe the other.
    expect(surface.highlightLayer.children).toHaveLength(0);
  });

  it('converts the index-space offset rather than trusting it — the off-by-N guard, on a real DOM', () => {
    const surface = makeSurface(1, LINES);
    // 'world' is at page offset 20 and index offset 22 (two separators passed). Painting at the raw
    // offset would box 'd again' on the wrong side of the word.
    paintSearchPage(surface, match(1, 22, 'world'), STROKE);
    expect(searchBoxesOf(surface)).toEqual([{ left: 0, top: 2 * LINE_PX, width: 5 * CHAR_PX }]);
  });

  it('composes over a user highlight instead of replacing it', () => {
    // The case HIGHLIGHT_LAYERS.md §3 makes an acceptance criterion: a search hit inside a saved
    // highlight, both still legible.
    const surface = makeSurface(1, LINES);
    paintPage(surface, [highlight(11, 20)], '#ffffff');
    paintSearchPage(surface, match(1, 12, 'brave'), STROKE);

    expect(surface.highlightLayer.children).toHaveLength(1);
    expect(surface.searchLayer.children).toHaveLength(1);
    // DOM order is the z-order, and search has to be the later sibling.
    const layers = [...surface.root.children].map((el) => el.className);
    expect(layers.indexOf('pdf-search-layer')).toBeGreaterThan(
      layers.indexOf('pdf-highlight-layer'),
    );
  });

  it('routes to the right page of a spread, and clears the other one', () => {
    // Spread-awareness, exercised as two surfaces rather than as a mode. This is the same filter
    // `paintPage` uses, which is why a double spread, single page and continuous scroll are one
    // code path with a different number of surfaces.
    const left = makeSurface(4, LINES);
    const right = makeSurface(5, LINES);

    expect(paintSearchPage(left, match(5, 0, 'Hello'), STROKE)).toBe('cleared');
    expect(paintSearchPage(right, match(5, 0, 'Hello'), STROKE)).toBe('painted');

    expect(left.searchLayer.children).toHaveLength(0);
    expect(right.searchLayer.children).toHaveLength(1);
  });

  it('re-measures against the new geometry after a zoom', () => {
    // The defect this whole file was written for, now for the third layer: a box painted once and
    // never re-measured looks perfect in every screenshot taken before the reader zooms.
    const surface = makeSurface(1, LINES);
    paintSearchPage(surface, match(1, 12, 'brave'), STROKE);
    expect(searchBoxesOf(surface)[0].width).toBe(5 * CHAR_PX);

    scale = 2;
    paintSearchPage(surface, match(1, 12, 'brave'), STROKE);
    expect(searchBoxesOf(surface)).toEqual([{ left: 0, top: LINE_PX * 2, width: 5 * CHAR_PX * 2 }]);
  });

  it('replaces the previous match rather than accumulating them — one match at a time', () => {
    const surface = makeSurface(1, LINES);
    paintSearchPage(surface, match(1, 0, 'Hello'), STROKE);
    paintSearchPage(surface, match(1, 12, 'brave'), STROKE);
    expect(searchBoxesOf(surface)).toEqual([{ left: 0, top: LINE_PX, width: 5 * CHAR_PX }]);
  });

  it('clears on a null match, which is how the panel closing un-paints', () => {
    const surface = makeSurface(1, LINES);
    paintSearchPage(surface, match(1, 0, 'Hello'), STROKE);
    expect(paintSearchPage(surface, null, STROKE)).toBe('cleared');
    expect(surface.searchLayer.children).toHaveLength(0);
  });

  it('cues the whole page when the term cannot be located on it', () => {
    // The v1 fallback under the v2 box. A phrase split across two runs is the known case: this
    // space has no separators, so 'there brave' reads as 'therebrave' and is not findable. Saying
    // "it is on this page" beats saying nothing, and beats a box in an invented place.
    const surface = makeSurface(1, LINES);
    expect(paintSearchPage(surface, match(1, 6, 'there brave'), STROKE)).toBe('cued');

    const cue = surface.searchLayer.children[0] as HTMLElement;
    expect(cue.className).toBe('tf-hl-search--page');
    expect(cue.style.borderColor).toBeTruthy();
    // Sized by the stylesheet, not by measurement — nothing inline that would pin it to a stale
    // layout the way a box is pinned.
    expect(cue.style.left).toBe('');
  });

  it('reports PENDING rather than failure for a page whose text has not been laid out', () => {
    // A page mid-render is not a miss. `pdf.entry.ts` repaints right after `setPageText`, so
    // reporting a failure here would flash a notice for a match that paints correctly a frame later.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const surface = ensureSurface(1, root);
    expect(paintSearchPage(surface, match(1, 0, 'Hello'), STROKE)).toBe('pending');
  });

  it('drops the outline when the text layer is cleared for a re-render', () => {
    // Same reasoning `clearTextLayer` gives for the highlight boxes: between "start re-rendering"
    // and "the new text arrives" a standing box describes a layout that no longer exists.
    const surface = makeSurface(1, LINES);
    paintSearchPage(surface, match(1, 0, 'Hello'), STROKE);
    clearTextLayer(surface);
    expect(surface.searchLayer.children).toHaveLength(0);
    expect(surface.texts).toEqual([]);
  });

  it('reuses the same three layers when a page is re-rendered', () => {
    // `ensureSurface` is idempotent; a fourth and fifth layer would leave the previous outline
    // standing underneath the new one.
    const surface = makeSurface(1, LINES);
    ensureSurface(1, surface.root);
    expect(surface.root.querySelectorAll('.pdf-search-layer')).toHaveLength(1);
  });
});
