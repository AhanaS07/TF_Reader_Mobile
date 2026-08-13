// The core offline guarantee lives in createSyncableTable: every local edit
// writes the row and queues its outbox operation in ONE transaction, and no
// stale record ever overwrites a newer one. These run against real SQLite
// (sql.js, via root __mocks__/expo-sqlite.js).

import { getDatabase } from '../localDb/database';
import type { DownloadRow, OutboxRow, ProgressRow } from '../localDb/types';
import { downloadTable } from './downloadStore';
import { progressTable } from './progressStore';

const USER = 'user-001';
const BOOK = 'book-001';

function progressRow(id: string, offset: number, updatedAt: string): ProgressRow {
  return {
    id,
    user_id: USER,
    book_id: BOOK,
    offset,
    locator: JSON.stringify({ type: 'PDF', page: offset }),
    updated_at: updatedAt,
    is_deleted: 0,
    synced: 0,
  };
}

async function outboxFor(entityId: string): Promise<OutboxRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE entity_id = ? ORDER BY created_at ASC`,
    [entityId],
  );
}

async function progressById(id: string): Promise<ProgressRow | null> {
  const db = await getDatabase();
  return db.getFirstAsync<ProgressRow>(`SELECT * FROM progress WHERE id = ?`, [id]);
}

describe('saveLocal', () => {
  it('persists the row unsynced AND queues exactly one outbox operation', async () => {
    const id = 'p-save-1';
    await progressTable.saveLocal(progressRow(id, 7, '2026-01-01T00:00:00.000Z'), 'CREATE');

    const row = await progressById(id);
    expect(row?.offset).toBe(7);
    expect(row?.synced).toBe(0);

    const queued = await outboxFor(id);
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe('CREATE');
    expect(queued[0].status).toBe('PENDING');
    expect(JSON.parse(queued[0].payload).offset).toBe(7);
  });

  it('never sends the device-only `synced` column to the server', async () => {
    const id = 'p-save-2';
    await progressTable.saveLocal(progressRow(id, 3, '2026-01-01T00:00:00.000Z'), 'CREATE');
    const payload = JSON.parse((await outboxFor(id))[0].payload);
    expect(payload).not.toHaveProperty('synced');
    expect(payload).not.toHaveProperty('local_path');
  });

  it('coalesces repeated edits of one record into a single newest operation', async () => {
    const id = 'p-coalesce';
    await progressTable.saveLocal(progressRow(id, 1, '2026-01-01T00:00:00.000Z'), 'CREATE');
    await progressTable.saveLocal(progressRow(id, 2, '2026-01-01T00:00:01.000Z'), 'UPDATE');
    await progressTable.saveLocal(progressRow(id, 3, '2026-01-01T00:00:02.000Z'), 'UPDATE');

    const queued = await outboxFor(id);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0].payload).offset).toBe(3);
  });

  it('keeps updated_at strictly increasing even when the incoming stamp is older', async () => {
    // The server stamps its own clock and the device adopts it, so the next
    // offline edit can legitimately carry an EARLIER timestamp than the row it
    // replaces. Without the monotonic bump that edit reads as stale and is lost.
    const id = 'p-monotonic';
    const first = await progressTable.saveLocal(
      progressRow(id, 1, '2026-06-01T12:00:00.000Z'),
      'CREATE',
    );
    const second = await progressTable.saveLocal(
      progressRow(id, 2, '2026-01-01T00:00:00.000Z'),
      'UPDATE',
    );
    expect(second.updated_at > first.updated_at).toBe(true);
  });

  it('preserves server_updated_at across a local edit (the conflict base version)', async () => {
    const id = 'p-base-version';
    const db = await getDatabase();
    await progressTable.writeRow({
      ...progressRow(id, 1, '2026-03-01T00:00:00.000Z'),
      synced: 1,
      server_updated_at: '2026-03-01T00:00:00.000Z',
    });

    await progressTable.saveLocal(progressRow(id, 2, '2026-03-02T00:00:00.000Z'), 'UPDATE');

    const row = await db.getFirstAsync<ProgressRow>(
      `SELECT * FROM progress WHERE id = ?`,
      [id],
    );
    expect(row?.server_updated_at).toBe('2026-03-01T00:00:00.000Z');
    expect(row?.synced).toBe(0);
  });
});

describe('softDeleteLocal', () => {
  it('tombstones the row and queues a DELETE so it can propagate', async () => {
    const id = 'p-delete';
    await progressTable.saveLocal(progressRow(id, 5, '2026-01-01T00:00:00.000Z'), 'CREATE');
    await progressTable.softDeleteLocal(id);

    const row = await progressById(id);
    expect(row).not.toBeNull();
    expect(row?.is_deleted).toBe(1);

    const queued = await outboxFor(id);
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe('DELETE');
  });

  it('is a no-op for an id that was never stored', async () => {
    await expect(progressTable.softDeleteLocal('p-does-not-exist')).resolves.toBeUndefined();
    expect(await outboxFor('p-does-not-exist')).toHaveLength(0);
  });
});

describe('applyServerRecord (pull, Last-Write-Wins)', () => {
  it('applies a server record that is newer than the local row', async () => {
    const id = 'p-pull-newer';
    await progressTable.writeRow(progressRow(id, 1, '2026-01-01T00:00:00.000Z'));

    const applied = await progressTable.applyServerRecord({
      id,
      userId: USER,
      bookId: BOOK,
      offset: 42,
      updatedAt: '2026-02-01T00:00:00.000Z',
      isDeleted: false,
    });

    expect(applied).toBe(true);
    const row = await progressById(id);
    expect(row?.offset).toBe(42);
    expect(row?.synced).toBe(1);
    expect(row?.server_updated_at).toBe('2026-02-01T00:00:00.000Z');
  });

  it('leaves a newer local edit alone so its queued push still wins', async () => {
    const id = 'p-pull-older';
    await progressTable.writeRow(progressRow(id, 99, '2026-05-01T00:00:00.000Z'));

    const applied = await progressTable.applyServerRecord({
      id,
      userId: USER,
      bookId: BOOK,
      offset: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    });

    expect(applied).toBe(false);
    expect((await progressById(id))?.offset).toBe(99);
  });

  it('preserves local_path, which exists only on this device', async () => {
    // The server has no column for it and always sends null. Dropping it would
    // leave a downloaded book unreadable after the next sync.
    const id = 'd-local-path';
    await downloadTable.writeRow({
      id,
      user_id: USER,
      book_id: BOOK,
      format: 'PDF',
      local_path: '/var/books/book-001.pdf',
      status: 'COMPLETED',
      is_valid: 1,
      downloaded_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      is_deleted: 0,
      synced: 1,
    });

    await downloadTable.applyServerRecord({
      id,
      userId: USER,
      bookId: BOOK,
      format: 'PDF',
      status: 'COMPLETED',
      isValid: true,
      updatedAt: '2026-02-01T00:00:00.000Z',
      isDeleted: false,
    });

    const db = await getDatabase();
    const row = await db.getFirstAsync<DownloadRow>(
      `SELECT * FROM downloads WHERE id = ?`,
      [id],
    );
    expect(row?.local_path).toBe('/var/books/book-001.pdf');
  });
});

describe('adoptPushResult (push echo)', () => {
  it("adopts the server's stored copy when the row is untouched", async () => {
    const id = 'p-adopt';
    const saved = await progressTable.saveLocal(
      progressRow(id, 11, '2026-01-01T00:00:00.000Z'),
      'CREATE',
    );

    const adopted = await progressTable.adoptPushResult(
      {
        id,
        userId: USER,
        bookId: BOOK,
        offset: 11,
        updatedAt: '2026-01-01T09:00:00.000Z', // server's own clock
        isDeleted: false,
      },
      saved.updated_at,
    );

    expect(adopted).toBe(true);
    const row = await progressById(id);
    expect(row?.synced).toBe(1);
    expect(row?.updated_at).toBe('2026-01-01T09:00:00.000Z');
    expect(row?.server_updated_at).toBe('2026-01-01T09:00:00.000Z');
  });

  it('declines when the user edited the row mid-push, leaving it unsynced', async () => {
    const id = 'p-adopt-raced';
    const first = await progressTable.saveLocal(
      progressRow(id, 1, '2026-01-01T00:00:00.000Z'),
      'CREATE',
    );
    await progressTable.saveLocal(progressRow(id, 2, '2026-01-01T00:00:05.000Z'), 'UPDATE');

    const adopted = await progressTable.adoptPushResult(
      { id, userId: USER, bookId: BOOK, offset: 1, updatedAt: '2026-01-01T09:00:00.000Z', isDeleted: false },
      first.updated_at, // the stamp that was actually in the pushed payload
    );

    expect(adopted).toBe(false);
    const row = await progressById(id);
    expect(row?.offset).toBe(2);
    expect(row?.synced).toBe(0);
  });
});

describe('listActive', () => {
  it('excludes tombstoned rows', async () => {
    const live = 'p-list-live';
    const dead = 'p-list-dead';
    await progressTable.writeRow(progressRow(live, 1, '2026-07-01T00:00:00.000Z'));
    await progressTable.writeRow({
      ...progressRow(dead, 2, '2026-07-02T00:00:00.000Z'),
      is_deleted: 1,
    });

    const ids = (await progressTable.listActive(USER, BOOK)).map((r) => r.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(dead);
  });
});
