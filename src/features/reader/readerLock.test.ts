// Owner: Reader (Ahana).
//
// Pins the two things `readerLock.ts` has to get right: distinct wording per LockReason, and
// that `signalAppliesTo` cannot be tricked by the undefined-bookId cast documented at its call
// site (src/features/sync/offlineLock.ts).

import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { LockSignal, UnlockSignal } from '@/shared/contracts';

import { lockFromSignal, signalAppliesTo } from './readerLock';

function lockSignal(bookId: unknown, reason: 'revoked' | 'expired'): LockSignal {
  return {
    type: OFFLINE_LOCK_EVENTS.LOCK,
    bookId: bookId as string,
    reason,
    observedAt: Date.now(),
  };
}

function unlockSignal(bookId: string): UnlockSignal {
  return { type: OFFLINE_LOCK_EVENTS.UNLOCK, bookId, observedAt: Date.now() };
}

describe('lockFromSignal', () => {
  it('gives revoked and expired distinct wording', () => {
    const revoked = lockFromSignal(lockSignal('book-1', 'revoked'));
    const expired = lockFromSignal(lockSignal('book-1', 'expired'));

    expect(revoked.code).toBe('CONTENT_LOCKED');
    expect(expired.code).toBe('CONTENT_LOCKED');
    expect(revoked.message).not.toBe(expired.message);
  });
});

describe('signalAppliesTo', () => {
  it('is true for a LOCK matching this bookId', () => {
    expect(signalAppliesTo(lockSignal('book-1', 'revoked'), 'book-1')).toBe(true);
  });

  it('rejects an UnlockSignal even for a matching bookId', () => {
    expect(signalAppliesTo(unlockSignal('book-1'), 'book-1')).toBe(false);
  });

  it('rejects a lock for a different bookId', () => {
    expect(signalAppliesTo(lockSignal('book-2', 'revoked'), 'book-1')).toBe(false);
  });

  it('rejects a signal whose bookId is undefined through the offlineLock.ts cast', () => {
    expect(signalAppliesTo(lockSignal(undefined, 'revoked'), 'book-1')).toBe(false);
  });

  it('rejects an empty-string bookId rather than matching it against anything', () => {
    expect(signalAppliesTo(lockSignal('', 'revoked'), '' as never)).toBe(false);
  });
});
