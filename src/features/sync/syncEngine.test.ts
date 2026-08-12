// End-to-end sync behaviour with the network faked at the syncApi boundary and
// real SQLite underneath (sql.js, via root __mocks__/expo-sqlite.js). The three
// invariants under test:
//   1. An outbox row is removed only after the server has acknowledged it.
//   2. The pull checkpoint advances only after every pulled record is applied.
//   3. The licence check fails open - it never revokes a book on a bad connection.

import { getDatabase } from './localDb/database';
import { SYNC_KEYS } from './localDb/schema';
import type { DownloadRow, OutboxRow, ProgressRow } from './localDb/types';
import { progressTable } from './stores/progressStore';
import { syncMetadataStore } from './stores/syncMetadataStore';
import { api, ApiError } from './syncApi';
import { syncEngine } from './syncEngine';

// Babel hoists jest.mock above the imports above, so `api` is already the mock
// by the time anything here runs. The real ApiError is kept, because the engine
// branches on `instanceof ApiError` to tell transient from permanent failures.
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
      licenceExpired: jest.fn(),
      health: jest.fn(),
    },
  };
});

const mockApi = api as jest.Mocked<typeof api>;

const USER = 'user-001';
const BOOK = 'book-001';
const SERVER_TIME = '2026-08-13T10:00:00.000Z';

const ok = <T>(data: T) => Promise.resolve({ data, serverTime: SERVER_TIME });

function progressRow(id: string, offset: number, updatedAt: string): ProgressRow {
  return {
    id,
    user_id: USER,
    book_id: BOOK,
    offset,
    updated_at: updatedAt,
    is_deleted: 0,
    synced: 0,
  };
}

async function outboxAll(): Promise<OutboxRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<OutboxRow>(`SELECT * FROM outbox`);
}

async function resetTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM progress; DELETE FROM downloads; DELETE FROM sync_metadata;`,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await resetTables();

  // Defaults: nothing on the server, licence current. Individual tests override.
  mockApi.list.mockImplementation(() => ok([]) as any);
  mockApi.licenceExpired.mockImplementation(() => ok(false) as any);
});

describe('push', () => {
  it('sends a queued CREATE and clears the outbox only after acknowledgement', async () => {
    await progressTable.saveLocal(progressRow('p1', 12, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockImplementation((_path, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:59:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(mockApi.create).toHaveBeenCalledTimes(1);
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(0);
    expect(await outboxAll()).toHaveLength(0);
  });

  it("adopts the server's updatedAt so the record is not re-applied on every pull", async () => {
    await progressTable.saveLocal(progressRow('p2', 4, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockImplementation((_path, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:58:00.000Z' }) as any,
    );

    await syncEngine.run();

    const row = await progressTable.findById('p2');
    expect(row?.updated_at).toBe('2026-08-13T09:58:00.000Z');
    expect(row?.server_updated_at).toBe('2026-08-13T09:58:00.000Z');
    expect(row?.synced).toBe(1);
  });

  it('keeps the queue intact when the device is offline', async () => {
    await progressTable.saveLocal(progressRow('p3', 1, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockRejectedValue(new ApiError('offline', 0));

    const report = await syncEngine.run();

    expect(report.pushed).toBe(0);
    expect(report.error).toBeDefined();
    expect(await outboxAll()).toHaveLength(1);
  });

  it('backs off a rejected payload instead of blocking the queue behind it', async () => {
    await progressTable.saveLocal(progressRow('p4', 1, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockRejectedValue(new ApiError('bad request', 400));

    const report = await syncEngine.run();

    expect(report.failed).toBe(1);
    const [queued] = await outboxAll();
    expect(queued.status).toBe('FAILED');
    expect(queued.retry_count).toBe(1);
    expect(queued.next_retry_at).not.toBeNull();
  });

  it('falls back to PUT when a create answers 409 (a retried push is idempotent)', async () => {
    await progressTable.saveLocal(progressRow('p5', 8, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockRejectedValue(new ApiError('already exists', 409));
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:57:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(mockApi.update).toHaveBeenCalledTimes(1);
    expect(report.pushed).toBe(1);
    expect(await outboxAll()).toHaveLength(0);
  });

  it('yields to a concurrent write from another device and drops our operation', async () => {
    // server_updated_at is the base version: the value the server had when this
    // device last saw it. A different value now means someone else wrote it.
    await progressTable.writeRow({
      ...progressRow('p6', 1, '2026-08-01T00:00:00.000Z'),
      synced: 1,
      server_updated_at: '2026-08-01T00:00:00.000Z',
    });
    await progressTable.saveLocal(progressRow('p6', 2, '2026-08-02T00:00:00.000Z'), 'UPDATE');

    mockApi.findById.mockImplementation(() =>
      ok({
        id: 'p6',
        userId: USER,
        bookId: BOOK,
        offset: 77,
        updatedAt: '2026-08-05T00:00:00.000Z', // moved on since our base version
        isDeleted: false,
      }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.update).not.toHaveBeenCalled();
    expect((await progressTable.findById('p6'))?.offset).toBe(77);
    expect(await outboxAll()).toHaveLength(0);
  });
});

describe('pull', () => {
  it('applies server records and advances the checkpoint to the server clock', async () => {
    mockApi.list.mockImplementation((path: string) =>
      path === 'progress'
        ? (ok([
            {
              id: 'remote-1',
              userId: USER,
              bookId: BOOK,
              offset: 55,
              updatedAt: '2026-08-12T00:00:00.000Z',
              isDeleted: false,
            },
          ]) as any)
        : (ok([]) as any),
    );

    const report = await syncEngine.run();

    expect(report.pulled).toBe(1);
    expect(report.applied).toBe(1);
    expect((await progressTable.findById('remote-1'))?.offset).toBe(55);
    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_PULL_TOKEN)).toBe(SERVER_TIME);
  });

  it('reads every one of the six collections', async () => {
    await syncEngine.run();
    expect(mockApi.list).toHaveBeenCalledTimes(6);
  });

  it('does not advance the checkpoint when the pull fails', async () => {
    mockApi.list.mockRejectedValue(new ApiError('offline', 0));

    const report = await syncEngine.run();

    expect(report.error).toBeDefined();
    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_PULL_TOKEN)).toBeNull();
  });
});

describe('licence check', () => {
  async function seedDownload(isValid: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO downloads
         (id, user_id, book_id, format, local_path, status, is_valid,
          downloaded_at, updated_at, is_deleted, synced)
       VALUES (?, ?, ?, 'PDF', '/tmp/b.pdf', 'COMPLETED', ?, ?, ?, 0, 1)`,
      ['d1', USER, BOOK, isValid, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'],
    );
  }

  async function validityFlag(): Promise<number | undefined> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DownloadRow>(
      `SELECT * FROM downloads WHERE id = ?`,
      ['d1'],
    );
    return row?.is_valid;
  }

  it('revokes the book when the server reports the licence expired', async () => {
    await seedDownload(1);
    mockApi.licenceExpired.mockImplementation(() => ok(true) as any);

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ valid: false, changed: true });
    expect(await validityFlag()).toBe(0);
  });

  it('restores a book whose licence is current again', async () => {
    await seedDownload(0);
    mockApi.licenceExpired.mockImplementation(() => ok(false) as any);

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ valid: true, changed: true });
    expect(await validityFlag()).toBe(1);
  });

  it('reports changed:false when the verdict only confirms what we knew', async () => {
    await seedDownload(1);
    mockApi.licenceExpired.mockImplementation(() => ok(false) as any);

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ valid: true, changed: false });
    expect(await validityFlag()).toBe(1);
  });

  it('fails open when offline - a dropped connection must not revoke a book', async () => {
    await seedDownload(1);
    mockApi.licenceExpired.mockRejectedValue(new ApiError('offline', 0));

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ changed: false });
    expect(await validityFlag()).toBe(1);
  });

  it('leaves validity alone on 404, since an unseeded collection is not a revocation', async () => {
    await seedDownload(1);
    mockApi.licenceExpired.mockRejectedValue(new ApiError('no licence', 404));

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ changed: false });
    expect(await validityFlag()).toBe(1);
  });

  it('ignores a non-boolean 200 from a proxy or error page', async () => {
    await seedDownload(1);
    mockApi.licenceExpired.mockImplementation(() => ok('<html>' as any) as any);

    const report = await syncEngine.run();

    expect(report.licence).toEqual({ changed: false });
    expect(await validityFlag()).toBe(1);
  });

  it('still runs after a push failure, because it is independent of the queue', async () => {
    await seedDownload(1);
    await progressTable.saveLocal(progressRow('p7', 1, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockRejectedValue(new ApiError('offline', 0));
    mockApi.licenceExpired.mockImplementation(() => ok(true) as any);

    const report = await syncEngine.run();

    expect(report.error).toBeDefined();
    expect(report.licence).toEqual({ valid: false, changed: true });
  });
});

describe('run', () => {
  it('shares one run between concurrent callers rather than racing', async () => {
    const [a, b] = await Promise.all([syncEngine.run(), syncEngine.run()]);
    expect(a).toBe(b);
    expect(mockApi.list).toHaveBeenCalledTimes(6);
  });

  it('is not running once the run has settled', async () => {
    await syncEngine.run();
    expect(syncEngine.isRunning()).toBe(false);
  });
});
