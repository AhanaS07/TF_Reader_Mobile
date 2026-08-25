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

  it('creates then deletes when a coalesced create+delete never reached the server (404 on delete)', async () => {
    // A record created and deleted in the same offline session coalesces into a single
    // queued DELETE (outboxStore keeps only the newest op per record) - the server has
    // never heard of it, so the delete 404s until sendDelete's fallback creates it first.
    await progressTable.saveLocal(progressRow('p5b', 3, '2026-08-01T00:00:00.000Z'), 'CREATE');
    await progressTable.softDeleteLocal('p5b');

    const queued = await outboxAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe('DELETE');
    expect(JSON.parse(queued[0].payload).isDeleted).toBe(true);

    let removeCalls = 0;
    mockApi.remove.mockImplementation(() => {
      removeCalls += 1;
      if (removeCalls === 1) return Promise.reject(new ApiError('not found', 404));
      return ok({
        id: 'p5b',
        userId: USER,
        bookId: BOOK,
        updatedAt: '2026-08-13T09:56:00.000Z',
        isDeleted: true,
      }) as any;
    });
    mockApi.create.mockImplementation((_path, body: any) =>
      ok({ ...body, updatedAt: '2026-08-13T09:55:00.000Z' }) as any,
    );

    const report = await syncEngine.run();

    expect(mockApi.create).toHaveBeenCalledTimes(1);
    expect(mockApi.remove).toHaveBeenCalledTimes(2);
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
                updatedAt: '2099-08-25T00:00:00.000Z',
                isDeleted: false,
                fieldUpdatedAt: { theme: '2099-08-25T00:00:00.000Z' },
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
    expect(payload.fieldUpdatedAt.theme).toBe('2099-08-25T00:00:00.000Z');
  });

  it("syncEngine.run() pushes the merged union to the server on the next attempt", async () => {
    await personalizationStore.update({ zoom: 5 });
    mockApi.create.mockRejectedValueOnce(new ApiError('bad payload', 400));
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
                updatedAt: '2099-08-25T00:00:00.000Z',
                isDeleted: false,
                fieldUpdatedAt: { theme: '2099-08-25T00:00:00.000Z' },
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
