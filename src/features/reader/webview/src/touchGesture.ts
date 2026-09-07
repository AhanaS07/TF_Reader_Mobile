// Owner: Reader (Ahana).
//
// Touch-gesture arithmetic for both shells — long-press slop, and what counts as a page-turn swipe.
// Pure and unit-tested, per CLAUDE.md's split: the entries read the DOM and hold the timers, the
// numbers live here where a test can call them.
//
// >>> WHY GESTURE DETECTION MOVED INSIDE THE WEBVIEW AT ALL. <<<
// Page turns used to be an RN `PanResponder` on an overlay above the WebView (`reader-swipe-catcher`
// in ReaderScreen.tsx). That overlay is the topmost hit-test target for every touch in the viewer,
// so while it was mounted the document underneath could never receive a `touchstart` — which is
// fine for swipes and fatal for text selection, since a long press has to reach the text to select
// it. The two cannot both own the same touches from opposite sides of the boundary.
//
// So the overlay is gone and both gestures are recognised HERE, in the one place that sees the whole
// touch: a long press reaches the text and lets WebKit select it, a directional drag turns the page,
// and the two are told apart by shape rather than by a mode the reader has to remember to switch.
// That is only possible on this side — RN sees nothing of a touch the WebView consumed, and the
// WebView sees nothing of a touch the overlay consumed.

/** How long a touch must stay still before it is a long press. Matches the platform's own feel —
 * WebKit begins its selection callout at roughly this point, so our menu and the OS's selection
 * appear together rather than a beat apart. */
export const LONG_PRESS_MS = 500;

/** How far a finger may drift and still be holding still. A resting thumb wanders a few pixels;
 * anything past this is a drag, and a drag is a swipe or a selection extension, never a press. */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * How far a drag must travel horizontally to turn the page.
 *
 * The same 50px the RN overlay used, kept deliberately: the gesture the reader makes has not
 * changed, only which side of the bridge recognises it, and quietly re-tuning the threshold in the
 * same change would make a behaviour regression indistinguishable from the port.
 */
export const SWIPE_MIN_DISTANCE_PX = 50;

export interface TouchPoint {
  x: number;
  y: number;
}

/** Has the finger moved far enough to stop being a press? */
export function movedBeyondSlop(
  from: TouchPoint,
  to: TouchPoint,
  slop: number = LONG_PRESS_SLOP_PX,
): boolean {
  return Math.abs(to.x - from.x) > slop || Math.abs(to.y - from.y) > slop;
}

/**
 * Which way a completed drag turns the page, or null if it does not.
 *
 * TWO SEPARATE REFUSALS, and they are not the same check:
 *
 *  - too short — a tap, or the tail of some other gesture;
 *  - not dominantly horizontal — the reader was scrolling, or dragging a selection handle down the
 *    page. Compared against the vertical distance rather than a fixed angle so the test is scale
 *    free: a long diagonal is refused for the same reason a short one is.
 *
 * `dx < 0` is a leftward drag, which pulls the NEXT page in from the right — the direction a
 * physical page moves, not the direction the reader travels.
 */
export function swipeDirection(
  from: TouchPoint,
  to: TouchPoint,
  minDistance: number = SWIPE_MIN_DISTANCE_PX,
): 'next' | 'prev' | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;

  return dx < 0 ? 'next' : 'prev';
}
