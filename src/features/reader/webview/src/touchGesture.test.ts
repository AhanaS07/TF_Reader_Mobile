// Owner: Reader (Ahana).
//
// The thresholds that decide whether a touch was a page turn, a press, or neither. Pure, so the
// cases that matter can be stated as numbers rather than discovered on a device — and they matter
// more than usual here, because both failure directions are bad in a way that is hard to attribute:
// a swipe threshold that is too eager turns the page while the reader is trying to select a word,
// and one that is too strict makes the book feel stuck.

import {
  LONG_PRESS_SLOP_PX,
  movedBeyondSlop,
  SWIPE_MIN_DISTANCE_PX,
  swipeDirection,
} from './touchGesture';

const ORIGIN = { x: 100, y: 300 };

describe('has the finger stopped holding still?', () => {
  it('tolerates the drift of a resting thumb', () => {
    expect(movedBeyondSlop(ORIGIN, { x: 108, y: 306 })).toBe(false);
  });

  it('counts movement on either axis', () => {
    // A press that slides DOWN is no more a press than one that slides sideways — a reader starting
    // to scroll must not also arm the menu.
    expect(movedBeyondSlop(ORIGIN, { x: 100 + LONG_PRESS_SLOP_PX + 1, y: 300 })).toBe(true);
    expect(movedBeyondSlop(ORIGIN, { x: 100, y: 300 + LONG_PRESS_SLOP_PX + 1 })).toBe(true);
  });

  it('treats exactly the slop as still holding still', () => {
    expect(movedBeyondSlop(ORIGIN, { x: 100 + LONG_PRESS_SLOP_PX, y: 300 })).toBe(false);
  });
});

describe('did that drag turn the page?', () => {
  it('pulls the NEXT page in from the right on a leftward drag', () => {
    // The direction a physical page moves, not the direction the reader travels — getting this
    // backwards is the kind of bug that reads as "the book is going the wrong way".
    expect(swipeDirection(ORIGIN, { x: 100 - 80, y: 300 })).toBe('next');
    expect(swipeDirection(ORIGIN, { x: 100 + 80, y: 300 })).toBe('prev');
  });

  it('refuses a drag too short to be deliberate', () => {
    expect(swipeDirection(ORIGIN, { x: 100 - (SWIPE_MIN_DISTANCE_PX - 1), y: 300 })).toBeNull();
    expect(swipeDirection(ORIGIN, ORIGIN)).toBeNull();
  });

  it('takes exactly the threshold', () => {
    expect(swipeDirection(ORIGIN, { x: 100 - SWIPE_MIN_DISTANCE_PX, y: 300 })).toBe('next');
  });

  it('refuses a drag that is not dominantly horizontal', () => {
    // The reader was scrolling, or dragging a selection handle down the page. Compared against the
    // VERTICAL distance rather than an angle, so the test is scale free: a long diagonal is refused
    // for the same reason a short one is.
    expect(swipeDirection(ORIGIN, { x: 100 - 80, y: 300 + 90 })).toBeNull();
    expect(swipeDirection(ORIGIN, { x: 100 - 300, y: 300 + 320 })).toBeNull();
  });

  it('allows a shallow diagonal, because no real swipe is perfectly level', () => {
    expect(swipeDirection(ORIGIN, { x: 100 - 80, y: 300 + 20 })).toBe('next');
  });

  it('refuses a perfect 45 degrees rather than guessing', () => {
    // Ambiguous by construction. Refusing costs the reader one repeated gesture; guessing costs them
    // a lost place in the book.
    expect(swipeDirection(ORIGIN, { x: 100 - 80, y: 300 + 80 })).toBeNull();
  });
});
