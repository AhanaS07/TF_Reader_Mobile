// Owner: Reader (Ahana).
//
// What matters here is the lifecycle, not the boolean: this hook drives an override that changes
// how the book is laid out, so a listener that outlives the screen would re-lay-out an unmounted
// reader, and an initial value that never corrects would leave a TalkBack user on the paginated
// path the whole session.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useScreenReaderEnabled } from './useScreenReaderEnabled';

describe('useScreenReaderEnabled', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is false while the OS read is still outstanding', async () => {
    // The optimistic false, isolated by never resolving the read: the first paint does not block on
    // an OS round trip. It cannot be observed after an awaited render — by then the promise has
    // already settled and the corrected value is in.
    jest
      .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
      .mockReturnValue(new Promise<boolean>(() => undefined));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => undefined } as never);

    const { result } = await renderHook(() => useScreenReaderEnabled());

    expect(result.current).toBe(false);
  });

  it('corrects to true once the async read resolves', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => undefined } as never);

    const { result } = await renderHook(() => useScreenReaderEnabled());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('stays false when no screen reader is running', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => undefined } as never);

    const { result } = await renderHook(() => useScreenReaderEnabled());

    await waitFor(() => {
      expect(AccessibilityInfo.isScreenReaderEnabled).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });

  it('follows screenReaderChanged while mounted', async () => {
    let fire: ((on: boolean) => void) | null = null;
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((event: string, handler: unknown) => {
        if (event === 'screenReaderChanged') fire = handler as (on: boolean) => void;
        return { remove: () => undefined } as never;
      });

    const { result } = await renderHook(() => useScreenReaderEnabled());

    await waitFor(() => {
      expect(fire).not.toBeNull();
    });
    // Turning TalkBack on inside an open book has to reach the reader, or the override only ever
    // applies at the next open — which is the case a user hits first.
    await waitFor(() => {
      fire?.(true);
      expect(result.current).toBe(true);
    });
  });

  it('falls back to false when the native read rejects', async () => {
    // A native call that can fail on a host with no accessibility manager. Staying at false means
    // the plain paginated reader — what shipped before any of this existed — rather than an
    // unhandled rejection and a redbox over the book.
    jest
      .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
      .mockRejectedValue(new Error('no accessibility manager'));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => undefined } as never);

    const { result } = await renderHook(() => useScreenReaderEnabled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
  });

  it('removes its subscription on unmount', async () => {
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove } as never);

    const { unmount } = await renderHook(() => useScreenReaderEnabled());
    await unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
