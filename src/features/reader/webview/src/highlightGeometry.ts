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
