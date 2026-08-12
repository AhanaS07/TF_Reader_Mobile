// Integration test: syncManager.ts driving REAL SQLite (node:sqlite via __mocks__/expo-sqlite.js)
// through progressRepository/outboxRepository, against a MOCKED network layer (global.fetch).
// This is the actual push/pull engine, not a single unit — exercised end to end.

import { syncManager } from './syncManager';
import { progressRepository } from './repositories/progressRepository';
import { outboxRepository } from './repositories/outboxRepository';
import { getDatabase } from './db/database';
import { USER_ID, BOOK_ID } from './config';

function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers();
  headers.set('date', new Date().toUTCString());
  return new Response(JSON.stringify(body), { status, headers });
}

// progressRepository.savePosition keeps exactly one row per (user, book), so
// without a reset every test would silently share the previous test's row —
// including its server_updated_at, which would trigger unexpected
// serverHasDiverged() network calls. Wipe the tables the push/pull tests
// touch before each test instead.
beforeEach(async () => {
  const db = await getDatabase();
  await db.execAsync('DELETE FROM progress; DELETE FROM outbox; DELETE FROM sync_metadata;');
});

/** Routes mocked fetch calls by method + URL instead of call order, since push
 *  and pull can each contribute a variable number of requests. */
function routedFetch(
  rules: { method: string; match: (url: string) => boolean; respond: () => Response }[],
  fallback: () => Response = () => jsonResponse([]),
): typeof fetch {
  return jest.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const rule = rules.find((r) => r.method === method && r.match(url));
    return Promise.resolve((rule ?? { respond: fallback }).respond());
  }) as unknown as typeof fetch;
}

describe('syncManager.run — PUSH', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('a local CREATE is pushed, acknowledged, removed from the outbox, and marked synced', async () => {
    const row = await progressRepository.savePosition(42);
    expect(await outboxRepository.countPending()).toBeGreaterThan(0);

    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: row.id, userId: USER_ID, bookId: BOOK_ID, offset: 42, updatedAt: row.updated_at }));
    fetchMock.mockResolvedValue(jsonResponse([])); // the 6 pull GETs that follow
    global.fetch = fetchMock;

    const report = await syncManager.run();

    expect(report.pushed).toBeGreaterThanOrEqual(1);
    expect(report.error).toBeUndefined();

    const stored = await progressRepository.findById(row.id);
    expect(stored?.synced).toBe(1);
  });

  it('a CREATE that 409s falls back to PUT (idempotent retry of a create whose response was lost)', async () => {
    const row = await progressRepository.savePosition(7);

    const fetchMock = routedFetch([
      { method: 'POST', match: (url) => url.endsWith('/progress'), respond: () => jsonResponse({ error: 'exists' }, 409) },
      {
        method: 'PUT',
        match: (url) => url.endsWith(`/progress/${row.id}`),
        respond: () =>
          jsonResponse({ id: row.id, userId: USER_ID, bookId: BOOK_ID, offset: 7, updatedAt: row.updated_at }),
      },
    ]);
    global.fetch = fetchMock;

    const report = await syncManager.run();
    expect(report.pushed).toBeGreaterThanOrEqual(1);

    const methods = (fetchMock as jest.Mock).mock.calls.map(([, init]: [string, RequestInit]) => init.method);
    expect(methods).toContain('POST');
    expect(methods).toContain('PUT');
  });

  it('a validation failure (400) marks the op FAILED and leaves it queued, instead of dropping it', async () => {
    const row = await progressRepository.savePosition(1);

    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400));
    fetchMock.mockResolvedValue(jsonResponse([]));
    global.fetch = fetchMock;

    const report = await syncManager.run();
    expect(report.failed).toBeGreaterThanOrEqual(1);

    const all = await outboxRepository.listAll();
    const op = all.find((o) => o.entity_id === row.id);
    expect(op?.status).toBe('FAILED');
    expect(op?.retry_count).toBe(1);
  });

  it('a transient failure (500) aborts the run and leaves the outbox intact for the next attempt', async () => {
    const row = await progressRepository.savePosition(9);
    const beforeCount = await outboxRepository.countPending();

    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: 'db down' }, 500));

    const report = await syncManager.run();
    expect(report.error).toBeDefined();

    // Nothing was removed — the same op is still there for the next run to retry.
    const afterCount = await outboxRepository.countPending();
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    const stillThere = (await outboxRepository.listAll()).find((o) => o.entity_id === row.id);
    expect(stillThere?.status).toBe('PENDING');
  });

  it('concurrent run() calls share one execution rather than racing two pushes of the same op', async () => {
    await progressRepository.savePosition(3);
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([]));

    const [a, b] = await Promise.all([syncManager.run(), syncManager.run()]);
    expect(a).toBe(b); // same report object — one execution, shared
  });

  it('serverHasDiverged() must not drop the outbox op for an edit applyServerRecord actually kept', async () => {
    // Base version this device last saw from the server.
    const T1 = '2020-01-01T00:00:00.000Z';
    // The OTHER device's divergent write - newer than T1, but (as constructed here) OLDER than
    // this device's own pending local edit below.
    const T2 = '2021-01-01T00:00:00.000Z';

    const row = await progressRepository.savePosition(1);
    // Simulate this row having already been synced once, with the server ack recorded as T1.
    await progressRepository.adoptPushResult(
      { id: row.id, userId: USER_ID, bookId: BOOK_ID, offset: 1, updatedAt: T1, isDeleted: false },
      row.updated_at,
    );

    // A genuine new local edit, stamped with "now" - later than both T1 and T2.
    const edited = await progressRepository.savePosition(2);
    expect(edited.updated_at > T2).toBe(true);

    global.fetch = routedFetch([
      {
        method: 'GET',
        match: (url) => url.endsWith(`/progress/${row.id}`),
        respond: () =>
          jsonResponse({ id: row.id, userId: USER_ID, bookId: BOOK_ID, offset: 999, updatedAt: T2 }),
      },
      // Since applyServerRecord refuses to overwrite (our edit is newer), serverHasDiverged
      // must let this op fall through to a normal push instead of dropping it.
      {
        method: 'PUT',
        match: (url) => url.endsWith(`/progress/${row.id}`),
        respond: () =>
          jsonResponse({
            id: row.id,
            userId: USER_ID,
            bookId: BOOK_ID,
            offset: 2,
            updatedAt: edited.updated_at,
          }),
      },
    ]);

    await syncManager.run();

    // applyServerRecord correctly refused to overwrite - the local edit (offset 2) is still the
    // row's value - and it actually reached the server this time instead of being silently
    // dropped from the queue.
    const stored = await progressRepository.findById(row.id);
    expect(stored?.offset).toBe(2);
    expect(stored?.synced).toBe(1);

    const stillQueued = (await outboxRepository.listAll()).filter((o) => o.entity_id === row.id);
    expect(stillQueued).toHaveLength(0);
  });
});

describe('syncManager.run — PULL', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('applies a server record for a book with no local row at all', async () => {
    const bookId = `pull-book-${Date.now()}`;

    global.fetch = routedFetch([
      {
        method: 'GET',
        match: (url) => url.includes('/progress?'),
        respond: () =>
          jsonResponse([
            { id: 'server-row-1', userId: USER_ID, bookId, offset: 88, updatedAt: '2030-01-01T00:00:00.000Z' },
          ]),
      },
    ]);

    await syncManager.run();

    const applied = await progressRepository.findById('server-row-1');
    expect(applied?.offset).toBe(88);
    expect(applied?.synced).toBe(1);
  });
});
