/**
 * Offline lock — translate a pulled `downloads` record into content.lock / content.unlock.
 *
 * Closes `B6`, on the design flambeau's licence side actually shipped: `isValid` is now written
 * directly on the `downloads` document server-side when a licence is revoked or restored, instead
 * of this device computing it from flambeau's loan change feed. So there is no feed left to read
 * - `downloads` is one of the six collections `syncEngine.ts`'s `pull()` already sweeps every
 * run, and this module's whole job is to notice when that pull actually changed `is_valid` and
 * say so. The division of labour from the original design is otherwise unchanged:
 *
 *   ENCRYPTION OWNS ENFORCEMENT. It already refuses to decrypt an expired licence, offline
 *   included, and `ContentStore.destroy()` makes the ciphertext noise instantly regardless of
 *   size. Nothing here can open a book Encryption will not decrypt, and nothing here failing can
 *   close one.
 *
 *   SYNC OWNS TRANSPORT AND NOTIFICATION. This module still does not gate reading - it writes an
 *   advisory column (via the normal pull, same as every other synced field) and emits a signal.
 *
 * ─── FAIL OPEN, AND WHY THAT IS STILL A REQUIREMENT ──────────────────────────────────────────
 * Offline, or a pull that fails, means `applyDownloadRecord` is simply never called - the same
 * fail-open guarantee as before, just inherited from the pull it now rides on instead of from a
 * dedicated try/catch. A revocation lands only once the device actually reaches the server and
 * successfully pulls, so a revoked book stays readable for as long as the device stays offline.
 * `B7` records the same trade-off from Download's side.
 */
import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { LockSignal, UnlockSignal } from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';
import { nowIso } from './localDb/database';
import { SYNC_KEYS } from './localDb/schema';
import { downloadTable } from './stores/downloadStore';
import { syncMetadataStore } from './stores/syncMetadataStore';

/**
 * When the server said `updatedAt` happened, as epoch-ms.
 *
 * Prefers the record's own timestamp over the device clock, because the contract's `observedAt`
 * is "when the server actually told us, not the device's guess". Falls back to the device clock
 * only when the record carries no parseable timestamp.
 */
function observedAtFor(record: { updatedAt?: unknown }): number {
  const parsed = typeof record.updatedAt === 'string' ? Date.parse(record.updatedAt) : NaN;
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Applies one `downloads` record pulled from the server, and announces an entitlement change if
 * (and only if) it actually is one.
 *
 * Three ways this can be a no-op, each deliberate:
 *   - `applyServerRecord`'s own Last-Write-Wins guard refuses the record (a local edit is
 *     newer) - nothing changed, so there is nothing to announce.
 *   - The record applied, but `isValid` reads the same as it already did locally - a
 *     re-confirmation, not a change. Re-announcing a revocation already acted on would ask
 *     Encryption to destroy key material it has already destroyed.
 *   - The device never held this book (`before` is null) - the record still applies (a download
 *     row for a book this device is about to hold), but there is nothing to transition FROM, so
 *     `wasValid` defaults to `true` and a fresh row that already carries `isValid: false` DOES
 *     still announce - unlike the old feed, which filtered out books never downloaded because the
 *     feed covered the whole account. A downloads record only ever exists for a book that
 *     concerns this device, so that filter has no equivalent here.
 *
 * Returns whether the record was applied, exactly like the generic `applyServerRecord`, so the
 * caller in `pull()` can count it the same way it counts every other collection.
 */
export async function applyDownloadRecord(record: any): Promise<boolean> {
  const before = await downloadTable.findById(record.id);
  const wasValid = before ? before.is_valid !== 0 : true;

  const applied = await downloadTable.applyServerRecord(record);
  if (!applied) return false;

  const isValid = record.isValid !== false;
  if (wasValid !== isValid) {
    const bookId = (record.bookId ?? before?.book_id) as string;
    const observedAt = observedAtFor(record);

    if (isValid) {
      const signal: UnlockSignal = { type: OFFLINE_LOCK_EVENTS.UNLOCK, bookId, observedAt };
      eventBus.emit(OFFLINE_LOCK_EVENTS.UNLOCK, signal);
    } else {
      const signal: LockSignal = {
        type: OFFLINE_LOCK_EVENTS.LOCK,
        bookId,
        reason: 'revoked',
        observedAt,
      };
      eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, signal);
    }
  }

  return applied;
}

/** Marks that the downloads collection - the entitlement check, now - was just pulled. */
export async function recordEntitlementCheck(): Promise<void> {
  await syncMetadataStore.set(SYNC_KEYS.LAST_ENTITLEMENT_CHECK_AT, nowIso());
}

/**
 * Has a downloads pull ever completed on this device?
 *
 * For the UI, so it can tell "entitlement confirmed" from "never confirmed". `is_valid` reads as
 * valid in both cases, so without this a banner would claim an entitlement the device has never
 * actually pulled.
 */
export async function lastEntitlementCheckAt(): Promise<string | null> {
  return syncMetadataStore.get(SYNC_KEYS.LAST_ENTITLEMENT_CHECK_AT);
}
