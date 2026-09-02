// Owner: Reader (Ahana).
//
// WHY THIS FILE IS IN reader/ AND NOT personalization/: it does not test Reader code. It tests the
// guarantee Reader's six highlight/bookmark call-sites depend on and cannot themselves provide —
// that saving an annotation persists it SOMEWHERE durable.
//
// THE GUARANTEE: `readerHighlights.ts` / `readerBookmarks.ts` write straight to the offline store
// (`highlightStore`/`bookmarkStore` -> `syncableTable.saveLocal`, which persists a `synced: 0` SQLite
// row AND enqueues the outbox in one transaction), then nudge a sync (`pushNow`). So a write survives
// locally whatever the network is doing, and the sync engine pushes it on the next drain. There is no
// branch that reaches the backend without first writing SQLite — which is exactly what a short-lived
// online-vs-offline router once did, losing an online-but-unreachable write entirely (see git history:
// the `annotationsRouter.ts` era, reverted). This file pins that the local-first path is back.
//
// HOW THIS IS TESTED: the REAL stores run against the REAL SQLite engine (sql.js, via the root
// `__mocks__/expo-sqlite.js` — the same engine `localDb/database.test.ts` uses), so every assertion
// below reads the row and the outbox entry the write actually produced, not a spy on a mocked store.
// That is what makes "durable" a claim this file can prove rather than assert: a facade that POSTed to
// the backend first and threw would leave NO row here, and the "persists a row" checks would fail.
//
// The ONLY thing mocked is `syncEngine` — the single network seam. Mocking it (a) stops `pushNow`'s
// nudge from making a real request and (b) prevents `syncEngine.ts`'s module-load `setSyncRunner`
// registration, so `saveLocal`'s own `requestSync()` stays an inert no-op too. Nothing else is faked:
// the durability guarantee is precisely "the local write is complete before, and independent of, any
// sync", so the store and the DB under it must be real for the test to mean anything.

import {
  addCurrentEpubBookmark,
  loadBookmarks,
  renameBookmark,
} from '@/features/personalization/readerBookmarks';
import {
  addEpubHighlight,
  loadReaderHighlights,
  removeHighlight,
} from '@/features/personalization/readerHighlights';
import { getDatabase } from '@/features/sync/localDb/database';
import type { BookmarkRow, HighlightRow, OutboxRow } from '@/features/sync/localDb/types';
import { syncEngine } from '@/features/sync/syncEngine';

// The one network seam. Mocked so `pushNow` makes no request and `syncEngine.ts` never registers its
// sync runner — see the header for why that is the whole point rather than a convenience.
jest.mock('@/features/sync/syncEngine', () => ({ syncEngine: { run: jest.fn() } }));

const run = syncEngine.run as jest.Mock;

const BOOK = 'book-under-test';
const START_CFI = 'epubcfi(/6/4[chap01]!/4/2/2/1:0)';
const END_CFI = 'epubcfi(/6/4[chap01]!/4/2/6/1:10)';

async function highlightRows(): Promise<HighlightRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<HighlightRow>('SELECT * FROM highlights WHERE book_id = ?', [BOOK]);
}

async function bookmarkRows(): Promise<BookmarkRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<BookmarkRow>('SELECT * FROM bookmarks WHERE book_id = ?', [BOOK]);
}

async function outboxFor(entityId: string): Promise<OutboxRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<OutboxRow>('SELECT * FROM outbox WHERE entity_id = ?', [entityId]);
}

beforeEach(async () => {
  jest.clearAllMocks();
  // sql.js keeps one in-memory DB for the whole file (the cached `getDatabase()` promise), so rows
  // accumulate across `it`s unless cleared — same reset the sibling store tests do.
  const db = await getDatabase();
  await db.execAsync('DELETE FROM highlights; DELETE FROM bookmarks; DELETE FROM outbox;');
});

describe('annotation writes always reach the durable store', () => {
  it('a highlight add persists an unsynced row AND enqueues its outbox in one write, then returns the fresh set', async () => {
    const result = await addEpubHighlight(BOOK, START_CFI, END_CFI, 'yellow');

    // The row is on disk, marked unsynced (synced: 0) and live (is_deleted: 0).
    const rows = await highlightRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].synced).toBe(0);
    expect(rows[0].is_deleted).toBe(0);

    // The outbox entry was written in the SAME transaction — a CREATE, still PENDING (nothing has
    // acknowledged it, because the sync engine is inert). This is the pairing the guarantee rests on.
    const outbox = await outboxFor(rows[0].id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity_type: 'highlights',
      operation: 'CREATE',
      status: 'PENDING',
    });

    // The facade returns the fresh, format-free paint set for the caller to re-send.
    expect(result.skippedIds).toEqual([]);
    expect(result.highlights.pdf).toEqual([]);
    expect(result.highlights.epub).toEqual([
      { id: rows[0].id, startCfi: START_CFI, endCfi: END_CFI, color: 'yellow' },
    ]);

    // The sync was nudged — but the durable state above already exists regardless of it.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the write is durable WITHOUT the sync engine — the row and its PENDING outbox stand on their own', async () => {
    await addEpubHighlight(BOOK, START_CFI, END_CFI);

    // `run` is mocked, so nothing ever drains the outbox. A real successful push would `markSynced`
    // the row and `remove` the outbox entry; neither happened, which is exactly the point — the save
    // does not depend on the network to be complete and recoverable.
    const rows = await highlightRows();
    expect(rows[0].synced).toBe(0);
    const outbox = await outboxFor(rows[0].id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].status).toBe('PENDING');
  });

  it('a highlight load reads back exactly what was written to the durable store', async () => {
    // Nothing stored yet → empty snapshot.
    await expect(loadReaderHighlights(BOOK)).resolves.toEqual({
      highlights: { epub: [], pdf: [] },
      skippedIds: [],
    });

    await addEpubHighlight(BOOK, START_CFI, END_CFI, 'yellow');

    const loaded = await loadReaderHighlights(BOOK);
    expect(loaded.skippedIds).toEqual([]);
    expect(loaded.highlights.epub).toEqual([
      expect.objectContaining({ startCfi: START_CFI, endCfi: END_CFI, color: 'yellow' }),
    ]);
  });

  it('a highlight delete tombstones the row and queues a DELETE — it does not hard-delete', async () => {
    await addEpubHighlight(BOOK, START_CFI, END_CFI);
    const [created] = await highlightRows();

    const result = await removeHighlight(BOOK, created.id);

    // Soft delete: the row SURVIVES so the delete can propagate, now flagged deleted and unsynced.
    const rows = await highlightRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].is_deleted).toBe(1);
    expect(rows[0].synced).toBe(0);

    // A DELETE op is queued for the same id (superseding the earlier CREATE — the outbox coalesces
    // per record), and the fresh set no longer contains it.
    const outbox = await outboxFor(created.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe('DELETE');
    expect(result.highlights.epub).toEqual([]);
  });

  it('a bookmark add persists an unsynced row AND enqueues its outbox in one write', async () => {
    const result = await addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'A label');

    const rows = await bookmarkRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].synced).toBe(0);
    expect(rows[0].is_deleted).toBe(0);

    const outbox = await outboxFor(rows[0].id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity_type: 'bookmarks',
      operation: 'CREATE',
      status: 'PENDING',
    });

    expect(result.skippedIds).toEqual([]);
    expect(result.bookmarks).toEqual([
      expect.objectContaining({ id: rows[0].id, label: 'A label' }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a bookmark rename updates the SAME row in place and queues ONE UPDATE — it does not delete', async () => {
    // Regression for "Save deletes the bookmark": the reader once renamed by re-adding at the same
    // target then deleting the old id, but `bookmarkStore.add` dedups on locator, so the re-add
    // returned the existing row unchanged (new name dropped) and the follow-up delete removed it.
    // The real update-in-place op must keep the row alive with the new name and never tombstone it.
    await addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'Old name');
    const [created] = await bookmarkRows();

    const result = await renameBookmark(BOOK, created.id, 'New name');

    // Same row, still live, name changed — NOT a new id, NOT a tombstone.
    const rows = await bookmarkRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].is_deleted).toBe(0);
    expect(rows[0].name).toBe('New name');

    // Exactly one queued op for this row, and it is an UPDATE — the CREATE was coalesced, and
    // crucially there is NO DELETE. A rename that emitted a DELETE is the bug this pins.
    const outbox = await outboxFor(created.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe('UPDATE');

    expect(result.bookmarks).toEqual([expect.objectContaining({ id: created.id, label: 'New name' })]);
  });

  it('a bookmark load reads back the durable snapshot', async () => {
    await expect(loadBookmarks(BOOK)).resolves.toEqual({ bookmarks: [], skippedIds: [] });

    await addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'A label');

    const loaded = await loadBookmarks(BOOK);
    expect(loaded.skippedIds).toEqual([]);
    expect(loaded.bookmarks).toEqual([expect.objectContaining({ label: 'A label' })]);
  });
});
