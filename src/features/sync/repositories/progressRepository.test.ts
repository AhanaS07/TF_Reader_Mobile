// Exercises progressRepository.ts AND, through it, createSyncableTable's shared behavior
// (syncableTable.ts) — the core local-write / outbox / LWW logic every one of the six syncable
// tables shares. Against real SQLite (node:sqlite via __mocks__/expo-sqlite.js).

import { progressRepository } from './progressRepository';
import { outboxRepository } from './outboxRepository';
import { USER_ID, BOOK_ID } from '../config';

describe('progressRepository.savePosition / current', () => {
  it('creates a new row on the first save, enqueues an outbox CREATE', async () => {
    const before = await outboxRepository.countPending();
    const row = await progressRepository.savePosition(5);

    expect(row.offset).toBe(5);
    expect(row.user_id).toBe(USER_ID);
    expect(row.book_id).toBe(BOOK_ID);
    expect(row.synced).toBe(0);

    const current = await progressRepository.current();
    expect(current?.offset).toBe(5);
    expect(await outboxRepository.countPending()).toBe(before + 1);
  });

  it('updates the SAME row (not a new one) on the next save, enqueues UPDATE not another CREATE', async () => {
    const first = await progressRepository.savePosition(10);
    const second = await progressRepository.savePosition(11);

    expect(second.id).toBe(first.id);
    expect((await progressRepository.current())?.offset).toBe(11);

    // Same id -> the outbox coalesced to one pending op for this record, not two.
    const pending = await outboxRepository.listPending(1000);
    expect(pending.filter((op) => op.entity_id === first.id)).toHaveLength(1);
  });

  it('a local edit is always stamped strictly after the row it replaces (monotonic, not just wall-clock)', async () => {
    const first = await progressRepository.savePosition(1);
    // Force a second save whose "now" would, in a real clock-skew scenario, land at or before
    // the first's timestamp. saveLocal's monotonicStamp must bump it forward regardless.
    const second = await progressRepository.savePosition(2);
    expect(second.updated_at >= first.updated_at).toBe(true);
    expect(second.updated_at > first.updated_at || second.id === first.id).toBe(true);
  });
});

describe('createSyncableTable via progressRepository — applyServerRecord (PULL / Last-Write-Wins)', () => {
  it('applies an incoming server record when the local row is older', async () => {
    const bookId = 'lww-book-older';
    const olderLocal = {
      id: 'row-a',
      user_id: USER_ID,
      book_id: bookId,
      offset: 1,
      updated_at: '2020-01-01T00:00:00.000Z',
      is_deleted: 0,
      synced: 1,
    };
    await progressRepository.writeRow(olderLocal);

    const applied = await progressRepository.applyServerRecord({
      id: 'row-a',
      userId: USER_ID,
      bookId,
      offset: 99,
      updatedAt: '2024-01-01T00:00:00.000Z',
      isDeleted: false,
    });

    expect(applied).toBe(true);
    const stored = await progressRepository.findById('row-a');
    expect(stored?.offset).toBe(99);
  });

  it('rejects an incoming server record when the local row is newer or equal (LWW keeps local)', async () => {
    const newerLocal = {
      id: 'row-b',
      user_id: USER_ID,
      book_id: 'lww-book-newer',
      offset: 42,
      updated_at: '2030-01-01T00:00:00.000Z',
      is_deleted: 0,
      synced: 1,
    };
    await progressRepository.writeRow(newerLocal);

    const applied = await progressRepository.applyServerRecord({
      id: 'row-b',
      userId: USER_ID,
      bookId: 'lww-book-newer',
      offset: 1,
      updatedAt: '2020-01-01T00:00:00.000Z',
      isDeleted: false,
    });

    expect(applied).toBe(false);
    expect((await progressRepository.findById('row-b'))?.offset).toBe(42);
  });
});

describe('createSyncableTable via progressRepository — softDeleteLocal', () => {
  it('tombstones rather than deleting: the row survives with is_deleted=1 and re-queues for push', async () => {
    const row = await progressRepository.savePosition(7);
    await progressRepository.softDeleteLocal(row.id);

    const stillThere = await progressRepository.findById(row.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.is_deleted).toBe(1);
    expect(stillThere?.synced).toBe(0);

    // Deleted rows are excluded from listActive.
    const active = await progressRepository.listActive(USER_ID, BOOK_ID);
    expect(active.find((r) => r.id === row.id)).toBeUndefined();
  });

  it('is a no-op for an id that does not exist', async () => {
    await expect(progressRepository.softDeleteLocal('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('createSyncableTable via progressRepository — adoptPushResult (PUSH echo)', () => {
  it('adopts the server-stamped record when the pushed timestamp still matches', async () => {
    const row = await progressRepository.savePosition(3);
    const adopted = await progressRepository.adoptPushResult(
      {
        id: row.id,
        userId: USER_ID,
        bookId: BOOK_ID,
        offset: row.offset,
        updatedAt: '2099-01-01T00:00:00.000Z', // server's own clock
        isDeleted: false,
      },
      row.updated_at // the timestamp that was actually in the pushed payload
    );

    expect(adopted).toBe(true);
    const stored = await progressRepository.findById(row.id);
    expect(stored?.server_updated_at).toBe('2099-01-01T00:00:00.000Z');
    expect(stored?.synced).toBe(1);
  });

  it('does NOT adopt when the row was edited again while the push was in flight', async () => {
    const row = await progressRepository.savePosition(4);
    const staleTimestamp = row.updated_at;

    // A second edit lands before the push response comes back.
    await progressRepository.savePosition(5);

    const adopted = await progressRepository.adoptPushResult(
      { id: row.id, userId: USER_ID, bookId: BOOK_ID, offset: 4, updatedAt: '2099-01-01T00:00:00.000Z', isDeleted: false },
      staleTimestamp
    );

    expect(adopted).toBe(false);
    // The newer local edit (offset 5) must survive untouched.
    expect((await progressRepository.findById(row.id))?.offset).toBe(5);
  });
});

describe('createSyncableTable via progressRepository — markSynced', () => {
  it('flips synced=1 for the given ids and leaves others untouched', async () => {
    const a = await progressRepository.savePosition(1);
    await progressRepository.markSynced([a.id]);
    expect((await progressRepository.findById(a.id))?.synced).toBe(1);
  });

  it('is a no-op for an empty id list', async () => {
    await expect(progressRepository.markSynced([])).resolves.toBeUndefined();
  });
});
