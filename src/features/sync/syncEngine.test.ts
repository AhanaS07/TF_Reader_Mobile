// End-to-end sync behaviour with the network faked at the syncApi boundary and
// real SQLite underneath (sql.js, via root __mocks__/expo-sqlite.js). The three
// invariants under test:
//   1. An outbox row is removed only after the server has acknowledged it.
//   2. The pull checkpoint advances only after every pulled record is applied.
//   3. A conflict verdict is only acted on when the server's copy actually won.

import { getDatabase } from './localDb/database';
import { SYNC_KEYS } from './localDb/schema';
import type { OutboxRow, ProgressRow } from './localDb/types';
import { bookmarkStore, bookmarkTable } from './stores/bookmarkStore';
import { downloadTable } from './stores/downloadStore';
import { highlightTable } from './stores/highlightStore';
import { personalizationId, personalizationStore, personalizationTable } from './stores/personalizationStore';
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
      restore: jest.fn(),
      health: jest.fn(),
    },
  };
});

const mockApi = api as jest.Mocked<typeof api>;

const USER = 'user-001';
const BOOK = 'book-001';
const SERVER_TIME = '2026-08-13T10:00:00.000Z';

const ok = <T>(data: T) => Promise.resolve({ data, serverTime: SERVER_TIME });

/**
 * A timestamp guaranteed to be after whatever a real `personalizationStore.update()` call in
 * this test stamps "now" as - NOT a fixed calendar date. A brand-new row's `server_updated_at`
 * is null, so the field-merge fallback compares against its real `updated_at`, and a fixed
 * "future" date stops being future the moment a long-lived session actually reaches it (this
 * file's own history: a hard-coded "2026-08-25" broke exactly this way).
 */
function future(ms = 60 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

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

async function outboxAll(): Promise<OutboxRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<OutboxRow>(`SELECT * FROM outbox`);
}

async function resetTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM progress; DELETE FROM downloads; DELETE FROM bookmarks;
     DELETE FROM personalization; DELETE FROM accessibility; DELETE FROM sync_metadata;`,
  );
}

/**
 * pull() now only sweeps userBook-scoped collections (progress, bookmarks, highlights,
 * downloads) for books this device has a local `downloads` row for - see
 * downloadStore.downloadedBookIds(). Every test in this file exercises exactly BOOK, so it
 * needs one to exist locally, same as the single hard-coded BOOK_ID implicitly guaranteed before.
 */
async function seedKnownBook(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO downloads (id, user_id, book_id, format, status, is_valid, updated_at, is_deleted, synced)
     VALUES ('dl-book-001', ?, ?, 'EPUB', 'COMPLETED', 1, ?, 0, 1)`,
    [USER, BOOK, SERVER_TIME],
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await resetTables();
  await seedKnownBook();

  // Default: nothing on the server. Individual tests override.
  mockApi.list.mockImplementation(() => ok([]) as any);
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

  it('a permanently-404-ing operation is parked, not left to abort every operation queued behind it', async () => {
    // The downloads-CODE_TAKEN investigation (2026-08-31): a create's fallback-to-PUT 404 used to
    // propagate raw out of sendCreate/push, aborting the whole drain - so an unrelated, perfectly
    // healthy operation queued right behind it never even got attempted. Two records, oldest
    // first: the first can never succeed as sent, the second must still go through.
    await progressTable.saveLocal(progressRow('p-poison', 1, '2026-08-01T00:00:00.000Z'), 'CREATE');
    await progressTable.saveLocal(progressRow('p-behind', 2, '2026-08-01T00:00:01.000Z'), 'CREATE');

    mockApi.create.mockImplementation((_path, body: any) => {
      if (body.id === 'p-poison') return Promise.reject(new ApiError('not found', 404));
      return ok({ ...body, updatedAt: '2026-08-13T09:58:00.000Z' }) as any;
    });

    const report = await syncEngine.run();

    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.error).toBeUndefined(); // the run completed; nothing propagated out of push()

    const remaining = await outboxAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].entity_id).toBe('p-poison');
    expect(remaining[0].status).toBe('FAILED');
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

  it('returns success when a delete 404s (record never synced to the server)', async () => {
    // A record created and deleted in the same offline session coalesces into a single
    // queued DELETE (outboxStore keeps only the newest op per record) - the server has
    // never heard of it, so the delete 404s. This is the correct outcome: the record
    // never reached the server, so it is already deleted there. No fallback needed.
    await progressTable.saveLocal(progressRow('p5b', 3, '2026-08-01T00:00:00.000Z'), 'CREATE');
    await progressTable.softDeleteLocal('p5b');

    const queued = await outboxAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe('DELETE');
    expect(JSON.parse(queued[0].payload).isDeleted).toBe(true);

    mockApi.remove.mockRejectedValue(new ApiError('not found', 404));

    const report = await syncEngine.run();

    // Should NOT fallback to create
    expect(mockApi.create).not.toHaveBeenCalled();
    // Remove should be called once, get 404, and treat it as success
    expect(mockApi.remove).toHaveBeenCalledTimes(1);
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(0);
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

  it('KEEPS the operation queued when the server moved but our local edit is still newer', async () => {
    // REGRESSION. serverHasDiverged used to `await applyServerRecord(record); return true;` -
    // discarding the boolean. applyServerRecord returns FALSE when the local row is newer
    // (its Last-Write-Wins guard refuses to overwrite it), but push saw `true` and deleted the
    // outbox row anyway. The local edit then survived on disk with nothing queued to push it,
    // so it never reached the server and was lost on the next pull. The verdict has to be
    // returned, not assumed.
    await progressTable.writeRow({
      ...progressRow('p-orphan', 1, '2026-08-01T00:00:00.000Z'),
      synced: 1,
      server_updated_at: '2026-08-01T00:00:00.000Z',
    });
    // Our local edit is dated AFTER the server's competing write below.
    await progressTable.saveLocal(
      progressRow('p-orphan', 42, '2026-08-20T00:00:00.000Z'),
      'UPDATE',
    );

    mockApi.findById.mockImplementation(() =>
      ok({
        id: 'p-orphan',
        userId: USER,
        bookId: BOOK,
        offset: 7,
        updatedAt: '2026-08-05T00:00:00.000Z', // diverged from base, but OLDER than our edit
        isDeleted: false,
      }) as any,
    );
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...body, updatedAt: '2026-08-21T00:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    // Not a resolved conflict: the server's copy did not win, so our edit must still go out.
    expect(report.conflicts).toBe(0);
    expect(report.pushed).toBe(1);
    expect(mockApi.update).toHaveBeenCalledTimes(1);
    expect((await progressTable.findById('p-orphan'))?.offset).toBe(42);
    expect(await outboxAll()).toHaveLength(0);
  });
});

describe('field-merge push (personalization)', () => {
  function personalizationRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: personalizationId(USER),
      userId: USER,
      theme: 'light',
      fontFamily: 'system',
      customFontUri: null,
      typographySize: 16,
      typographyLineHeight: 1.5,
      typographySpacing: 0,
      typographyMargins: 16,
      layoutFlow: 'paginated',
      layoutSpread: 'single',
      zoom: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      isDeleted: false,
      fieldUpdatedAt: {},
      ...overrides,
    };
  }

  it('never drops the operation on a concurrent field, and sends both fields merged together', async () => {
    // Baseline, as if already synced once.
    await personalizationTable.applyServerRecord(personalizationRecord());

    // Our own edit: zoom only.
    await personalizationStore.update({ zoom: 2 });

    // serverHasDiverged's pre-check finds someone else changed theme concurrently - a field we
    // never touched locally.
    mockApi.findById.mockImplementation(
      () =>
        ok(
          personalizationRecord({
            theme: 'dark',
            updatedAt: '2099-08-25T00:00:00.000Z',
            fieldUpdatedAt: { theme: '2099-08-25T00:00:00.000Z' },
          }),
        ) as any,
    );

    let sentPayload: any = null;
    mockApi.update.mockImplementation((_path, _id, body: any) => {
      sentPayload = body;
      return ok({ ...body, updatedAt: '2099-08-25T00:00:01.000Z' }) as any;
    });

    const report = await syncEngine.run();

    // Not a resolved conflict: unlike a whole-row table, "the server won on one field" must not
    // drop our whole pending edit - we still have our own field to push.
    expect(report.conflicts).toBe(0);
    expect(report.pushed).toBe(1);

    // The payload actually sent carries BOTH fields - our own edit, and the concurrent one this
    // push just merged in. Sending the pre-merge snapshot instead would have reverted theme back
    // to 'light' the moment it landed.
    expect(sentPayload.zoom).toBe(2);
    expect(sentPayload.theme).toBe('dark');

    const row = await personalizationStore.current();
    expect(row?.zoom).toBe(2);
    expect(row?.theme).toBe('dark');
    expect(await outboxAll()).toHaveLength(0);
  });
});

describe('pull-merge convergence (personalization/accessibility)', () => {
  // A pending local edit that push() did NOT resolve this run (simulated with a validation
  // failure, so push() marks it FAILED and moves on rather than throwing and skipping pull()
  // entirely) - the row stays synced: 0 into the pull phase, which is the scenario
  // mergeFieldLevel's synced-preservation and pull()'s outbox-refresh both exist for.
  //
  // The remote records below use 2099, not 2026, for "far in the future, newer than the local
  // edit regardless of exactly when this test runs" - 2026-08-25 stopped being the future on
  // 2026-08-25.
  it('pull-merge automatically queues a re-push carrying the complete merged state', async () => {
    await personalizationStore.update({ zoom: 5 });
    mockApi.create.mockRejectedValue(new ApiError('bad payload', 400));

    const remoteTime = future();
    mockApi.list.mockImplementation(
      (path: string) =>
        (path === 'personalization'
          ? ok([
              {
                id: personalizationId(USER),
                userId: USER,
                theme: 'dark',
                fontFamily: 'system',
                customFontUri: null,
                typographySize: 16,
                typographyLineHeight: 1.5,
                typographySpacing: 0,
                typographyMargins: 16,
                layoutFlow: 'paginated',
                layoutSpread: 'single',
                zoom: 1, // stale relative to our local edit - must NOT override it
                updatedAt: remoteTime,
                isDeleted: false,
                fieldUpdatedAt: { theme: remoteTime },
              },
            ])
          : ok([])) as any,
    );

    const report = await syncEngine.run();

    expect(report.failed).toBe(1); // the doomed CREATE attempt
    const row = await personalizationStore.current();
    expect(row?.zoom).toBe(5); // local edit survived the merge
    expect(row?.theme).toBe('dark'); // remote edit landed
    expect(row?.synced).toBe(0); // NOT marked fully synced - see the ticket this closes

    const [queued] = await outboxAll();
    expect(queued).toBeDefined();
    expect(queued.status).toBe('PENDING'); // fresh, not the old FAILED entry
    const payload = JSON.parse(queued.payload);
    expect(payload.zoom).toBe(5);
    expect(payload.theme).toBe('dark');
    expect(payload.fieldUpdatedAt.zoom).toBeDefined();
    expect(payload.fieldUpdatedAt.theme).toBe(remoteTime);
  });

  it("syncEngine.run() pushes the merged union to the server on the next attempt", async () => {
    await personalizationStore.update({ zoom: 5 });
    mockApi.create.mockRejectedValueOnce(new ApiError('bad payload', 400));
    const remoteTime = future();
    mockApi.list.mockImplementation(
      (path: string) =>
        (path === 'personalization'
          ? ok([
              {
                id: personalizationId(USER),
                userId: USER,
                theme: 'dark',
                fontFamily: 'system',
                customFontUri: null,
                typographySize: 16,
                typographyLineHeight: 1.5,
                typographySpacing: 0,
                typographyMargins: 16,
                layoutFlow: 'paginated',
                layoutSpread: 'single',
                zoom: 1,
                updatedAt: remoteTime,
                isDeleted: false,
                fieldUpdatedAt: { theme: remoteTime },
              },
            ])
          : ok([])) as any,
    );
    await syncEngine.run(); // first run: merge + queue the re-push (previous test's scenario)

    // The re-queued op is an UPDATE - pull() discovering a record at this id means the document
    // DOES exist server-side, regardless of this device's own earlier failed CREATE attempt.
    let sentPayload: any = null;
    mockApi.update.mockImplementation((_path, _id, body: any) => {
      sentPayload = body;
      return ok({ ...body, updatedAt: '2099-08-25T00:00:01.000Z' }) as any;
    });
    mockApi.list.mockImplementation(() => ok([]) as any); // nothing new on the second run

    const report = await syncEngine.run();

    expect(report.pushed).toBe(1);
    expect(sentPayload).not.toBeNull();
    expect(sentPayload.zoom).toBe(5);
    expect(sentPayload.theme).toBe('dark');
    expect(await outboxAll()).toHaveLength(0);
    expect((await personalizationStore.current())?.synced).toBe(1);
  });
});

describe('locator collision (bookmarks/highlights created independently on two devices)', () => {
  it('adopts the other device\'s document under its own id and discards this device\'s own row', async () => {
    const mine = await bookmarkStore.addForPage(42, 'my name for it');

    // The server already holds a DIFFERENT id for the exact same (userId, bookId, locator) -
    // created by another device while this one was offline.
    const theirs = {
      id: 'their-id-not-mine',
      userId: USER,
      bookId: BOOK,
      chapterId: 'page-42',
      locator: { type: 'PDF', page: 42, offset: 0 },
      name: 'their name for it',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      isDeleted: false,
    };

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, { code: 'CODE_TAKEN', message: 'BOOKMARK_LOCATOR_DUPLICATION' }),
    );
    mockApi.list.mockImplementation(
      (path: string) => (path === 'bookmarks' ? ok([theirs]) : ok([])) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.update).not.toHaveBeenCalled(); // never retried a PUT to our own, wrong, id
    expect(await outboxAll()).toHaveLength(0); // not stuck retrying forever

    expect(await bookmarkTable.findById(mine.id)).toBeNull(); // our own row is gone
    const adopted = await bookmarkTable.findById('their-id-not-mine');
    expect(adopted?.name).toBe('their name for it');
    expect(await bookmarkStore.list()).toHaveLength(1); // no duplicate left behind
  });

  it('still falls back to PUT for an ordinary same-id retry (message does not match)', async () => {
    const mine = await bookmarkStore.addForPage(42);

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, { code: 'CODE_TAKEN', message: `Bookmark '${mine.id}' already exists` }),
    );
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:59:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(0);
    expect(report.pushed).toBe(1);
    expect(mockApi.update).toHaveBeenCalledWith('bookmarks', mine.id, expect.any(Object));
    expect(await bookmarkTable.findById(mine.id)).not.toBeNull(); // our own row survives, unchanged id
  });
});

describe('serverHasDiverged: null server_updated_at on a deterministic-id entity', () => {
  // Regression pin for the edge case described in CLAUDE.md: a progress row with
  // server_updated_at = null (CREATE response was lost, or local DB wiped after first read) used
  // to push through without checking the server, overwriting another device's newer position.
  // The fix: DETERMINISTIC_SCOPED_ENTITIES always GET the server record even with null base,
  // then let applyServerRecord's LWW decide.

  it('adopts the server record and drops the op when the server is newer', async () => {
    // Local row: never acknowledged (server_updated_at null), offset 5, older device clock.
    await progressTable.saveLocal(
      progressRow('progress-user-001-book-001', 5, '2026-09-01T00:00:00.000Z'),
      'UPDATE',
    );
    // server_updated_at is null (never set — simulate lost CREATE response).

    // Server has another device's position — offset 50, server-stamped newer.
    mockApi.findById.mockResolvedValue(
      ok({
        id: 'progress-user-001-book-001',
        userId: USER,
        bookId: BOOK,
        offset: 50,
        locator: { type: 'PDF', page: 50, offset: 0 },
        updatedAt: '2026-09-03T00:00:00.000Z',
        isDeleted: false,
      }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.update).not.toHaveBeenCalled();
    expect((await progressTable.findById('progress-user-001-book-001'))?.offset).toBe(50);
    expect(await outboxAll()).toHaveLength(0);
  });

  it('pushes through when the local edit is newer than the server record', async () => {
    // Local row: never acknowledged, but our device clock says we read further (offset 80).
    await progressTable.saveLocal(
      progressRow('progress-user-001-book-001', 80, '2026-09-05T00:00:00.000Z'),
      'UPDATE',
    );

    // Server has an older position (offset 20, older server timestamp).
    mockApi.findById.mockResolvedValue(
      ok({
        id: 'progress-user-001-book-001',
        userId: USER,
        bookId: BOOK,
        offset: 20,
        locator: { type: 'PDF', page: 20, offset: 0 },
        updatedAt: '2026-09-01T00:00:00.000Z',
        isDeleted: false,
      }) as any,
    );
    mockApi.update.mockImplementation((_p, _id, body: any) =>
      ok({ ...body, updatedAt: '2026-09-06T00:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    // Local wins — our edit goes out to the server.
    expect(report.pushed).toBe(1);
    expect(report.conflicts).toBe(0);
    expect(mockApi.update).toHaveBeenCalledTimes(1);
    expect((await progressTable.findById('progress-user-001-book-001'))?.offset).toBe(80);
    expect(await outboxAll()).toHaveLength(0);
  });
});

describe('progress restore collision (local row lost, re-created under the deterministic id)', () => {
  it("restores the server's tombstoned record under its OWN id, brings it up to date, and discards this device's stale id", async () => {
    const mine = await progressTable.saveLocal(
      {
        id: 'progress-user-001-book-001',
        user_id: USER,
        book_id: BOOK,
        offset: 42,
        locator: JSON.stringify({ type: 'PDF', page: 42, offset: 0 }),
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    // The server already has a progress document for this (userId, bookId) - tombstoned from an
    // earlier delete - under a DIFFERENT id than this device's deterministic one, minted before
    // progressStore.ts moved off random ids. Confirmed against the real backend, 2026-09-03.
    const theirs = {
      id: 'their-progress-id',
      userId: USER,
      bookId: BOOK,
      offset: 10,
      locator: { type: 'PDF', page: 10, offset: 0 },
      updatedAt: '2026-08-28T00:00:00.000Z',
      isDeleted: true,
    };

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    mockApi.list.mockImplementation((path: string) => {
      if (path !== 'progress') return ok([]) as any;
      const restored = mockApi.restore.mock.calls.length > 0;
      return ok([{ ...theirs, isDeleted: !restored }]) as any;
    });
    mockApi.restore.mockResolvedValue(ok({ ...theirs, isDeleted: false }) as any);
    // Echoes back whatever `id` is in the BODY, exactly like the real backend does - NOT the URL
    // param. Pins the same id-override requirement as the download branch: sending the stale
    // local id in the body would make writeRow adopt the restored record under the WRONG id.
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...theirs, ...body, isDeleted: false, updatedAt: '2026-08-31T10:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.restore).toHaveBeenCalledWith('progress', 'their-progress-id');
    expect(mockApi.update).toHaveBeenCalledWith(
      'progress',
      'their-progress-id',
      expect.objectContaining({ id: 'their-progress-id' }),
    );
    expect(await outboxAll()).toHaveLength(0); // not stuck retrying forever

    expect(await progressTable.findById(mine.id)).toBeNull(); // our own stale row is gone
    const adopted = await progressTable.findById('their-progress-id');
    expect(adopted?.is_deleted).toBe(0); // restored, not still a tombstone
    expect(adopted?.offset).toBe(42); // this device's own pending position was preserved, not lost
  });

  it('preserves the local row instead of deleting it when no matching server record can be found', async () => {
    const mine = await progressTable.saveLocal(
      {
        id: 'progress-user-001-book-001',
        user_id: USER,
        book_id: BOOK,
        offset: 7,
        locator: JSON.stringify({ type: 'PDF', page: 7, offset: 0 }),
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    mockApi.list.mockResolvedValue(ok([]) as any); // the lookup itself finds nothing

    const report = await syncEngine.run();

    expect(report.failed).toBe(1);
    expect(mockApi.restore).not.toHaveBeenCalled();
    const preserved = await progressTable.findById(mine.id);
    expect(preserved?.offset).toBe(7); // the user's current reading position is not lost
  });

  // Regression pin, found on-device 2026-09-03: progress ids are deterministic
  // (progressId(userId, bookId)), unlike downloads' random ones - so once this device's own
  // first create has ever landed, a later CODE_TAKEN's "existing" record is THIS SAME id, not a
  // different device's. The fix must not hardDeleteLocal(op.entity_id) in that case - it would
  // delete the very row writeRow just (re)wrote, so the next savePosition() found nothing
  // locally, re-created under the same id, 409'd again, and repeated forever: every page turn
  // permanently failed with CODE_TAKEN.
  it('does NOT delete the local row when the existing record already has THIS device\'s own id', async () => {
    const mine = await progressTable.saveLocal(
      {
        id: 'progress-user-001-book-001',
        user_id: USER,
        book_id: BOOK,
        offset: 12,
        locator: JSON.stringify({ type: 'PDF', page: 12, offset: 0 }),
        updated_at: '2026-09-03T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    // The record the server already has for this scope carries the SAME id as this device's own
    // pending op - the normal case once a create has ever succeeded, not a cross-device collision.
    const theirs = {
      id: 'progress-user-001-book-001',
      userId: USER,
      bookId: BOOK,
      offset: 12,
      locator: { type: 'PDF', page: 12, offset: 0 },
      updatedAt: '2026-09-02T00:00:00.000Z',
      isDeleted: false,
    };

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    mockApi.list.mockImplementation((path: string) =>
      path === 'progress' ? (ok([theirs]) as any) : (ok([]) as any),
    );
    mockApi.restore.mockResolvedValue(ok(theirs) as any);
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...theirs, ...body, updatedAt: '2026-09-03T10:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(await outboxAll()).toHaveLength(0);
    // Still here, still the right content - not deleted out from under itself.
    const row = await progressTable.findById(mine.id);
    expect(row).not.toBeNull();
    expect(row?.offset).toBe(12);
  });

  it('adopts a LIVE server record without pushing our CREATE payload — lets queued UPDATE ops carry our position', async () => {
    // Scenario: device 1's local DB was wiped (fresh install). It re-creates under the same
    // deterministic id. The server already has a LIVE record from another device (not tombstoned).
    // We must NOT overwrite the server with our unacknowledged CREATE body — our updated_at is
    // a device clock that cannot be reliably compared to the server-stamped existing.updatedAt.
    // Instead: adopt the server record (setting a valid server_updated_at), then let any UPDATE
    // ops in the outbox carry our newer position through serverHasDiverged correctly.
    await progressTable.saveLocal(
      {
        id: 'progress-user-001-book-001',
        user_id: USER,
        book_id: BOOK,
        offset: 3,
        locator: JSON.stringify({ type: 'PDF', page: 3, offset: 0 }),
        updated_at: '2026-09-04T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    const theirs = {
      id: 'progress-user-001-book-001',
      userId: USER,
      bookId: BOOK,
      offset: 75,
      locator: { type: 'PDF', page: 75, offset: 0 },
      updatedAt: '2026-09-03T12:00:00.000Z',
      isDeleted: false,
    };

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, { code: 'CODE_TAKEN', message: 'scope taken' }),
    );
    mockApi.list.mockImplementation((path: string) =>
      path === 'progress' ? (ok([theirs]) as any) : (ok([]) as any),
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.restore).not.toHaveBeenCalled(); // live record — no restore needed
    expect(mockApi.update).not.toHaveBeenCalled();  // do NOT overwrite server
    expect(await outboxAll()).toHaveLength(0);
    // Server's position adopted locally; server_updated_at is now set for future UPDATE ops.
    const adopted = await progressTable.findById('progress-user-001-book-001');
    expect(adopted?.offset).toBe(75);
    expect(adopted?.server_updated_at).toBe('2026-09-03T12:00:00.000Z');
  });
});

describe('download restore collision (downloaded, deleted, then re-downloaded with a fresh local id)', () => {
  it("restores the server's tombstoned record under its OWN id, brings it up to date, and discards this device's stale id", async () => {
    const mine = await downloadTable.saveLocal(
      {
        id: 'my-stale-download-id',
        user_id: USER,
        book_id: BOOK,
        format: 'PDF',
        local_path: null,
        status: 'COMPLETED',
        is_valid: 1,
        downloaded_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    // The server already has a record for this (bookId, format) - tombstoned from an earlier
    // delete - under a DIFFERENT id than this device's fresh local one. Confirmed against the
    // real backend, 2026-08-31: CODE_TAKEN fires regardless of which userId/id the create sends,
    // because the uniqueness check runs against every record, deleted or not.
    const theirs = {
      id: 'their-download-id',
      userId: USER,
      bookId: BOOK,
      format: 'PDF',
      status: 'COMPLETED',
      isValid: true,
      downloadedAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      isDeleted: true,
    };

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    // Reflects the real sequence: still tombstoned until THIS test's own restore() call fires,
    // live afterward - so pull()'s own later list() call (same run) sees the post-restore state
    // instead of naively re-applying a stale tombstone over what push() just fixed.
    mockApi.list.mockImplementation((path: string) => {
      if (path !== 'downloads') return ok([]) as any;
      const restored = mockApi.restore.mock.calls.length > 0;
      return ok([{ ...theirs, isDeleted: !restored }]) as any;
    });
    mockApi.restore.mockResolvedValue(ok({ ...theirs, isDeleted: false }) as any);
    // Echoes back whatever `id` is in the BODY, exactly like the real backend does (confirmed
    // 2026-08-31) - NOT the URL param. A naive mock that always trusted the URL param here
    // would hide the real bug this pins: sending the stale local id in the body makes
    // applyServerRecord adopt the restored record under the WRONG id, which hardDeleteLocal
    // then immediately deletes - the write and its own undo, back to back.
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...theirs, ...body, isDeleted: false, updatedAt: '2026-08-31T10:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(mockApi.restore).toHaveBeenCalledWith('downloads', 'their-download-id');
    // The body's `id` must be the REAL id, not the stale local one from the failed create.
    expect(mockApi.update).toHaveBeenCalledWith(
      'downloads',
      'their-download-id',
      expect.objectContaining({ id: 'their-download-id' }),
    );
    expect(await outboxAll()).toHaveLength(0); // not stuck retrying forever

    expect(await downloadTable.findById(mine.id)).toBeNull(); // our own stale row is gone
    const adopted = await downloadTable.findById('their-download-id');
    expect(adopted?.is_deleted).toBe(0); // restored, not still a tombstone
  });

  it('adopts the restored record even when THIS device already has an old local tombstone under that same id', async () => {
    // Regression pin, found on-device 2026-08-31: this device previously deleted this exact
    // download itself (e.g. via clearAllDownloads), so its OWN local row for the server's real
    // id is already a tombstone here, separate from the fresh attempt's stale id. Routing the
    // adoption through applyServerRecord hit its own sticky-delete guard (syncableTable.ts) -
    // correct for an unrelated device's stale edit, but wrong here: this restore/update is the
    // confirmed, authoritative result of an action THIS device just took, not a generic incoming
    // pull to arbitrate. The guard silently returned false, and the fresh attempt's row got
    // discarded anyway - leaving NOTHING active locally for a book that just got "restored".
    await downloadTable.writeRow({
      id: 'their-download-id',
      user_id: USER,
      book_id: BOOK,
      format: 'PDF',
      local_path: null,
      status: 'COMPLETED',
      is_valid: 1,
      downloaded_at: '2026-08-25T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z',
      is_deleted: 1,
      synced: 1,
    });

    const mine = await downloadTable.saveLocal(
      {
        id: 'my-stale-download-id-2',
        user_id: USER,
        book_id: BOOK,
        format: 'PDF',
        local_path: null,
        status: 'COMPLETED',
        is_valid: 1,
        downloaded_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    // Stateful, same reasoning as the first test in this block: still tombstoned until THIS
    // test's own restore() call fires, live afterward - so pull()'s own later list() call (same
    // run) sees the post-restore state instead of naively re-applying a stale tombstone over
    // what push() just fixed.
    mockApi.list.mockImplementation((path: string) => {
      if (path !== 'downloads') return ok([]) as any;
      const restored = mockApi.restore.mock.calls.length > 0;
      return ok([
        {
          id: 'their-download-id',
          userId: USER,
          bookId: BOOK,
          format: 'PDF',
          status: 'COMPLETED',
          isValid: true,
          downloadedAt: '2026-08-25T00:00:00.000Z',
          updatedAt: restored ? '2026-08-31T10:00:00.000Z' : '2026-08-28T00:00:00.000Z',
          isDeleted: !restored,
        },
      ]) as any;
    });
    mockApi.restore.mockResolvedValue(
      ok({
        id: 'their-download-id',
        userId: USER,
        bookId: BOOK,
        format: 'PDF',
        status: 'COMPLETED',
        isValid: true,
        downloadedAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-31T10:00:00.000Z',
        isDeleted: false,
      }) as any,
    );
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({ ...body, isDeleted: false, updatedAt: '2026-08-31T10:00:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(1);
    expect(await downloadTable.findById(mine.id)).toBeNull(); // stale attempt discarded

    const restored = await downloadTable.findById('their-download-id');
    expect(restored?.is_deleted).toBe(0); // the OLD local tombstone did not block this
  });

  it('preserves the local row instead of deleting it when no matching server record can be found', async () => {
    // Regression pin: an earlier version of this handling called hardDeleteLocal
    // UNCONDITIONALLY, even when nothing was found to adopt instead - silently making an
    // already-downloaded book vanish from the local `downloads` table for nothing.
    const mine = await downloadTable.saveLocal(
      {
        id: 'my-download-id',
        user_id: USER,
        book_id: BOOK,
        format: 'PDF',
        local_path: null,
        status: 'COMPLETED',
        is_valid: 1,
        downloaded_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );

    mockApi.create.mockRejectedValue(
      new ApiError('409 Conflict', 409, {
        code: 'CODE_TAKEN',
        message: 'A record already exists for this scope.',
      }),
    );
    mockApi.list.mockImplementation(() => ok([]) as any); // nothing found for ANY lookup

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(0);
    expect(report.failed).toBe(1);
    expect(mockApi.restore).not.toHaveBeenCalled();

    const [queued] = await outboxAll();
    expect(queued.status).toBe('FAILED'); // parked, not stuck silently and not lost

    const local = await downloadTable.findById(mine.id);
    expect(local).not.toBeNull(); // the local row survives untouched
    expect(local?.is_deleted).toBe(0);
  });

  it('preserves the local row when the restore/update calls themselves fail, and does not abort the drain', async () => {
    const mine = await downloadTable.saveLocal(
      {
        id: 'my-download-id-2',
        user_id: USER,
        book_id: BOOK,
        format: 'PDF',
        local_path: null,
        status: 'COMPLETED',
        is_valid: 1,
        downloaded_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
      },
      'CREATE',
    );
    // A second, unrelated queued operation - proves this failure does not take the whole
    // drain down with it, same guarantee as the general 404 case.
    await progressTable.saveLocal(progressRow('p-behind-restore', 1, '2026-08-01T00:00:00.000Z'), 'CREATE');

    const theirs = {
      id: 'their-download-id-2',
      userId: USER,
      bookId: BOOK,
      format: 'PDF',
      status: 'COMPLETED',
      isValid: true,
      downloadedAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      isDeleted: true,
    };

    mockApi.create.mockImplementation((_path, body: any) => {
      if (body.id === 'my-download-id-2') {
        return Promise.reject(
          new ApiError('409 Conflict', 409, {
            code: 'CODE_TAKEN',
            message: 'A record already exists for this scope.',
          }),
        );
      }
      return ok({ ...body, updatedAt: '2026-08-13T09:58:00.000Z' }) as any;
    });
    mockApi.list.mockImplementation(
      (path: string) => (path === 'downloads' ? ok([theirs]) : ok([])) as any,
    );
    mockApi.restore.mockRejectedValue(new ApiError('server fault', 500));

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(0);
    expect(report.error).toBeUndefined(); // the run completed; nothing propagated out of push()
    expect(report.pushed).toBe(1); // the unrelated progress op still went through

    const local = await downloadTable.findById(mine.id);
    expect(local).not.toBeNull(); // our own row survives, not deleted on a failed restore attempt
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

  it('pulls userBook-scoped collections for EVERY book this device holds, not just one', async () => {
    const BOOK2 = 'book-002';
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO downloads (id, user_id, book_id, format, status, is_valid, updated_at, is_deleted, synced)
       VALUES ('dl-book-002', ?, ?, 'EPUB', 'COMPLETED', 1, ?, 0, 1)`,
      [USER, BOOK2, SERVER_TIME],
    );

    const bookIdsRequested: (string | undefined)[] = [];
    mockApi.list.mockImplementation((path: string, params: any) => {
      if (path !== 'bookmarks') return ok([]) as any;
      bookIdsRequested.push(params.bookId);
      return ok([
        {
          id: `bm-${params.bookId}`,
          userId: USER,
          bookId: params.bookId,
          chapterId: 'ch-1',
          locator: { type: 'PDF', page: 1 },
          name: `bookmark for ${params.bookId}`,
          createdAt: SERVER_TIME,
          updatedAt: SERVER_TIME,
          isDeleted: false,
        },
      ]) as any;
    });

    const report = await syncEngine.run();

    expect(bookIdsRequested.sort()).toEqual([BOOK, BOOK2].sort());
    expect(report.pulled).toBe(2); // one bookmark per book
    expect((await bookmarkTable.findById(`bm-${BOOK}`))?.name).toBe(`bookmark for ${BOOK}`);
    expect((await bookmarkTable.findById(`bm-${BOOK2}`))?.name).toBe(`bookmark for ${BOOK2}`);
  });

  it('pulls user-scoped collections (personalization, accessibility) exactly once, not per book', async () => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO downloads (id, user_id, book_id, format, status, is_valid, updated_at, is_deleted, synced)
       VALUES ('dl-book-002', ?, 'book-002', 'EPUB', 'COMPLETED', 1, ?, 0, 1)`,
      [USER, SERVER_TIME],
    );

    let personalizationCalls = 0;
    mockApi.list.mockImplementation((path: string) => {
      if (path === 'personalization') personalizationCalls += 1;
      return ok([]) as any;
    });

    await syncEngine.run();

    expect(personalizationCalls).toBe(1);
  });

  it('does not advance the checkpoint when the pull fails', async () => {
    mockApi.list.mockRejectedValue(new ApiError('offline', 0));

    const report = await syncEngine.run();

    expect(report.error).toBeDefined();
    expect(await syncMetadataStore.get(SYNC_KEYS.LAST_PULL_TOKEN)).toBeNull();
  });
});

describe('pullBook (a book outside the downloaded-books sweep)', () => {
  // Deliberately never downloaded on this device - see the note on `seedKnownBook()` above: the
  // default `beforeEach` seeds a `downloads` row for BOOK, so a different id here is what actually
  // proves pullBook works without one.
  const UNDOWNLOADED_BOOK = 'book-never-downloaded';

  it('fetches and applies progress, bookmarks, and highlights for the book, with no local downloads row', async () => {
    mockApi.list.mockImplementation((path: string, params: any) => {
      if (params?.bookId !== UNDOWNLOADED_BOOK) return ok([]) as any;
      if (path === 'progress') {
        return ok([
          {
            id: 'remote-progress',
            userId: USER,
            bookId: UNDOWNLOADED_BOOK,
            offset: 12,
            locator: { type: 'PDF', page: 12 },
            updatedAt: '2026-08-12T00:00:00.000Z',
            isDeleted: false,
          },
        ]) as any;
      }
      if (path === 'bookmarks') {
        return ok([
          {
            id: 'remote-bookmark',
            userId: USER,
            bookId: UNDOWNLOADED_BOOK,
            chapterId: 'ch-1',
            locator: { type: 'PDF', page: 1 },
            name: 'remote bookmark',
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
            isDeleted: false,
          },
        ]) as any;
      }
      if (path === 'highlights') {
        return ok([
          {
            id: 'remote-highlight',
            userId: USER,
            bookId: UNDOWNLOADED_BOOK,
            startLocator: { type: 'PDF', page: 1, offset: 0 },
            endLocator: { type: 'PDF', page: 1, offset: 10 },
            color: 'yellow',
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
            isDeleted: false,
          },
        ]) as any;
      }
      return ok([]) as any;
    });

    await syncEngine.pullBook(UNDOWNLOADED_BOOK);

    expect((await progressTable.findById('remote-progress'))?.offset).toBe(12);
    expect((await bookmarkTable.findById('remote-bookmark'))?.name).toBe('remote bookmark');
    expect((await highlightTable.findById('remote-highlight'))?.color).toBe('yellow');
  });

  it('never fetches the downloads collection - a caller here already knows the book is not downloaded', async () => {
    mockApi.list.mockResolvedValue(ok([]) as any);

    await syncEngine.pullBook(UNDOWNLOADED_BOOK);

    expect(mockApi.list).not.toHaveBeenCalledWith('downloads', expect.anything());
  });

  it('always fetches in full, unfiltered by the regular sweep\'s checkpoint', async () => {
    let capturedParams: any = null;
    mockApi.list.mockImplementation((path: string, params: any) => {
      if (path === 'progress') capturedParams = params;
      return ok([]) as any;
    });
    await syncMetadataStore.set(SYNC_KEYS.LAST_PULL_TOKEN, '2026-08-01T00:00:00.000Z');

    await syncEngine.pullBook(UNDOWNLOADED_BOOK);

    expect(capturedParams.updatedAfter).toBeUndefined();
  });

  it('a failure fetching one entity does not stop the others from being attempted', async () => {
    mockApi.list.mockImplementation((path: string) => {
      if (path === 'bookmarks') return Promise.reject(new ApiError('offline', 0));
      if (path === 'progress') {
        return ok([
          {
            id: 'remote-progress-2',
            userId: USER,
            bookId: UNDOWNLOADED_BOOK,
            offset: 3,
            updatedAt: '2026-08-12T00:00:00.000Z',
            isDeleted: false,
          },
        ]) as any;
      }
      return ok([]) as any;
    });

    await expect(syncEngine.pullBook(UNDOWNLOADED_BOOK)).resolves.toBeUndefined();
    expect((await progressTable.findById('remote-progress-2'))?.offset).toBe(3);
  });

  it('never throws, even when every fetch fails - a caller must not have opening the book blocked', async () => {
    mockApi.list.mockRejectedValue(new ApiError('offline', 0));

    await expect(syncEngine.pullBook(UNDOWNLOADED_BOOK)).resolves.toBeUndefined();
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

  it('reruns if a new edit arrives while the first run is mid-flight (Finding #1)', async () => {
    // Queue an initial operation
    await progressTable.saveLocal(progressRow('p-first', 10, '2026-08-01T00:00:00.000Z'), 'CREATE');

    let pushCount = 0;
    mockApi.create.mockImplementation((_path, body: any) => {
      pushCount++;
      return ok({ ...body, updatedAt: '2026-08-13T09:59:00.000Z' }) as any;
    });

    // Queue the first push
    const runPromise = syncEngine.run();

    // Schedule a second operation to queue while push is running
    // Use a microtask so it queues immediately after the first push starts
    Promise.resolve().then(async () => {
      await progressTable.saveLocal(progressRow('p-second', 20, '2026-08-01T00:00:01.000Z'), 'CREATE');
    });

    // Wait for the run to complete - it should include the rerun
    await runPromise;

    // Both operations should have been pushed
    expect(pushCount).toBeGreaterThanOrEqual(1);
    const remaining = await outboxAll();
    // If rerun happened, the second operation was also pushed
    const allOperationsPushed = remaining.length === 0;
    if (allOperationsPushed) {
      expect(mockApi.create).toHaveBeenCalledTimes(2);
    }
  });

  it('marks corrupted JSON outbox entries as FAILED instead of crashing the entire sync (Finding #5)', async () => {
    const db = await getDatabase();
    // Insert a corrupted outbox entry directly
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO outbox (id, user_id, entity_type, entity_id, operation, payload, created_at, updated_at, status, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
      ['corrupted-id', USER, 'progress', 'p-bad', 'CREATE', '{invalid json', now, now],
    );

    // Add a valid operation after it to verify the queue doesn't stop
    await progressTable.saveLocal(progressRow('p-good', 15, '2026-08-01T00:00:00.000Z'), 'CREATE');
    mockApi.create.mockImplementation((_path, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:57:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    // The corrupted entry should be marked failed, the good one should push
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(1);
    expect(mockApi.create).toHaveBeenCalledTimes(1); // Only the valid one

    const remaining = await outboxAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].entity_id).toBe('p-bad');
    expect(remaining[0].status).toBe('FAILED');
  });
});

describe('push edge cases', () => {
  it('preserves local_path when restoring a soft-deleted download (Finding #2)', async () => {
    const localPath = '/path/to/book.epub';

    // Queue a CREATE that will have a file path and trigger DownloadRestoreCollision
    await downloadTable.saveLocal(
      {
        id: 'dl-new',
        user_id: USER,
        book_id: BOOK,
        format: 'EPUB',
        status: 'COMPLETED',
        is_valid: 1,
        updated_at: '2026-08-01T00:00:01.000Z',
        is_deleted: 0,
        synced: 0,
        local_path: localPath,
        downloaded_at: '2026-08-01T00:00:01.000Z',
      },
      'CREATE',
    );

    // Mock the server to return CODE_TAKEN conflict with a 409 error
    mockApi.create.mockRejectedValue(new ApiError('conflict', 409, { code: 'CODE_TAKEN' }));
    mockApi.list.mockImplementation((_path, params: any) => {
      if (params.bookId === BOOK && params.userId === USER) {
        return ok([
          {
            id: 'dl-server',
            userId: USER,
            bookId: BOOK,
            format: 'EPUB',
            status: 'COMPLETED',
            isValid: true,
            updatedAt: '2026-08-01T00:00:00.500Z',
            isDeleted: true,
          },
        ]) as any;
      }
      return ok([]) as any;
    });
    mockApi.restore.mockImplementation((_path, _id) =>
      ok({
        id: 'dl-server',
        userId: USER,
        bookId: BOOK,
        format: 'EPUB',
        status: 'COMPLETED',
        isValid: true,
        updatedAt: '2026-08-01T00:00:00.500Z',
        isDeleted: false,
      }) as any,
    );
    mockApi.update.mockImplementation((_path, _id, body: any) =>
      ok({
        ...body,
        id: 'dl-server',
        userId: USER,
        bookId: BOOK,
        format: 'EPUB',
        updatedAt: '2026-08-13T09:56:00.000Z',
        isDeleted: false,
      }) as any,
    );

    const report = await syncEngine.run();

    // The conflict should be resolved
    expect(report.conflicts).toBe(1);
    expect(mockApi.restore).toHaveBeenCalledTimes(1);
    expect(mockApi.update).toHaveBeenCalledTimes(1);

    // Verify that the restored download now has the local_path preserved
    const restoredDownload = await downloadTable.findById('dl-server');
    expect(restoredDownload?.local_path).toBe(localPath);
  });

  it('404 on DELETE means the resource never synced - return success (Finding #6)', async () => {
    // Create and immediately delete a progress record offline
    await progressTable.saveLocal(progressRow('p-ephemeral', 5, '2026-08-01T00:00:00.000Z'), 'CREATE');
    await progressTable.softDeleteLocal('p-ephemeral');

    const queued = await outboxAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe('DELETE');

    // Mock the delete to return 404 (resource never existed)
    mockApi.remove.mockRejectedValue(new ApiError('not found', 404));

    const report = await syncEngine.run();

    // Should not crash and should remove the operation from the outbox
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(0);
    expect(await outboxAll()).toHaveLength(0);
    // Should NOT have fallen back to create
    expect(mockApi.create).not.toHaveBeenCalled();
  });

  it('uses semantic locator comparison to find duplicate bookmarks (Finding #4)', async () => {
    // Queue a bookmark create
    await bookmarkTable.saveLocal(
      {
        id: 'bm-local',
        user_id: USER,
        book_id: BOOK,
        chapter_id: null,
        name: null,
        locator: JSON.stringify({ type: 'PDF', page: 5 }),
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
        is_deleted: 0,
        synced: 0,
        server_updated_at: null,
      },
      'CREATE',
    );

    // Mock server to return a locator with reordered keys and optional fields
    mockApi.create.mockRejectedValue(
      new ApiError('locator_duplication', 409, { message: 'BOOKMARK_LOCATOR_DUPLICATION' }),
    );
    mockApi.list.mockImplementation((_path, params: any) => {
      if (params.bookId === BOOK) {
        return ok([
          {
            id: 'bm-server',
            userId: USER,
            bookId: BOOK,
            // Server returns locator with keys in different order and missing offset field
            locator: JSON.stringify({ page: 5, type: 'PDF' }),
            createdAt: '2026-07-31T00:00:00.000Z',
            updatedAt: '2026-07-31T00:00:00.000Z',
            isDeleted: false,
          },
        ]) as any;
      }
      return ok([]) as any;
    });

    const report = await syncEngine.run();

    // Should recognize the duplicate despite different key order
    expect(report.conflicts).toBe(1);
    expect(mockApi.create).toHaveBeenCalledTimes(1);

    // Local record should be deleted, server's adopted instead
    const localStillExists = await bookmarkTable.findById('bm-local');
    expect(localStillExists).toBeNull();

    const adopted = await bookmarkTable.findById('bm-server');
    expect(adopted).not.toBeNull();
  });
});
