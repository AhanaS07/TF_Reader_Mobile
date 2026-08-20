// Same three invariants as syncEngine.test.ts, but against a REAL running Mongo backend - no
// syncApi mock. Run with `npm run test:integration`, which pins EXPO_PUBLIC_API_URL and a
// dedicated EXPO_PUBLIC_USER_ID / EXPO_PUBLIC_BOOK_ID (see package.json) so this suite's records
// never mix with real dev data under user-001/book-001, and a pull here can never return someone
// else's rows.
//
// There is no health-check skip. If the backend is down or answers 401 (see B1 in
// API_CONTRACT_NOTES.md - the app sends no auth header today), the failure IS the useful signal,
// and swallowing it would make a genuine outage or an unauthenticated call read as a green suite.
//
// global.fetch is replaced below with a plain node:http/https client BEFORE anything else runs.
// jest-expo's `fetch` is React Native's own polyfill, which talks to RN's native XHR bridge - a
// bridge that does not exist under Jest, so it resolves every call with `status: undefined` and
// no body regardless of what the server actually returned. syncApi.ts reads `fetch` off the
// global at call time (not at import time), so swapping it here is enough for every request the
// engine makes, with no change to syncApi.ts itself.
import * as http from 'node:http';
import * as https from 'node:https';

import { getDatabase, newId } from './localDb/database';
import type { BookmarkRow, HighlightRow, PersonalizationRow, ProgressRow } from './localDb/types';
import { bookmarkTable } from './stores/bookmarkStore';
import { highlightTable } from './stores/highlightStore';
import { personalizationId, personalizationTable } from './stores/personalizationStore';
import { progressTable } from './stores/progressStore';
import { api } from './syncApi';
import { syncEngine } from './syncEngine';
import { BOOK_ID, USER_ID } from './syncConfig';

function nodeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          resolve(
            new Response(body.length ? body : null, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers,
            }),
          );
        });
      },
    );

    req.on('error', reject);

    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => req.destroy(new DOMException('Aborted', 'AbortError')));
    }

    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = nodeFetch as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

jest.setTimeout(30000);

// bookmarks, not progress: the backend enforces one progress DOCUMENT per (userId, bookId) -
// even a soft-deleted one still occupies that slot, so a second `create` with a fresh id for the
// same user/book 409s. Confirmed against the real backend: after one push test tombstoned a
// progress row, a follow-up create for the same user/book kept 409ing even though the id was
// new. Bookmarks carry no such singleton constraint, so distinct test records never collide.
function bookmarkRow(id: string, name: string, updatedAt: string): BookmarkRow {
  return {
    id,
    user_id: USER_ID,
    book_id: BOOK_ID,
    chapter_id: `page-${name}`,
    locator: JSON.stringify({ type: 'PDF', page: 1 }),
    name,
    created_at: updatedAt,
    updated_at: updatedAt,
    is_deleted: 0,
    synced: 0,
  };
}

async function resetLocalTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM bookmarks; DELETE FROM highlights;
     DELETE FROM progress; DELETE FROM personalization; DELETE FROM sync_metadata;`,
  );
}

// Tombstones the test's own records (api.remove writes a soft delete, not a hard one) so the
// dedicated test user/book has nothing live between runs. Bookmarks and highlights carry no
// uniqueness constraint, so leftover tombstones from a previous run never block a fresh id from
// being used - unlike progress and personalization below, which are deliberately never entered
// here (see their own describe blocks for why).
const createdOnServer: { entityPath: string; id: string }[] = [];
async function cleanupServer(): Promise<void> {
  await Promise.all(
    createdOnServer.map(({ entityPath, id }) => api.remove(entityPath, id).catch(() => undefined)),
  );
  createdOnServer.length = 0;
}

beforeEach(resetLocalTables);
afterEach(cleanupServer);

describe('push: SQLite outbox -> MongoDB', () => {
  it('drains a queued CREATE into the real backend', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });
    await bookmarkTable.saveLocal(bookmarkRow(id, 'push-test', new Date().toISOString()), 'CREATE');

    const report = await syncEngine.run();

    expect(report.failed).toBe(0);
    expect(report.pushed).toBeGreaterThanOrEqual(1);

    const db = await getDatabase();
    expect(await db.getAllAsync(`SELECT * FROM outbox WHERE entity_id = ?`, [id])).toHaveLength(0);

    // Proves the record actually landed server-side, independent of the local
    // row syncEngine wrote back from the same response.
    const stored = await api.findById<any>('bookmarks', id);
    expect(stored.data.name).toBe('push-test');
    expect(stored.data.userId).toBe(USER_ID);
  });
});

describe('pull: MongoDB -> SQLite', () => {
  it('applies a record written directly on the server into local SQLite', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });
    await api.create('bookmarks', {
      id,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: 'page-pull-test',
      locator: { type: 'PDF', page: 1 },
      name: 'pull-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    });

    const report = await syncEngine.run();

    expect(report.pulled).toBeGreaterThanOrEqual(1);
    const row = await bookmarkTable.findById(id);
    expect(row?.name).toBe('pull-test');
    expect(row?.synced).toBe(1);
  });
});

describe('round trip', () => {
  it('a locally pushed edit reads back unchanged on the next pull', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });
    await bookmarkTable.saveLocal(
      bookmarkRow(id, 'round-trip-test', new Date().toISOString()),
      'CREATE',
    );

    await syncEngine.run(); // push
    const afterPush = await bookmarkTable.findById(id);

    await syncEngine.run(); // nothing left in the outbox: pull only
    const afterPull = await bookmarkTable.findById(id);

    expect(afterPull?.name).toBe(afterPush?.name);
    expect(afterPull?.updated_at).toBe(afterPush?.server_updated_at);
  });
});

function highlightRow(id: string, color: string, updatedAt: string): HighlightRow {
  return {
    id,
    user_id: USER_ID,
    book_id: BOOK_ID,
    start_locator: JSON.stringify({ type: 'PDF', page: 1, offset: 0 }),
    end_locator: JSON.stringify({ type: 'PDF', page: 1, offset: 10 }),
    color,
    created_at: updatedAt,
    updated_at: updatedAt,
    is_deleted: 0,
    synced: 0,
  };
}

describe('push: highlights', () => {
  it('drains a queued CREATE into the real backend', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'highlights', id });
    await highlightTable.saveLocal(highlightRow(id, 'yellow', new Date().toISOString()), 'CREATE');

    const report = await syncEngine.run();

    expect(report.failed).toBe(0);
    expect(report.pushed).toBeGreaterThanOrEqual(1);

    const stored = await api.findById<any>('highlights', id);
    expect(stored.data.color).toBe('yellow');
    expect(stored.data.userId).toBe(USER_ID);
  });
});

describe('push: progress (singleton per user+book)', () => {
  // Unlike bookmarks/highlights, the backend enforces one progress DOCUMENT per (userId,
  // bookId) and a soft-deleted one still occupies that slot (see the note on bookmarkRow
  // above) - so this test never mints a fresh id. It looks up whatever document already
  // sits in that slot and updates it, or creates the slot's very first document if this is
  // genuinely the first run. Either way it is never added to createdOnServer/cleanupServer:
  // deleting it would only recreate the exact problem this works around.
  it('pushes the current reading position into the real backend', async () => {
    // NOT filtered by !isDeleted - a tombstoned document still occupies the (userId, bookId)
    // slot, so treating it as "nothing there" and minting a fresh id 409s on create and then
    // 404s on the fallback PUT (a new id was never created). Reusing its id and updating it -
    // which un-deletes it, since the payload's isDeleted is false - is what the slot allows.
    const existing = (await api.list<any>('progress', { userId: USER_ID, bookId: BOOK_ID }))
      .data?.[0];
    const id = existing?.id ?? newId();

    const row: ProgressRow = {
      id,
      user_id: USER_ID,
      book_id: BOOK_ID,
      offset: 42,
      locator: JSON.stringify({ type: 'PDF', page: 42, offset: 0 }),
      updated_at: new Date().toISOString(),
      is_deleted: 0,
      synced: 0,
    };
    await progressTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE');

    const report = await syncEngine.run();

    expect(report.failed).toBe(0);
    const stored = await api.findById<any>('progress', id);
    expect(stored.data.offset).toBe(42);
    expect(stored.data.userId).toBe(USER_ID);
  });
});

describe('push: personalization (singleton per user)', () => {
  // The id is deterministic (personalizationId(USER_ID)), not a fresh UUID, so a create
  // against a slot a previous run already filled 409s and syncEngine's own sendCreate
  // falls back to PUT against that exact id - no find-or-reuse dance needed, unlike progress.
  //
  // personalizationMapper.toServer always sends bookId (PERSONALIZATION_REQUIRES_BOOK_ID),
  // purely to satisfy backend validation despite personalization being user-scoped. If the
  // dedicated test book has been removed server-side, this push fails on that validation -
  // a real signal about the current backend state, not a bug in this test.
  it('pushes the per-user preferences into the real backend', async () => {
    const id = personalizationId(USER_ID);
    const row: PersonalizationRow = {
      id,
      user_id: USER_ID,
      theme: 'dark',
      font_family: 'serif',
      custom_font_uri: null,
      typography_size: 18,
      typography_line_height: 1.4,
      typography_spacing: 0,
      typography_margins: 16,
      layout_flow: 'paginated',
      layout_spread: 'auto',
      zoom: 1,
      updated_at: new Date().toISOString(),
      is_deleted: 0,
      synced: 0,
    };
    await personalizationTable.saveLocal(row, 'CREATE');

    const report = await syncEngine.run();

    expect(report.failed).toBe(0);
    const stored = await api.findById<any>('personalization', id);
    expect(stored.data.theme).toBe('dark');
    expect(stored.data.userId).toBe(USER_ID);
  });
});

// Both tests below control ordering with real wall-clock time, not injected timestamps:
// saveLocal's monotonicStamp refuses to move a row's updated_at backwards relative to its own
// previous value, so an explicit past/future timestamp cannot be used to force who wins. What
// decides serverHasDiverged's LWW guard is simply which write - our local edit or the
// "other device"'s direct api.update - happens second in real time, so the two tests differ
// only in which one is done last.
describe('LWW conflict resolution', () => {
  it('drops our queued edit when a concurrent server write is newer', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });

    await bookmarkTable.saveLocal(bookmarkRow(id, 'v1', new Date().toISOString()), 'CREATE');
    await syncEngine.run(); // establishes server_updated_at as our base version

    // Our own edit, queued before we find out about the concurrent write below.
    await bookmarkTable.saveLocal(bookmarkRow(id, 'local-edit', new Date().toISOString()), 'UPDATE');

    // Another device writes directly on the server, strictly after our edit above.
    const local = await bookmarkTable.findById(id);
    await api.update('bookmarks', id, {
      id,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: local!.chapter_id,
      locator: JSON.parse(local!.locator),
      name: 'concurrent-write',
      createdAt: local!.created_at,
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    });

    const report = await syncEngine.run();

    expect(report.conflicts).toBeGreaterThanOrEqual(1);
    const db = await getDatabase();
    expect(await db.getAllAsync(`SELECT * FROM outbox WHERE entity_id = ?`, [id])).toHaveLength(0);

    const row = await bookmarkTable.findById(id);
    expect(row?.name).toBe('concurrent-write');
    const onServer = await api.findById<any>('bookmarks', id);
    expect(onServer.data.name).toBe('concurrent-write');
  });

  it('pushes our edit through when it is newer than a concurrent server write', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });

    await bookmarkTable.saveLocal(bookmarkRow(id, 'v1', new Date().toISOString()), 'CREATE');
    await syncEngine.run();

    // Another device writes directly on the server first this time.
    const v1 = await bookmarkTable.findById(id);
    await api.update('bookmarks', id, {
      id,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: v1!.chapter_id,
      locator: JSON.parse(v1!.locator),
      name: 'concurrent-write',
      createdAt: v1!.created_at,
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    });

    // Our own edit, made strictly after the concurrent write above.
    await bookmarkTable.saveLocal(bookmarkRow(id, 'local-edit', new Date().toISOString()), 'UPDATE');

    const report = await syncEngine.run();

    expect(report.conflicts).toBe(0);
    expect(report.pushed).toBeGreaterThanOrEqual(1);
    const row = await bookmarkTable.findById(id);
    expect(row?.name).toBe('local-edit');
    const onServer = await api.findById<any>('bookmarks', id);
    expect(onServer.data.name).toBe('local-edit');
  });
});

describe('pull: preserves unsynced local edits', () => {
  it('does not let an older server record overwrite a newer unsynced local edit', async () => {
    const id = newId();
    createdOnServer.push({ entityPath: 'bookmarks', id });

    await api.create('bookmarks', {
      id,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: 'page-pull-preserve',
      locator: { type: 'PDF', page: 1 },
      name: 'server-value',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    });

    // A local edit written strictly after the server record above, with NO outbox entry -
    // writeRow is the raw upsert with no outbox side effect (the same primitive pull() itself
    // uses), so push() has nothing queued for this id and only pull() ever touches it below.
    await bookmarkTable.writeRow({
      id,
      user_id: USER_ID,
      book_id: BOOK_ID,
      chapter_id: 'page-pull-preserve',
      locator: JSON.stringify({ type: 'PDF', page: 1 }),
      name: 'local-unsynced-edit',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: 0,
      synced: 0,
      server_updated_at: null,
    });

    const report = await syncEngine.run();

    expect(report.pulled).toBeGreaterThanOrEqual(1);
    const row = await bookmarkTable.findById(id);
    expect(row?.name).toBe('local-unsynced-edit');
    expect(row?.synced).toBe(0);

    // The server's own copy is untouched either way - pull only ever reads.
    const onServer = await api.findById<any>('bookmarks', id);
    expect(onServer.data.name).toBe('server-value');
  });
});
