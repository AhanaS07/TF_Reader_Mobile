// Owner: Reader (Ahana).
//
// Where the highlight menu goes, given where the reader pressed. Pure and unit-tested for the usual
// reason — this is arithmetic with a `/ 2` and four clamps in it, and its failure mode is a menu
// half off the screen, which is exactly the thing a snapshot of a passing test would not notice.
//
// COORDINATES ARE THE WEBVIEW'S OWN VIEWPORT, which is also the `viewer` View's box: `ReaderWebView`
// fills that container, so a `clientX` reported by the document and a `left` on an absolutely
// positioned RN sibling mean the same thing. That equivalence is the whole reason the menu can live
// in React Native while the gesture that summons it happens inside the document — nothing has to be
// converted, only clamped.

/** Where the gesture was, in WebView viewport coordinates. A selection reports its bounding box; a
 * press on a highlight reports a zero-sized box at the finger. */
export interface PopupAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopupBox {
  width: number;
  height: number;
}

export interface ViewerBox {
  width: number;
  height: number;
}

/** Breathing room between the menu and the thing it points at, and between the menu and the edges
 * of the viewer. One value for both: the menu should never look closer to the screen edge than it
 * does to the selection it belongs to. */
export const POPUP_GAP_PX = 8;

/**
 * Place the menu above the anchor, centred on it, and inside the viewer.
 *
 * ABOVE BY DEFAULT, BELOW ONLY IF IT WILL NOT FIT. A menu under the selection sits where the reader's
 * own hand is — the finger that just made the long press is still there, and on a phone the hand
 * covers everything below the touch point. Flipping only when there is genuinely no room above keeps
 * the common case unobstructed and the rare case visible, rather than picking one and living with it.
 *
 * Clamped last, on both axes, so a selection at the very edge of the page (a first or last line, a
 * word in the margin) still yields a fully visible menu instead of one cropped by the viewer.
 */
export function popupPosition(
  anchor: PopupAnchor,
  popup: PopupBox,
  viewer: ViewerBox,
): { left: number; top: number } {
  const above = anchor.y - popup.height - POPUP_GAP_PX;
  const below = anchor.y + anchor.height + POPUP_GAP_PX;

  const top = above >= POPUP_GAP_PX ? above : Math.min(below, viewer.height - popup.height - POPUP_GAP_PX);
  const left = anchor.x + anchor.width / 2 - popup.width / 2;

  return {
    left: clamp(left, POPUP_GAP_PX, viewer.width - popup.width - POPUP_GAP_PX),
    // A viewer shorter than the menu itself would make the two bounds cross, and `Math.min`/`max`
    // would then answer with whichever was applied last. Clamped to the low bound explicitly so the
    // menu's TOP stays on screen in that degenerate case rather than its bottom.
    top: clamp(top, POPUP_GAP_PX, Math.max(POPUP_GAP_PX, viewer.height - popup.height - POPUP_GAP_PX)),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}
