// Owner: Reader (Ahana).
//
// Turns a `content.lock` bus signal into what ReaderScreen/AudioPlayerScreen render — the pure
// half of the offline-lock gating hook. See CLAUDE.md's "Offline-lock gating hook" section and
// WEBVIEW_BRIDGE.md's CONTENT_LOCKED entry for how this composes with the rest of the seam.

import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { BookId, LockReason, LockSignal, OfflineLockSignal } from '@/shared/contracts';

/** What a locked reader renders instead of the book. `code` rides `readerBridge.ts`'s
 *  `HOST_ERROR_CODES` — see `CONTENT_LOCKED` there for why it is host-only. */
export interface ReaderLock {
  code: 'CONTENT_LOCKED';
  message: string;
}

/**
 * `LockSignal.reason` -> user-facing wording, exhaustive over every reason a signal can
 * actually carry (`LockReason` minus `'unknown'` — see `LockSignal`'s own type).
 *
 * A `never` default, same idiom the ContentFormat switch in `ReaderScreen.tsx`'s `handleReady`
 * already uses: a third reason added to `LockReason` fails to compile here until it is given
 * wording, rather than silently falling through to generic copy.
 */
function messageFor(reason: Exclude<LockReason, 'unknown'>): string {
  switch (reason) {
    case 'revoked':
      return 'Your access to this book has ended.';
    case 'expired':
      return 'Your licence for this book has expired.';
    default: {
      const unhandled: never = reason;
      throw new Error(`Unhandled LockReason: ${String(unhandled)}`);
    }
  }
}

export function lockFromSignal(signal: LockSignal): ReaderLock {
  return { code: 'CONTENT_LOCKED', message: messageFor(signal.reason) };
}

/**
 * True iff `signal` is a LOCK for `bookId`, with a usable bookId to compare.
 *
 * Not defensive padding: `applyDownloadRecord` (src/features/sync/offlineLock.ts) builds
 * `bookId` as `(record.bookId ?? before?.book_id) as string` — an `as` cast over a value that
 * can genuinely be `undefined` for a server record missing `bookId`. A bare `===` would then
 * match nothing (if `bookId` here is a real string) or everything (if it were ever nullish on
 * this side too) — this makes "no usable id on either side" its own false case instead.
 *
 * A TYPE PREDICATE, not a bare boolean — `useContentLock.ts` calls `lockFromSignal` right after
 * this guard, and `lockFromSignal` takes a `LockSignal`, not the full `OfflineLockSignal` union.
 * Without the predicate that call would need its own cast, which is exactly the kind of "trust
 * me" this file exists to avoid on an untrusted-shaped payload.
 */
export function signalAppliesTo(signal: OfflineLockSignal, bookId: BookId): signal is LockSignal {
  if (signal.type !== OFFLINE_LOCK_EVENTS.LOCK) return false;
  if (typeof signal.bookId !== 'string' || signal.bookId === '') return false;
  return signal.bookId === bookId;
}
