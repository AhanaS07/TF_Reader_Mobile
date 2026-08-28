// Owner: Reader (Ahana).
//
// Module state shared by two components that cannot pass props to each other. What is pinned here
// is the notification, because that is the part a plain module-level boolean would get wrong: the
// prefs menu has to re-render when the reader's alert is answered, or its Flow rows stay disabled
// for an override that is no longer in effect.

import {
  isOverrideDeclined,
  setOverrideDeclined,
  subscribeOverrideChoice,
} from './a11yOverrideChoice';

describe('the screen-reader override choice', () => {
  afterEach(() => {
    setOverrideDeclined(false);
  });

  it('starts undeclined — the override applies until the user says otherwise', () => {
    expect(isOverrideDeclined()).toBe(false);
  });

  it('notifies subscribers when the choice changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOverrideChoice(listener);

    setOverrideDeclined(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(isOverrideDeclined()).toBe(true);
    unsubscribe();
  });

  it('does not notify when the value is unchanged', () => {
    // `ReaderScreen` resets this to false on every mount. Without the guard, that reset would
    // publish a change on every open and re-render the prefs menu for nothing.
    setOverrideDeclined(true);
    const listener = jest.fn();
    const unsubscribe = subscribeOverrideChoice(listener);

    setOverrideDeclined(true);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying once unsubscribed', () => {
    const listener = jest.fn();
    subscribeOverrideChoice(listener)();

    setOverrideDeclined(true);

    expect(listener).not.toHaveBeenCalled();
  });
});
