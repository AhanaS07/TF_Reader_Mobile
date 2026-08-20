/**
 * Offline lock — consume flambeau's loan change feed and announce what it says.
 *
 * Closes `B6`. The division of labour is the one review arrived at, and it is the whole design:
 *
 *   ENCRYPTION OWNS ENFORCEMENT. It already refuses to decrypt an expired licence, offline
 *   included, and `ContentStore.destroy()` makes the ciphertext noise instantly regardless of
 *   size. Nothing here can open a book Encryption will not decrypt, and nothing here failing can
 *   close one.
 *
 *   SYNC OWNS TRANSPORT AND NOTIFICATION. This module is the only thing that talks to the feed,
 *   so it is the only thing that can learn a book was revoked BEFORE its cached licence expires.
 *   That is the one fact Encryption cannot discover alone - the licence it holds still looks
 *   valid - and it is the entire reason this exists.
 *
 * So: this writes an advisory column and emits a signal. It gates nothing.
 *
 * ─── FAIL OPEN, AND WHY THAT IS A REQUIREMENT ────────────────────────────────────────────────
 * Offline, a timeout, a 404, or an unparseable body all emit NOTHING and leave every book exactly
 * as valid as it already was. Revoking a book because the Wi-Fi dropped is a far worse failure
 * than checking again a moment later, and every trigger that drives a sync asks again anyway.
 *
 * The consequence is explicit and accepted rather than hidden: a revocation only lands once the
 * device actually reaches the server, so a revoked book stays readable for as long as the device
 * stays offline. Closing that window needs a cached expiry plus an anti-rollback high-water-mark
 * (Phase 6), not this module. `B7` records the same trade-off from Download's side.
 */
import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { LockReason, LockSignal, UnlockSignal } from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';
import { nowIso } from './localDb/database';
import { SYNC_KEYS } from './localDb/schema';
import {
  fetchLoanChanges,
  isRestoring,
  isRevoking,
  type ChangeEntry,
} from './loanChanges';
import { downloadStore } from './stores/downloadStore';
import { syncMetadataStore } from './stores/syncMetadataStore';
import { MAX_LOAN_CHANGE_PAGES } from './syncConfig';

export interface EntitlementReport {
  /**
   * Whether the server answered at all.
   *
   * False means the device learned nothing - offline, timed out, or the endpoint is not
   * deployed. It does NOT mean "everything is fine", and a caller must not read it that way.
   * This is the distinction the earlier boolean-poll attempt collapsed, which is why a book with
   * no licence document read as readable.
   */
  checked: boolean;
  /** Books newly locked by this run. Only ones that actually changed state. */
  revoked: string[];
  /** Books newly unlocked by this run - a renewal restoring what a revocation took. */
  restored: string[];
  /** Feed entries understood this run, changed or not. Diagnostic only. */
  entriesSeen: number;
  /** Present when the feed could not be read. The run is a no-op, not a failure. */
  error?: string;
}

/**
 * Maps a feed reason onto the contract's lock vocabulary.
 *
 * `'revoked'` is the privileged one: it is the signal Encryption acts on by destroying the BEK.
 * `ENTITLEMENT_EXPIRED` maps to `'expired'` instead, because Encryption can already see that
 * from the licence it holds - announcing it is a UI convenience and must not trigger destruction
 * of key material that the licence would have refused anyway.
 */
function lockReasonFor(entry: ChangeEntry): Exclude<LockReason, 'unknown'> {
  return entry.reason === 'ENTITLEMENT_EXPIRED' ? 'expired' : 'revoked';
}

/**
 * When the server said it happened, as epoch-ms.
 *
 * Prefers the feed's own `occurredAt` over the device clock, because the contract's `observedAt`
 * is "when the server actually told us, not the device's guess". Falls back to the device clock
 * only when the entry carries no usable timestamp, which for an unconfirmed wire shape is a real
 * possibility.
 */
function observedAtFor(entry: ChangeEntry): number {
  const parsed = Date.parse(entry.occurredAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Reads the feed and applies whatever it says.
 *
 * Books this device does not hold are filtered out for free: `setValidity` reports whether any
 * row actually changed, and a book with no `downloads` row changes nothing, so nothing is
 * emitted for it. That is deliberate - the feed covers the whole account, and announcing a lock
 * for a book the user never downloaded would be noise at best.
 *
 * Re-confirmations are silent for the same reason. A feed that repeats a revocation the device
 * already applied changes no row, so no second signal fires and Encryption is not asked to
 * destroy key material it has already destroyed.
 */
export async function checkEntitlements(): Promise<EntitlementReport> {
  const report: EntitlementReport = {
    checked: false,
    revoked: [],
    restored: [],
    entriesSeen: 0,
  };

  const startCursor = await syncMetadataStore.get(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR);
  let cursor = startCursor;

  try {
    for (let page = 0; page < MAX_LOAN_CHANGE_PAGES; page += 1) {
      const { entries, nextCursor } = await fetchLoanChanges(cursor);
      report.checked = true;
      report.entriesSeen += entries.length;

      for (const entry of entries) {
        await applyEntry(entry, report);
      }

      // No cursor, or one that has not moved, means the feed is drained. Keeping the previous
      // cursor rather than clearing it matters: clearing would re-read the feed from the start
      // next run and re-announce revocations already acted on, and acting means destroying keys.
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  } catch (error) {
    // Fail open. Nothing emitted, cursor not advanced, every book left as it was.
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }

  // Only after every entry has been applied. A cursor advanced before the writes landed would
  // skip a revocation permanently on the next run - the same invariant as the pull checkpoint.
  if (cursor && cursor !== startCursor) {
    await syncMetadataStore.set(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR, cursor);
  }
  await syncMetadataStore.set(SYNC_KEYS.LAST_ENTITLEMENT_CHECK_AT, nowIso());

  return report;
}

async function applyEntry(entry: ChangeEntry, report: EntitlementReport): Promise<void> {
  if (isRevoking(entry)) {
    const changed = await downloadStore.setValidity(entry.bookId, false);
    if (!changed) return;

    report.revoked.push(entry.bookId);
    const signal: LockSignal = {
      type: OFFLINE_LOCK_EVENTS.LOCK,
      bookId: entry.bookId,
      reason: lockReasonFor(entry),
      observedAt: observedAtFor(entry),
    };
    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, signal);
    return;
  }

  if (isRestoring(entry)) {
    const changed = await downloadStore.setValidity(entry.bookId, true);
    if (!changed) return;

    report.restored.push(entry.bookId);
    const signal: UnlockSignal = {
      type: OFFLINE_LOCK_EVENTS.UNLOCK,
      bookId: entry.bookId,
      observedAt: observedAtFor(entry),
    };
    eventBus.emit(OFFLINE_LOCK_EVENTS.UNLOCK, signal);
  }
}

/**
 * Has the feed ever answered on this device?
 *
 * For the UI, so it can tell "entitlement confirmed" from "never confirmed". `is_valid` reads as
 * valid in both cases, so without this a banner would claim an entitlement the device has never
 * checked.
 */
export async function lastEntitlementCheckAt(): Promise<string | null> {
  return syncMetadataStore.get(SYNC_KEYS.LAST_ENTITLEMENT_CHECK_AT);
}
