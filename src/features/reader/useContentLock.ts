// Owner: Reader (Ahana).
//
// Subscribes to Sync's `content.lock` bus signal for one open book. See CLAUDE.md's
// "Offline-lock gating hook" section for how this composes with startAccessMonitor/
// ACCESS_REVOKED and closeBook teardown, and readerLock.ts for the pure mapping this wraps.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { BookId } from '@/shared/contracts';
import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';

import { lockFromSignal, signalAppliesTo } from './readerLock';
import type { ReaderLock } from './readerLock';

/**
 * Fired synchronously, inside the same bus-emit call that set `lockedRef` — never from a
 * `useEffect` reacting to `lock`. A caller with real teardown to run (stop a monitor, close a
 * book) needs that teardown to be a direct consequence of the signal, not a second render's
 * effect body: this repo's `react-hooks/set-state-in-effect` rule refuses a bare effect body
 * that calls a state setter, and a teardown callback that itself calls `raiseError` is exactly
 * that shape once it is wrapped in a `useEffect([lock, ...])`. Reading the LATEST callback via a
 * ref (mirrored below, no deps array) — same pattern `ReaderScreen.tsx`'s own `onRelocatedRef`
 * uses — is what lets this stay out of the subscription effect's dependency array, so passing a
 * fresh inline arrow every render never resubscribes the bus listener.
 */
export type OnContentLock = (lock: ReaderLock) => void;

export interface ContentLockState {
  lock: ReaderLock | null;
  /**
   * Set synchronously, INSIDE the bus subscription callback — not via a render or a `useEffect`
   * keyed on `lock`. That one commit of lag is exactly what a caller reading it from a
   * microtask (e.g. `handleReady` in ReaderScreen.tsx, right after an in-flight decrypt resolves)
   * cannot afford: the race between that continuation and React's own state-flush has no
   * guaranteed ordering, and a ref set a commit late can lose it. `lock` (the state value) is
   * for what to RENDER and may lag a render behind with no correctness cost; `lockedRef` is for
   * every guard that decides whether to touch the WebView at all.
   */
  lockedRef: RefObject<boolean>;
}

/**
 * Tracks whether `bookId` is CURRENTLY LOCKED, for as long as this hook stays mounted.
 *
 * LATCHES — once locked, stays locked for this mount. `content.unlock` is deliberately not
 * consumed: a reversed revocation while the reader is open stays locked until the screen
 * remounts (a fresh `useContentLock` call). See CLAUDE.md's offline-lock section for why that is
 * an accepted fail-closed choice rather than an oversight.
 *
 * `eventBus` has no replay (contracts/event-bus.ts's own doc comment), so a lock emitted while
 * nothing is subscribed is missed here — and that is fine: `contentStore.ts`'s own subscriber
 * already destroyed the BEK for it, so the next cold `getBook()` fails regardless of whether
 * this hook ever saw the signal. This hook only covers the WHILE-OPEN case.
 */
export function useContentLock(bookId: BookId, onLock?: OnContentLock): ContentLockState {
  const [lock, setLock] = useState<ReaderLock | null>(null);
  const lockedRef = useRef(false);

  // Latest callback, read at emit time — see `OnContentLock`'s own doc for why. Not in the
  // subscription effect's deps: a caller passing a fresh inline arrow every render (the expected
  // usage — see ReaderScreen.tsx) must never cause a resubscribe.
  const onLockRef = useRef(onLock);
  useEffect(() => {
    onLockRef.current = onLock;
  });

  /*
    THIS HOOK ASSUMES bookId IS FIXED FOR ITS LIFETIME, same as useBookSearch.ts — see that
    hook's own note for why there is deliberately no reset-on-change path (a `setState` at the
    top of an effect body to simulate one is exactly what react-hooks/set-state-in-effect
    refuses). ReaderScreen and AudioPlayerScreen both key on bookId (their own prop docs), so an
    in-place bookId change never happens to an already-mounted instance; a genuinely new book
    means a remount, which resets `lock`/`lockedRef` for free via `useState`'s own initialiser.
  */
  useEffect(() => {
    return eventBus.on(OFFLINE_LOCK_EVENTS.LOCK, (signal) => {
      if (lockedRef.current) return;
      if (!signalAppliesTo(signal, bookId)) return;

      // THE REF, FIRST — before any setState or callback. This is the whole point of owning the
      // ref here rather than in a caller's effect: everything reading `lockedRef.current` after
      // this line (even inside the SAME synchronous emit, even from a caller's microtask
      // continuation) sees the lock, with no commit to wait for.
      lockedRef.current = true;
      const readerLock = lockFromSignal(signal);
      setLock(readerLock);
      onLockRef.current?.(readerLock);
    });
  }, [bookId]);

  return { lock, lockedRef };
}
