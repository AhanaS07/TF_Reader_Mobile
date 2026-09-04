// Owner: Reader (Ahana).
//
// The regression test for B2 lives here: `lockedRef` has to flip to `true` INSIDE the bus's
// synchronous emit call, not one React commit later. A version of this hook that set the ref
// from a `useEffect` keyed on `lock` would pass every other test in this file and still let a
// decrypted book reach the WebView on the mid-open race (see ReaderScreen.tsx's `handleReady`
// guard (b)) — so the ordering assertion below is the one that actually matters.

import { act, renderHook } from '@testing-library/react-native';

import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { BookId, LockSignal } from '@/shared/contracts';
import { eventBus, resetEventBusForTests } from '@/shared/eventBus';

import { useContentLock } from './useContentLock';

function lockSignal(bookId: string, reason: 'revoked' | 'expired' = 'revoked'): LockSignal {
  return {
    type: OFFLINE_LOCK_EVENTS.LOCK,
    bookId,
    reason,
    observedAt: Date.now(),
  };
}

describe('useContentLock', () => {
  afterEach(() => {
    resetEventBusForTests();
    jest.restoreAllMocks();
  });

  it('starts unlocked', async () => {
    const { result } = await renderHook(() => useContentLock('book-1' as BookId));

    expect(result.current.lock).toBeNull();
    expect(result.current.lockedRef.current).toBe(false);
  });

  it('sets lockedRef synchronously inside the emit call — the B2 regression case', async () => {
    const { result } = await renderHook(() => useContentLock('book-1' as BookId));

    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-1'));
    });

    // The ref mutation happens as a plain synchronous assignment inside the subscription
    // handler, before `setLock` is even called — so it holds regardless of whether React has
    // flushed the corresponding re-render yet.
    expect(result.current.lockedRef.current).toBe(true);
    expect(result.current.lock).toEqual({
      code: 'CONTENT_LOCKED',
      message: expect.any(String),
    });
  });

  it('ignores a lock for a different bookId', async () => {
    const { result } = await renderHook(() => useContentLock('book-1' as BookId));

    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-2'));
    });

    expect(result.current.lock).toBeNull();
    expect(result.current.lockedRef.current).toBe(false);
  });

  it('latches — a second lock signal does not replace the first', async () => {
    const { result } = await renderHook(() => useContentLock('book-1' as BookId));

    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-1', 'revoked'));
    });
    const firstLock = result.current.lock;

    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-1', 'expired'));
    });

    expect(result.current.lock).toBe(firstLock);
  });

  it('unsubscribes on unmount', async () => {
    const unsubscribeSpy = jest.fn();
    const originalOn = eventBus.on.bind(eventBus);
    jest.spyOn(eventBus, 'on').mockImplementation((channel, handler) => {
      const unsubscribe = originalOn(channel, handler);
      return () => {
        unsubscribeSpy();
        unsubscribe();
      };
    });

    const { unmount } = await renderHook(() => useContentLock('book-1' as BookId));
    await unmount();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not leak a subscription across a bookId change', async () => {
    const { result, rerender } = await renderHook(
      ({ bookId }: { bookId: BookId }) => useContentLock(bookId),
      { initialProps: { bookId: 'book-1' as BookId } },
    );

    await rerender({ bookId: 'book-2' as BookId });

    // A lock for the OLD book must not reach the hook now watching the new one.
    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-1'));
    });
    expect(result.current.lock).toBeNull();

    await act(async () => {
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal('book-2'));
    });
    expect(result.current.lock).not.toBeNull();
  });
});
