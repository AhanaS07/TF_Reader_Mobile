// Offline lock, against real SQLite (sql.js via root __mocks__/expo-sqlite.js) with flambeau's
// change feed faked at the syncApi boundary.
//
// The invariants under test, in order of how badly each fails:
//   1. FAIL OPEN. Offline, a timeout, or an unreadable body emits nothing, changes no row, and
//      does not advance the cursor. Revoking a book because the network dropped is worse than
//      asking again.
//   2. The cursor advances only after every entry has been applied - the same rule as the pull
//      checkpoint. A cursor advanced early skips a revocation permanently.
//   3. A signal fires only on a real state change. Re-announcing a revocation would ask
//      Encryption to destroy key material it already destroyed.
//   4. ENTITLEMENT_EXPIRED is 'expired', not 'revoked'. Only 'revoked' destroys the BEK, and
//      expiry is something Encryption already sees from the licence it holds.

import { EVENT_CHANNELS } from '@/shared/contracts';
import type { LockSignal, UnlockSignal } from '@/shared/contracts';
import { eventBus, resetEventBusForTests } from '@/shared/eventBus';
import { getDatabase } from './localDb/database';
import { SYNC_KEYS } from './localDb/schema';
import type { DownloadRow } from './localDb/types';
import { checkEntitlements, lastEntitlementCheckAt } from './offlineLock';
import { syncMetadataStore } from './stores/syncMetadataStore';
import { api, ApiError } from './syncApi';
import { MAX_LOAN_CHANGE_PAGES } from './syncConfig';

jest.mock('./syncApi', () => {
  const actual = jest.requireActual('./syncApi');
  return {
    __esModule: true,
    ApiError: actual.ApiError,
    api: {
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      loanChanges: jest.fn(),
      health: jest.fn(),
    },
  };
});

const mockApi = api as jest.Mocked<typeof api>;

const USER = 'user-001';
const SERVER_TIME = '2026-08-17T10:00:00.000Z';

const page = (entries: unknown[], nextCursor: string | null = null) =>
  Promise.resolve({ data: { entries, nextCursor }, serverTime: SERVER_TIME });

async function seedDownload(bookId: string, isValid = 1): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO downloads
       (id, user_id, book_id, format, local_path, status, is_valid,
        downloaded_at, updated_at, is_deleted, synced)
     VALUES (?, ?, ?, 'EPUB', '/tmp/b.epub', 'COMPLETED', ?, ?, ?, 0, 1)`,
    [`dl-${bookId}`, USER, bookId, isValid, SERVER_TIME, SERVER_TIME],
  );
}

async function validityOf(bookId: string): Promise<number | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DownloadRow>(
    `SELECT * FROM downloads WHERE book_id = ?`,
    [bookId],
  );
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
  jest.clearAllMocks();
  resetEventBusForTests();
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM downloads; DELETE FROM sync_metadata;`);
  mockApi.loanChanges.mockImplementation(() => page([]) as never);
});

describe('revocation', () => {
  it('locks the book, records it, and emits content.lock', async () => {
    await seedDownload('book-1');
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          {
            bookId: 'book-1',
            reason: 'ENTITLEMENT_REVOKED',
            occurredAt: '2026-08-17T09:00:00.000Z',
            dueAt: null,
          },
        ]) as never,
    );

    const report = await checkEntitlements();

    expect(report.checked).toBe(true);
    expect(report.revoked).toEqual(['book-1']);
    expect(await validityOf('book-1')).toBe(0);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toEqual({
      type: 'content.lock',
      bookId: 'book-1',
      reason: 'revoked',
      observedAt: Date.parse('2026-08-17T09:00:00.000Z'),
    });
  });

  it("uses reason 'expired' for ENTITLEMENT_EXPIRED so the BEK is not destroyed", async () => {
    // Only 'revoked' asks Encryption to destroy key material. Expiry it already sees from the
    // licence, and destroying on it would force a needless re-download.
    await seedDownload('book-1');
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { bookId: 'book-1', reason: 'ENTITLEMENT_EXPIRED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    await checkEntitlements();

    expect(locks[0].reason).toBe('expired');
  });

  it('treats a returned loan and a suspended entitlement as locking too', async () => {
    await seedDownload('book-1');
    await seedDownload('book-2');
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { bookId: 'book-1', reason: 'LOAN_RETURNED', occurredAt: SERVER_TIME },
          { bookId: 'book-2', reason: 'ENTITLEMENT_SUSPENDED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    const report = await checkEntitlements();

    expect(report.revoked.sort()).toEqual(['book-1', 'book-2']);
    expect(locks.map((l) => l.reason)).toEqual(['revoked', 'revoked']);
  });

  it('accepts itemId as the identifier, since the two teams name it differently', async () => {
    await seedDownload('book-1');
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { itemId: 'book-1', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    expect((await checkEntitlements()).revoked).toEqual(['book-1']);
  });
});

describe('signals fire only on a real change', () => {
  it('says nothing about a book this device does not hold', async () => {
    // The feed covers the whole account. Announcing a lock for a book never downloaded is noise.
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { bookId: 'never-downloaded', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    const report = await checkEntitlements();

    expect(report.revoked).toEqual([]);
    expect(locks).toHaveLength(0);
    expect(report.entriesSeen).toBe(1); // understood, just not applicable
  });

  it('does not re-announce a revocation it already applied', async () => {
    await seedDownload('book-1', 0); // already locked
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { bookId: 'book-1', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    const report = await checkEntitlements();

    expect(report.revoked).toEqual([]);
    expect(locks).toHaveLength(0);
    expect(await validityOf('book-1')).toBe(0);
  });

  it('ignores a reason it does not recognise rather than guessing', async () => {
    await seedDownload('book-1');
    const { locks, unlocks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          { bookId: 'book-1', reason: 'SOMETHING_NEW_FLAMBEAU_ADDED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    const report = await checkEntitlements();

    expect(report.entriesSeen).toBe(0);
    expect(locks).toHaveLength(0);
    expect(unlocks).toHaveLength(0);
    expect(await validityOf('book-1')).toBe(1);
  });
});

describe('restoration', () => {
  it('unlocks on LOAN_RENEWED and emits content.unlock', async () => {
    await seedDownload('book-1', 0);
    const { unlocks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([{ bookId: 'book-1', reason: 'LOAN_RENEWED', occurredAt: SERVER_TIME }]) as never,
    );

    const report = await checkEntitlements();

    expect(report.restored).toEqual(['book-1']);
    expect(await validityOf('book-1')).toBe(1);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0].bookId).toBe('book-1');
  });

  it('stays silent when the book was never locked', async () => {
    await seedDownload('book-1', 1);
    const { unlocks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () =>
        page([{ bookId: 'book-1', reason: 'LOAN_RENEWED', occurredAt: SERVER_TIME }]) as never,
    );

    expect((await checkEntitlements()).restored).toEqual([]);
    expect(unlocks).toHaveLength(0);
  });
});

describe('fail open', () => {
  it('emits nothing and changes nothing when offline', async () => {
    await seedDownload('book-1');
    const { locks } = captureSignals();
    mockApi.loanChanges.mockRejectedValue(new ApiError('offline', 0));

    const report = await checkEntitlements();

    expect(report.checked).toBe(false);
    expect(report.error).toBeDefined();
    expect(locks).toHaveLength(0);
    expect(await validityOf('book-1')).toBe(1);
  });

  it('does not advance the cursor when the feed cannot be read', async () => {
    await syncMetadataStore.set(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR, 'cursor-7');
    mockApi.loanChanges.mockRejectedValue(new ApiError('timeout', 0));

    await checkEntitlements();

    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR)).toBe('cursor-7');
  });

  it('does not record a check that never got an answer', async () => {
    mockApi.loanChanges.mockRejectedValue(new ApiError('offline', 0));

    await checkEntitlements();

    expect(await lastEntitlementCheckAt()).toBeNull();
  });

  it('treats a 404 as learning nothing, not as a revocation', async () => {
    // An undeployed endpoint must not lock every book on the device.
    await seedDownload('book-1');
    mockApi.loanChanges.mockRejectedValue(new ApiError('not found', 404));

    const report = await checkEntitlements();

    expect(report.checked).toBe(false);
    expect(await validityOf('book-1')).toBe(1);
  });

  it('survives a body that is not the shape we expect', async () => {
    // The endpoint has never been called by this app, so a shape mismatch is a realistic first
    // outcome. It must read as "no changes", never as "everything is revoked".
    await seedDownload('book-1');
    const { locks } = captureSignals();
    mockApi.loanChanges.mockImplementation(
      () => Promise.resolve({ data: '<html>error</html>', serverTime: SERVER_TIME }) as never,
    );

    const report = await checkEntitlements();

    expect(report.checked).toBe(true);
    expect(report.entriesSeen).toBe(0);
    expect(locks).toHaveLength(0);
    expect(await validityOf('book-1')).toBe(1);
  });

  it('skips a malformed entry but still applies its well-formed neighbours', async () => {
    await seedDownload('book-1');
    mockApi.loanChanges.mockImplementation(
      () =>
        page([
          null,
          { reason: 'ENTITLEMENT_REVOKED' }, // no book id
          { bookId: 'book-1', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME },
        ]) as never,
    );

    expect((await checkEntitlements()).revoked).toEqual(['book-1']);
  });
});

describe('cursor', () => {
  it('sends no cursor on the very first call', async () => {
    await checkEntitlements();
    expect(mockApi.loanChanges).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('persists the cursor and echoes it back next run', async () => {
    mockApi.loanChanges.mockImplementation(() => page([], 'cursor-1') as never);
    await checkEntitlements();
    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR)).toBe('cursor-1');

    mockApi.loanChanges.mockClear();
    mockApi.loanChanges.mockImplementation(() => page([]) as never);
    await checkEntitlements();

    expect(mockApi.loanChanges).toHaveBeenCalledWith(expect.any(String), 'cursor-1');
  });

  it('drains multiple pages in one run', async () => {
    await seedDownload('book-1');
    await seedDownload('book-2');
    mockApi.loanChanges
      .mockImplementationOnce(
        () =>
          page(
            [{ bookId: 'book-1', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME }],
            'cursor-1',
          ) as never,
      )
      .mockImplementationOnce(
        () =>
          page(
            [{ bookId: 'book-2', reason: 'ENTITLEMENT_REVOKED', occurredAt: SERVER_TIME }],
            'cursor-2',
          ) as never,
      )
      .mockImplementation(() => page([], 'cursor-2') as never);

    const report = await checkEntitlements();

    expect(report.revoked.sort()).toEqual(['book-1', 'book-2']);
    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR)).toBe('cursor-2');
  });

  it('stops rather than looping when the cursor stops moving', async () => {
    // A server that returns the same cursor forever must not spin the drain loop. Two calls,
    // not one: the first moves null -> 'stuck', and it takes the second to observe that
    // 'stuck' has not moved. Far below MAX_LOAN_CHANGE_PAGES, which is the outer backstop.
    mockApi.loanChanges.mockImplementation(() => page([], 'stuck') as never);

    await checkEntitlements();

    expect(mockApi.loanChanges).toHaveBeenCalledTimes(2);
  });

  it('never exceeds MAX_LOAN_CHANGE_PAGES even if the cursor keeps moving', async () => {
    let n = 0;
    mockApi.loanChanges.mockImplementation(() => {
      n += 1;
      return page([], `cursor-${n}`) as never;
    });

    await checkEntitlements();

    expect(mockApi.loanChanges).toHaveBeenCalledTimes(MAX_LOAN_CHANGE_PAGES);
  });

  it('keeps the previous cursor when the server returns none', async () => {
    // Clearing it would re-read the feed from the start and re-announce handled revocations.
    await syncMetadataStore.set(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR, 'cursor-9');
    mockApi.loanChanges.mockImplementation(() => page([], null) as never);

    await checkEntitlements();

    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_LOAN_CHANGES_CURSOR)).toBe('cursor-9');
  });

  it('records when the feed last answered', async () => {
    await checkEntitlements();
    const at = await lastEntitlementCheckAt();
    expect(at).not.toBeNull();
    expect(new Date(at!).toISOString()).toBe(at);
  });
});
