// Owner: Reader (Ahana).
//
// THE PDF HALF OF THE HIGHLIGHT SEAM — the sibling `HIGHLIGHT_LAYERS.md` asks for in its "PDF is out
// of scope (for now)" section, now that it is in scope. Same tier as `highlightSeam.ts`: it touches
// the DOM and is therefore not unit-tested, so everything that is arithmetic lives in
// `pdfTextRange.ts` next door and is called from here.
//
// >>> A PDF PAGE IS A BITMAP, SO A HIGHLIGHT NEEDS A TEXT LAYER TO EXIST AT ALL. <<<
// The EPUB shell can hand epub.js a CFI and let it find the words; pdf.js rasterises a page to a
// canvas, and a canvas has no text, no selection and nothing to anchor to. So this file builds the
// standard pdf.js TEXT LAYER — one transparent, absolutely-positioned `<span>` per text item, laid
// over the canvas — which buys three things at once: the user can select text, a selection maps to
// character offsets (what `highlightStore` stores), and a stored offset maps back to on-screen
// rectangles (what painting needs).
//
// SPREAD-AWARE BY CONSTRUCTION, which HIGHLIGHT_LAYERS.md requires "from day one": everything here
// is keyed on a PAGE NUMBER and scoped to that page's own surface. Two pages visible side by side
// are two surfaces; the double-page spread, single-page and continuous-scroll modes differ only in
// how many surfaces exist and where they sit, not in anything below. `page` travels in the paint
// payload for exactly this reason (`PdfHighlightPaint`), so routing needs no guesswork.
//
// THE HIGHLIGHT BOXES ARE `pointer-events: none`, AND THAT IS LOAD-BEARING, NOT COSMETIC. A box that
// can be clicked is a box that swallows the drag that starts inside it, which would make a highlight
// impossible to extend or to select through. Taps are resolved by hit-testing the surface's own
// click against the boxes' geometry instead — `highlightAt` in highlightGeometry.ts.

import type { PdfHighlightPaint } from '@/features/personalization/readerHighlights';

import { highlightAt, type HighlightBox } from './highlightGeometry';
import { annotationClassName } from './highlightNaming';
import { offsetsForSelection, slicesForRange } from './pdfTextRange';
import { highlightFill } from './selectionTheme';

/** The class the text-layer container carries. Matched by the template's CSS, and by
 * `surfaceForNode` below when working out which page a selection landed in. */
export const PDF_TEXT_LAYER_CLASS = 'pdf-text-layer';

/** The class one painted highlight rectangle carries — namespaced through the SAME
 * `highlightNaming.ts` the EPUB seam uses, per HIGHLIGHT_LAYERS.md's "a PDF seam should reuse
 * highlightNaming.ts". `user` is the owner; `saved` is the variant. */
const USER_BOX_CLASS = annotationClassName('user', 'saved');

/**
 * One visible page's painting surface.
 *
 * `lengths` is the page's per-item character counts, which is the whole index this module needs: it
 * is what turns a stored offset into item slices and a selection into stored offsets. Kept beside
 * `divs` (the spans themselves, in the same order) so index `i` means the same thing in both.
 */
export interface PdfPageSurface {
  page: number;
  /** The positioned box the canvas and both layers live in. Hit-tested for taps. */
  root: HTMLElement;
  textLayer: HTMLElement;
  highlightLayer: HTMLElement;
  divs: HTMLElement[];
  lengths: number[];
  /** Where each highlight was last painted, in `root`'s coordinate space. Rebuilt on every paint. */
  boxes: HighlightBox[];
}

/**
 * Give a page container the two layers it needs, and hand back a surface for it.
 *
 * IDEMPOTENT — re-rendering a page (zoom, rotation, a spread flip) reuses the same elements rather
 * than stacking a second pair, which would leave the previous text layer selectable underneath the
 * new one and double every highlight.
 */
export function ensureSurface(page: number, root: HTMLElement): PdfPageSurface {
  let textLayer = root.querySelector<HTMLElement>(`.${PDF_TEXT_LAYER_CLASS}`);
  if (!textLayer) {
    textLayer = document.createElement('div');
    textLayer.className = PDF_TEXT_LAYER_CLASS;
    root.appendChild(textLayer);
  }

  let highlightLayer = root.querySelector<HTMLElement>('.pdf-highlight-layer');
  if (!highlightLayer) {
    highlightLayer = document.createElement('div');
    highlightLayer.className = 'pdf-highlight-layer';
    // APPENDED AFTER THE TEXT LAYER, so it paints on top of it. That is only safe because the boxes
    // do not take pointer events (see the file header) — the transparent text underneath stays
    // selectable through them.
    root.appendChild(highlightLayer);
  }

  // Stamped on the container so a selection or a tap can be traced back to a page number without
  // this module having to keep a second element -> page map in step with the first.
  root.dataset.pdfPage = String(page);

  return { page, root, textLayer, highlightLayer, divs: [], lengths: [], boxes: [] };
}

/** Empty a surface's text layer before it is re-rendered. Separate from `ensureSurface` because a
 * resize reuses the container but must not reuse the spans, which are laid out for the old scale.
 *
 * THE PAINTED BOXES GO WITH THEM. The window between "start re-rendering" and "the new text
 * arrives" is async, and a box left standing through it is measured against a layout that no longer
 * exists — so `highlightAtClientPoint` would answer from stale geometry, and the rects would sit at
 * the old scale until the next `paintPage`. `pdf.entry.ts` repaints immediately after the new text
 * lands, so nothing is lost by dropping them here. */
export function clearTextLayer(surface: PdfPageSurface): void {
  surface.textLayer.replaceChildren();
  surface.highlightLayer.replaceChildren();
  surface.divs = [];
  surface.lengths = [];
  surface.boxes = [];
}

/**
 * Record the text pdf.js just laid out.
 *
 * `itemsStr` comes back from `renderTextLayer`'s own `textContentItemsStr` output, so the lengths
 * are pdf.js's strings — NOT the DOM's `textContent`. That distinction is the whole reliability of
 * the offset scheme: `textContent` can be re-normalised by the browser, and marked-content wrapping
 * can nest a span inside another, but `textContentItemsStr[i]` always corresponds to `textDivs[i]`.
 */
export function setPageText(
  surface: PdfPageSurface,
  divs: HTMLElement[],
  itemsStr: readonly string[],
): void {
  surface.divs = divs;
  surface.lengths = itemsStr.map((item) => item.length);
}

/**
 * Repaint one page's highlights from scratch.
 *
 * WHOLE-LAYER REPAINT RATHER THAN A DIFF, unlike the EPUB side, and the asymmetry is deliberate:
 * epub.js owns its annotations across page turns and re-attaching one is expensive, whereas these
 * are a handful of absolutely-positioned `<div>`s whose GEOMETRY changes on every zoom, rotation and
 * spread flip anyway. Diffing ids would save nothing and would still have to re-measure every box.
 */
export function paintPage(
  surface: PdfPageSurface,
  highlights: readonly PdfHighlightPaint[],
  bg?: string,
): void {
  surface.highlightLayer.replaceChildren();
  surface.boxes = [];

  if (surface.divs.length === 0) return;

  const origin = surface.root.getBoundingClientRect();
  const fragment = document.createDocumentFragment();

  for (const highlight of highlights) {
    if (highlight.page !== surface.page) continue;

    for (const slice of slicesForRange(surface.lengths, highlight.startOffset, highlight.endOffset)) {
      const div = surface.divs[slice.index];
      const text = div?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) continue;

      const range = document.createRange();
      try {
        // Clamped against the DOM node's OWN length, not the recorded item length: pdf.js's item
        // string and the rendered text node agree in every normal case, but a Range constructed
        // past a node's end throws, and one bad row must not stop the rest of the page painting.
        const limit = text.textContent?.length ?? 0;
        range.setStart(text, Math.min(slice.from, limit));
        range.setEnd(text, Math.min(slice.to, limit));
      } catch {
        continue;
      }

      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;

        const box: HighlightBox = {
          id: highlight.id,
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        };
        surface.boxes.push(box);

        const el = document.createElement('div');
        el.className = USER_BOX_CLASS;
        el.dataset.hlId = highlight.id;
        el.style.left = `${box.left}px`;
        el.style.top = `${box.top}px`;
        el.style.width = `${box.width}px`;
        el.style.height = `${box.height}px`;
        // Same `highlightFill` call as the EPUB side. `bg` is `pdf.entry.ts`'s `currentBg`, passed
        // in rather than read back from `document.body.style.background` (serialised form isn't
        // guaranteed hex). Inline `mixBlendMode` overrides the template's `multiply` fallback.
        const { fill, blend } = highlightFill(highlight.color, bg);
        el.style.background = fill;
        el.style.opacity = '0.25';
        el.style.mixBlendMode = blend;
        fragment.appendChild(el);
      }
    }
  }

  surface.highlightLayer.appendChild(fragment);
}

/** Which highlight, if any, a tap at client coordinates landed on. */
export function highlightAtClientPoint(
  surface: PdfPageSurface,
  clientX: number,
  clientY: number,
): string | null {
  const origin = surface.root.getBoundingClientRect();
  return highlightAt(surface.boxes, clientX - origin.left, clientY - origin.top);
}

/** The text-layer span a selection endpoint sits in, as an index into `divs`, or null. */
function anchorIndex(
  surface: PdfPageSurface,
  node: Node | null,
  offset: number,
): { index: number; withinItem: number } | null {
  if (!node) return null;

  // A selection endpoint is normally inside a span's text node; when the user drags past the end of
  // a line it can land on the span (or the layer) itself, with `offset` counting CHILDREN. Walking
  // up to the nearest element that IS one of our spans covers both, and the child-offset case
  // degrades to "the start of that span", which is where the browser drew the caret anyway.
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  if (!element) return null;

  const index = surface.divs.indexOf(element as HTMLElement);
  if (index === -1) return null;

  const length = surface.lengths[index] ?? 0;
  const within = node.nodeType === Node.TEXT_NODE ? Math.min(offset, length) : 0;
  return { index, withinItem: within };
}

/**
 * A live DOM selection -> the page span it covers, or null if it is not a usable selection in this
 * surface.
 *
 * Null for a collapsed selection, for one whose endpoints are not both in THIS page's text layer,
 * and for one that resolves to a zero-length span. The cross-page case is real in a double-page
 * spread — a drag can start on the left page and end on the right — and it is refused rather than
 * truncated: `highlightStore` stores a PDF highlight as two locators on ONE page (`SelectionRange`
 * is single-page by construction), so half of a cross-page selection would be saved silently and
 * the other half lost.
 */
export function selectionInSurface(
  surface: PdfPageSurface,
  selection: Selection,
): { startOffset: number; endOffset: number } | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;

  const anchor = anchorIndex(surface, selection.anchorNode, selection.anchorOffset);
  const focus = anchorIndex(surface, selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) return null;

  const { startOffset, endOffset } = offsetsForSelection(surface.lengths, anchor, focus);
  return endOffset > startOffset ? { startOffset, endOffset } : null;
}
