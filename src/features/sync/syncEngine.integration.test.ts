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
import type { BookmarkRow } from './localDb/types';
import { bookmarkTable } from './stores/bookmarkStore';
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
    locator: JSON.stringify({ type: 'pdf', page: 1 }),
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
    `DELETE FROM outbox; DELETE FROM bookmarks; DELETE FROM sync_metadata;`,
  );
}

// Tombstones the test's own records (api.remove writes a soft delete, not a hard one) so the
// dedicated test user/book has nothing live between runs. Bookmarks carry no uniqueness
// constraint, so leftover tombstones from a previous run never block a fresh id from being used.
const createdOnServer: string[] = [];
async function cleanupServer(): Promise<void> {
  await Promise.all(
    createdOnServer.map((id) => api.remove('bookmarks', id).catch(() => undefined)),
  );
  createdOnServer.length = 0;
}

beforeEach(resetLocalTables);
afterEach(cleanupServer);

describe('push: SQLite outbox -> MongoDB', () => {
  it('drains a queued CREATE into the real backend', async () => {
    const id = newId();
    createdOnServer.push(id);
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
    createdOnServer.push(id);
    await api.create('bookmarks', {
      id,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: 'page-pull-test',
      locator: { type: 'pdf', page: 1 },
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
    createdOnServer.push(id);
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
