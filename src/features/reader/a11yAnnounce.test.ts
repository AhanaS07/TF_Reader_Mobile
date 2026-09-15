// Owner: Reader (Ahana).
//
// The transport has one job and two promises: say something speakable, and never throw. Both are
// pinned here; WHETHER to speak is readerAnnouncements.test.ts's, and WHEN is ReaderScreen's.

import { AccessibilityInfo } from 'react-native';

import { announce } from './a11yAnnounce';

describe('announce', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('speaks the message, unqueued', () => {
    // `queue: false` is the point, not an incidental option: a second page turn has to replace a
    // stale "Page 11 of 340" rather than stack behind it.
    announce('Page 12 of 340');

    expect(spy).toHaveBeenCalledWith('Page 12 of 340', { queue: false });
  });

  it('trims before speaking', () => {
    announce('  Dark theme \n');

    expect(spy).toHaveBeenCalledWith('Dark theme', { queue: false });
  });

  it.each([['', 'empty'], ['   ', 'whitespace-only'], ['\n\t', 'blank']])(
    'says nothing for a %s message (%s)',
    (message) => {
      // Some Android builds speak an empty announcement as a bare tone, which is worse than
      // silence — a reader hearing a beep with no words has no idea what changed.
      announce(message);

      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('does not throw when the native call fails', () => {
    // Every call site fires this alongside the real work. A native failure escaping here would
    // turn "the reader did not say anything" into "the page did not turn".
    spy.mockImplementation(() => {
      throw new Error('no accessibility manager');
    });

    expect(() => announce('Page 2 of 3')).not.toThrow();
  });
});
