// Owner: Download (Abhinav).
//
// Periodic per-open access re-verification WHILE a book stays open. `verifyReadingAccess()`
// (readingSessionClient.ts) only ever runs ONCE, at open time (readerAssets.ts's getBookBase64) —
// the real backend's own reading-session grant lasts ~5 minutes (reading-session.ts's own
// `expiresAt`), so a book that stays open longer than that is being read against a grant that has
// already lapsed server-side, with nothing re-checking it. This module is the timer that re-runs
// the same check on a fixed interval for as long as the book stays open.
//
// SAME FAIL-OPEN / FAIL-CLOSED POLICY AS THE OPEN-TIME CHECK, reused rather than reinvented —
// verifyReadingAccess() already resolves silently for a network hiccup or an unconfirmable state
// and rejects ONLY for FAIL_CLOSED_CODES (explicit revocation/denial, or DEVICE_LIMIT_REACHED; see
// that function's own doc comment). This module does not re-decide any of that policy — it just
// calls the same function on a timer and reports the one outcome a caller mid-read cares about: an
// explicit denial.
//
// APPLIES TO ANY OPEN BOOK, DOWNLOADED OR NOT — a downloaded book's offline licence already has
// its own 4-day cap (licenseCheck.ts's computeOfflineLicenceExpiry), but this device is online
// right now, and the real backend re-checks entitlement on every reading-session call regardless
// of canPersist. A revocation mid-read should not have to wait for the next full open to be
// noticed.
//
// FIXED INTERVAL, NOT SELF-SCHEDULED OFF THE SESSION'S OWN expiresAt: a deliberate simplification.
// self-scheduling would track the server's real TTL exactly, but this fixed value already sits
// right at that TTL (see ACCESS_CHECK_INTERVAL_MS below) and needs no response parsing to drive it.

import type { BookId, ContentFormat } from '@/shared/contracts';
import { verifyReadingAccess } from './readingSessionClient';
import { DownloadFailure } from './errors';

// Matches the real backend's own reading-session TTL (reading-session.ts's `expiresAt`, ~5
// minutes) — by the time this fires, the grant checked at open (or by the previous tick) has
// already lapsed server-side, so there is no benefit to checking any sooner.
export const ACCESS_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface AccessMonitorHandle {
  /** Stop for good — call on close/unmount. Idempotent, and safe after `onRevoked` already fired
   *  (this stops itself first — see `startAccessMonitor`'s own doc comment). */
  stop(): void;
  /** Suspend ticking without losing the handle — call when the app backgrounds. No check fires
   *  while paused. Idempotent. */
  pause(): void;
  /** Resume ticking from a fresh full interval (not a resumed partial one) — call when the app
   *  foregrounds. Idempotent, and a no-op once `stop()` has been called. */
  resume(): void;
}

/**
 * Start re-verifying access to `bookId` every `ACCESS_CHECK_INTERVAL_MS`, for as long as the
 * returned handle isn't stopped or paused. `onRevoked` fires at most once, for the FIRST explicit
 * denial — the caller is expected to end the read on it, so this stops itself before calling back
 * rather than leaving a timer running against a book the caller has already been told to close.
 *
 * Does not perform an immediate check at start — `verifyReadingAccess` already ran once at open
 * time (readerAssets.ts), so the first tick from this monitor is correctly one full interval later.
 */
export function startAccessMonitor(
  bookId: BookId,
  format: ContentFormat,
  onRevoked: (failure: DownloadFailure) => void,
): AccessMonitorHandle {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    void verifyReadingAccess(bookId, format).catch((cause: unknown) => {
      // verifyReadingAccess rejects ONLY for FAIL_CLOSED_CODES (its own doc comment) — anything
      // else already resolved silently (fail-open). A rejection here is therefore always a
      // genuine, explicit denial worth stopping for, never a network hiccup.
      if (stopped || !(cause instanceof DownloadFailure)) return;
      stop();
      onRevoked(cause);
    });
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function stop(): void {
    stopped = true;
    clearTimer();
  }

  function pause(): void {
    clearTimer();
  }

  function resume(): void {
    if (stopped || timer !== null) return;
    timer = setInterval(tick, ACCESS_CHECK_INTERVAL_MS);
  }

  resume();
  return { stop, pause, resume };
}
