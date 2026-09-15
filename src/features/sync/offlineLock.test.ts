// Offline lock (B6), against real SQLite (sql.js via root __mocks__/expo-sqlite.js).
//
// The licence side now writes `isValid` directly on the `downloads` document server-side, so
// there is no feed left to fake at the syncApi boundary - `applyDownloadRecord` is exercised
// directly with server-shaped records, the same records a `downloads` pull would hand it.
//
// The invariants under test, in order of how badly each fails:
//   1. A signal fires only on a real state change. Re-announcing a revocation would ask
//      Encryption to destroy key material it already destroyed.
//   2. Last-Write-Wins still governs whether the record is even applied - inherited from the
//      generic `applyServerRecord` this wraps. A record that never lands announces nothing.
//   3. A device seeing this book for the very first time still gets a signal if the first record
//      it ever sees already carries `isValid: false` - unlike the old feed, which filtered out
//      books never downloaded because the feed covered the whole account. A `downloads` record
//      only ever exists for a book that concerns this device, so that filter has no equivalent
//      here.

import { EVENT_CHANNELS } from '@/shared/contracts';
import type { LockSignal, UnlockSignal } from '@/shared/contracts';
import { eventBus, resetEventBusForTests } from '@/shared/eventBus';
import { getDatabase } from './localDb/database';
import type { DownloadRow } from './localDb/types';
import { applyDownloadRecord, lastEntitlementCheckAt, recordEntitlementCheck } from './offlineLock';

const USER = 'user-001';
const SERVER_TIME = '2026-08-20T10:00:00.000Z';

function serverRecord(bookId: string, isValid: boolean, updatedAt = SERVER_TIME) {
  return {
    id: `dl-${bookId}`,
    userId: USER,
    bookId,
    format: 'EPUB',
    status: 'COMPLETED',
    isValid,
    downloadedAt: SERVER_TIME,
    updatedAt,
    isDeleted: false,
  };
}

async function seedDownload(bookId: string, isValid: number, updatedAt: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO downloads
       (id, user_id, book_id, format, local_path, status, is_valid,
        downloaded_at, updated_at, is_deleted, synced)
     VALUES (?, ?, ?, 'EPUB', '/tmp/b.epub', 'COMPLETED', ?, ?, ?, 0, 1)`,
    [`dl-${bookId}`, USER, bookId, isValid, SERVER_TIME, updatedAt],
  );
}

async function validityOf(bookId: string): Promise<number | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DownloadRow>(`SELECT * FROM downloads WHERE book_id = ?`, [
    bookId,
  ]);
  return row?.is_valid;
}

/** Collects every lock/unlock signal emitted during a test. */
function captureSignals() {
  const locks: LockSignal[] = [];
  const unlocks: UnlockSignal[] = [];
  eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (p) => locks.push(p as LockSignal));
  eventBus.on(EVENT_CHANNELS.CONTENT_UNLOCK, (p) => unlocks.push(p as UnlockSignal));
  return { locks, unlocks };
}

beforeEach(async () => {
  resetEventBusForTests();
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM downloads; DELETE FROM sync_metadata;`);
});

describe('revocation', () => {
  it('locks the book, records it, and emits content.lock', async () => {
    await seedDownload('book-1', 1, '2026-08-20T09:00:00.000Z');
    const { locks } = captureSignals();

    const applied = await applyDownloadRecord(
      serverRecord('book-1', false, '2026-08-20T09:05:00.000Z'),
    );

    expect(applied).toBe(true);
    expect(await validityOf('book-1')).toBe(0);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toEqual({
      type: 'content.lock',
      bookId: 'book-1',
      reason: 'revoked',
      observedAt: Date.parse('2026-08-20T09:05:00.000Z'),
    });
  });

  it('a book seen for the first time still announces if it already arrives invalid', async () => {
    // No seedDownload - this device has never held the book before. Unlike the old feed, which
    // covered the whole account and filtered to books this device holds, a downloads record only
    // ever exists for a book that concerns this device, so there is nothing to filter here.
    const { locks } = captureSignals();

    const applied = await applyDownloadRecord(serverRecord('book-1', false));

    expect(applied).toBe(true);
    expect(locks).toHaveLength(1);
    expect(locks[0].bookId).toBe('book-1');
  });
});

describe('signals fire only on a real change', () => {
  it('does not re-announce a revocation it already applied', async () => {
    await seedDownload('book-1', 0, '2026-08-20T09:00:00.000Z'); // already locked
    const { locks } = captureSignals();

    const applied = await applyDownloadRecord(
      serverRecord('book-1', false, '2026-08-20T09:05:00.000Z'),
    );

    expect(applied).toBe(true); // the record still applies - it carries a newer updatedAt...
    expect(locks).toHaveLength(0); // ...but isValid did not transition, so nothing fires
    expect(await validityOf('book-1')).toBe(0);
  });

  it('stays silent when a valid book is re-confirmed valid', async () => {
    await seedDownload('book-1', 1, '2026-08-20T09:00:00.000Z');
    const { locks, unlocks } = captureSignals();

    await applyDownloadRecord(serverRecord('book-1', true, '2026-08-20T09:05:00.000Z'));

    expect(locks).toHaveLength(0);
    expect(unlocks).toHaveLength(0);
  });
});

describe('restoration', () => {
  it('unlocks on a real transition to valid and emits content.unlock', async () => {
    await seedDownload('book-1', 0, '2026-08-20T09:00:00.000Z');
    const { unlocks } = captureSignals();

    const applied = await applyDownloadRecord(
      serverRecord('book-1', true, '2026-08-20T09:05:00.000Z'),
    );

    expect(applied).toBe(true);
    expect(await validityOf('book-1')).toBe(1);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]).toEqual({
      type: 'content.unlock',
      bookId: 'book-1',
      observedAt: Date.parse('2026-08-20T09:05:00.000Z'),
    });
  });
});

describe('Last-Write-Wins still governs whether the record applies', () => {
  it('refuses a stale record and announces nothing', async () => {
    // The local row is NEWER than the incoming record, so the generic LWW guard inside
    // applyServerRecord refuses it - nothing changed, so nothing should be announced either.
    await seedDownload('book-1', 1, '2026-08-20T10:00:00.000Z');
    const { locks } = captureSignals();

    const applied = await applyDownloadRecord(
      serverRecord('book-1', false, '2026-08-20T09:00:00.000Z'),
    );

    expect(applied).toBe(false);
    expect(locks).toHaveLength(0);
    expect(await validityOf('book-1')).toBe(1);
  });
});

describe('entitlement check timestamp', () => {
  it('is null until the first successful check', async () => {
    expect(await lastEntitlementCheckAt()).toBeNull();
  });

  it('records when the downloads pull last completed', async () => {
    await recordEntitlementCheck();

    const at = await lastEntitlementCheckAt();
    expect(at).not.toBeNull();
    expect(new Date(at!).toISOString()).toBe(at);
  });
});
