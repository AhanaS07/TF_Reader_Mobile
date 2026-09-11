// Owner: Reader (Ahana).
//
// Hit-testing a touch against painted highlight boxes. Pure and unit-tested, per CLAUDE.md's split:
// the entries read the DOM and measure, this decides what was hit.
//
// >>> SHARED BY BOTH SHELLS, WHICH IS WHY IT IS NOT IN pdfTextRange.ts ANY MORE. <<<
// It started PDF-only, next to the character-offset arithmetic. The EPUB shell now hit-tests the
// same way — it measures `contents.range(cfiRange).getClientRects()` rather than pdf.js's text
// layer, but a rect is a rect and the decision is identical. Keeping one copy is what makes "press
// on a highlight" mean the same thing in both formats; two copies is how they drift.
//
// WHY GEOMETRY RATHER THAN A TEXT POSITION. The EPUB shell used to convert the touch to a caret
// (`caretRangeFromPoint`) and ask `Range.isPointInRange`. A caret SNAPS to the nearest text
// position, so a press in a line's trailing whitespace hit a highlight that was not under the
// finger, and a press inside a highlighted word whose caret snapped to the adjacent character
// missed one that was. Boxes are what the reader can actually see, so boxes are what a press
// should test against.

/** A painted highlight box, in the coordinate space of whatever measured it. */
export interface HighlightBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Slop around each box's exact edge, in CSS px. `range.getClientRects()` is measured fresh at
 * touch time (see epub.entry.ts's `highlightBoxes`), by whichever text-layout engine the WebView
 * is running — WebKit (iOS) and Blink (Android) do not have to agree, sub-pixel, on where a line
 * or glyph falls for identical CSS. Confirmed on-device, iOS only: a tap visually on a highlighted
 * word can land a fraction of a pixel outside the box WebKit reports for it, so a zero-tolerance
 * test answers null, `pressedHighlightId` stays null, and the native menu never offers "Delete
 * Highlight" for a press that is plainly on one — Android's Blink measurement did not drift the
 * same way, which is why this was invisible there. A few px costs nothing a reader would notice
 * (touch targets are never pixel-exact anyway) and does not change WHICH box wins an overlap —
 * `highlightAt` still returns the last (topmost) match either way.
 */
const HIT_TEST_TOLERANCE_PX = 4;

/**
 * Which painted highlight a tap landed on, or null.
 *
 * HIT-TESTED HOST-SIDE-OF-THE-DOM RATHER THAN BY A LISTENER ON EACH BOX, and the reason is
 * selection: a box that can receive a click is a box that can swallow a drag, and the text
 * underneath it is the thing the user has to be able to select in order to make a highlight at all.
 * So the boxes stay `pointer-events: none` (PDF) or live in a separate pane (EPUB), and the
 * containing element does the hit test instead.
 *
 * LAST MATCH WINS — boxes are supplied in set order, so the last one is the topmost, and a tap on
 * overlapping highlights should delete the one the user can actually see.
 */
export function highlightAt(
  boxes: readonly HighlightBox[],
  x: number,
  y: number,
): string | null {
  for (let index = boxes.length - 1; index >= 0; index--) {
    const box = boxes[index];
    if (
      x >= box.left - HIT_TEST_TOLERANCE_PX &&
      x <= box.left + box.width + HIT_TEST_TOLERANCE_PX &&
      y >= box.top - HIT_TEST_TOLERANCE_PX &&
      y <= box.top + box.height + HIT_TEST_TOLERANCE_PX
    ) {
      return box.id;
    }
  }
  return null;
}

/**
 * Do two ranges overlap? — the test behind "does what I selected meet an existing highlight".
 *
 * >>> A SELECTION IS A RANGE, SO A POINT TEST ANSWERS THE WRONG QUESTION. <<< The EPUB shell used
 * to decide create-vs-delete from where the finger first landed, which is only the same thing as
 * what the reader selected when the press neither moved nor was adjusted. Drag a selection from
 * plain text INTO a highlight and the point test says "no highlight" — so the menu offered
 * "Highlight", and taking it painted a second annotation over the first.
 *
 * Each range's start must precede the other's end. STRICT comparisons, so a selection that merely
 * ABUTS a highlight — ending exactly where one begins, or a caret resting against its edge — is not
 * treated as touching it; abutting selections are how a reader highlights the sentence after the
 * one they already did.
 *
 * A COLLAPSED range inside another counts as overlapping, which is the right answer rather than an
 * oversight: a caret resting inside a highlight is a reader pointing at it. Callers guard on
 * `isCollapsed` upstream anyway, so it does not arise today.
 *
 * Throws (`WrongDocumentError`) for ranges in different documents, which is the caller's cue that a
 * highlight belongs to another chapter — see `epub.entry.ts`'s `highlightIdForRange`.
 */
export function rangesOverlap(a: Range, b: Range): boolean {
  return (
    a.compareBoundaryPoints(Range.START_TO_END, b) > 0 &&
    a.compareBoundaryPoints(Range.END_TO_START, b) < 0
  );
}

/** A viewport as a real bounding box, in whatever coordinate space the caller's rects are already
 * in — NOT anchored at (0,0). `epub.entry.ts`'s caller needs this: its rects and its viewport are
 * both already in the OUTER document's coordinate space (a `getBoundingClientRect()` each), and
 * that viewport does not start at the document's origin. */
export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Does any of these rects intersect this viewport?
 *
 * PARTIAL OVERLAP COUNTS, NOT FULL CONTAINMENT — the caller this was built for
 * (`epub.entry.ts`'s TTS auto-follow, `spokenRangeVisible`) tests a target that can legitimately
 * straddle a page or column break. Requiring every rect fully inside would call a sentence
 * "off-screen" the instant it starts painting if it also runs onto the next page, even though the
 * reader can plainly see where it starts — and would turn the page out from under text most of
 * which is still visible.
 */
export function anyRectOnScreen(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  viewport: ViewportBounds,
): boolean {
  return rects.some(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < viewport.right &&
      rect.left + rect.width > viewport.left &&
      rect.top < viewport.bottom &&
      rect.top + rect.height > viewport.top,
  );
}

/** Where a teleprompter-style reposition should trigger, and where it should land, as fractions of
 * viewport height. */
export interface ReadingZoneOptions {
  /** Fraction of viewport height past which a target triggers a reposition — BEFORE it reaches the
   * bottom edge, not after, so text never arrives already cut off mid-line. */
  triggerFraction: number;
  /** Fraction of viewport height a reposition puts the target's deepest point at afterward — an
   * upper-middle position, so a reposition reveals a full screen of upcoming text, not the bare
   * minimum needed to be visible. */
  targetFraction: number;
}

/**
 * How far to scroll (positive = down) to bring a target back into the reading zone, or null if it
 * is already comfortably inside it.
 *
 * USES THE DEEPEST RECT (max `top + height`), NOT THE FIRST — the point that would be cut off first
 * as the reader scrolls forward, so a multi-line sentence is judged by its lowest line, not where it
 * starts.
 *
 * NEVER TRIGGERS FOR A TARGET ABOVE THE ZONE. A target near or above the top of the viewport has a
 * small or negative `positionFraction`, which is always `< triggerFraction` — this only ever catches
 * up with content drifting toward the bottom, matching forward reading. It does not fight a reader
 * who paged back or scrolled up manually; there is no code path here that would scroll UP.
 */
export function readingZoneScrollDelta(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  viewport: ViewportBounds,
  options: ReadingZoneOptions,
): number | null {
  if (rects.length === 0) return null;
  const viewportHeight = viewport.bottom - viewport.top;
  if (viewportHeight <= 0) return null;

  const deepestBottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  const positionFraction = (deepestBottom - viewport.top) / viewportHeight;
  if (positionFraction < options.triggerFraction) return null;

  const targetBottom = viewport.top + options.targetFraction * viewportHeight;
  return deepestBottom - targetBottom;
}
