// Owner: Reader (Ahana).
//
// Where the highlight menu lands. Pure, and tested here rather than through the screen because every
// interesting case is an EDGE — a selection on the first line, a word in the margin, a viewer
// shorter than the menu — and those are exactly the ones a rendered-component test would need to be
// contrived into producing, one layout at a time.

import { POPUP_GAP_PX, popupPosition } from './highlightPopup';

const MENU = { width: 156, height: 44 };
const VIEWER = { width: 390, height: 700 };

/** A selection roughly mid-page. */
const MIDDLE = { x: 120, y: 300, width: 80, height: 18 };

describe('placing the menu', () => {
  it('sits above the words and centred on them', () => {
    // ABOVE, because the finger that just made the long press is still on the words — on a phone the
    // hand covers everything below the touch point.
    expect(popupPosition(MIDDLE, MENU, VIEWER)).toEqual({
      left: MIDDLE.x + MIDDLE.width / 2 - MENU.width / 2,
      top: MIDDLE.y - MENU.height - POPUP_GAP_PX,
    });
  });

  it('flips below when there is no room above', () => {
    // A selection on the first line of the page. Flipping only when it genuinely will not fit keeps
    // the common case unobstructed and the rare case visible.
    const firstLine = { ...MIDDLE, y: 10 };
    expect(popupPosition(firstLine, MENU, VIEWER).top).toBe(
      firstLine.y + firstLine.height + POPUP_GAP_PX,
    );
  });

  it('keeps a menu on screen at the left margin', () => {
    const marginWord = { x: 2, y: 300, width: 30, height: 18 };
    expect(popupPosition(marginWord, MENU, VIEWER).left).toBe(POPUP_GAP_PX);
  });

  it('keeps a menu on screen at the right margin', () => {
    const marginWord = { x: 370, y: 300, width: 18, height: 18 };
    expect(popupPosition(marginWord, MENU, VIEWER).left).toBe(
      VIEWER.width - MENU.width - POPUP_GAP_PX,
    );
  });

  it('keeps a flipped menu on screen when the selection fills the page', () => {
    // Both bounds bite at once, which a selection of a single line cannot produce: this one starts
    // too high for the menu to fit above it AND ends too low for it to fit below. A reader selecting
    // most of a page is the ordinary way to get here.
    const wholePage = { x: 120, y: 10, width: 200, height: 660 };
    expect(popupPosition(wholePage, MENU, VIEWER).top).toBe(
      VIEWER.height - MENU.height - POPUP_GAP_PX,
    );
  });

  it('accepts a negative anchor, which is a real position, not bad input', () => {
    // A selection that starts above the current scroll offset reports a negative `y`. Clamped into
    // view rather than refused — the words are real even if their top edge is not on screen.
    const above = { x: 120, y: -40, width: 80, height: 18 };
    expect(popupPosition(above, MENU, VIEWER).top).toBeGreaterThanOrEqual(POPUP_GAP_PX);
  });

  it('keeps the menu\'s TOP on screen when the viewer is shorter than the menu', () => {
    // Degenerate, and the reason the clamp is written the way it is: with the bounds crossed, a
    // naive min/max answers with whichever was applied last, which would push the menu's top OFF the
    // screen and leave only its bottom edge showing.
    const tiny = { width: 390, height: 30 };
    const { top } = popupPosition(MIDDLE, MENU, tiny);
    expect(top).toBe(POPUP_GAP_PX);
  });

  it('never returns a non-finite position', () => {
    // The placement feeds a style prop directly. A NaN there silently drops the menu out of the
    // layout with nothing to explain it.
    const { left, top } = popupPosition({ x: 0, y: 0, width: 0, height: 0 }, MENU, VIEWER);
    expect(Number.isFinite(left) && Number.isFinite(top)).toBe(true);
  });
});
