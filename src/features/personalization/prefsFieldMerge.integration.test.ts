// Real-Mongo twin of prefsFieldMerge.test.ts: proves field-level merge for prefs survives a full
// round trip through the ACTUAL backend — that `field_updated_at` is serialized on push, stored by
// Mongo, and read back on pull so the device-side merge (mergeFieldLevel) has the per-field stamps
// it needs. The SQLite test proves the merge logic; this proves the wire carries what it depends on.
//
// Run with `npm run test:integration` against a running backend (EXPO_PUBLIC_API_URL=http://localhost:8080
// + the dedicated test user/book, see package.json). There is no health-check skip: if the backend is
// down or 401s, that failure IS the signal (same policy as syncEngine.integration.test.ts).
//
// The global.fetch swap below is the same one that file uses and for the same reason: jest-expo's
// fetch is RN's native-bridge polyfill, which resolves every call with status undefined under Jest.
import * as http from 'node:http';
import * as https from 'node:https';

import { getDatabase } from '@/features/sync/localDb/database';
import { api } from '@/features/sync/syncApi';
import { syncEngine } from '@/features/sync/syncEngine';
import { BOOK_ID, USER_ID } from '@/features/sync/syncConfig';
import { personalizationId, personalizationStore } from '@/features/sync/stores/personalizationStore';

import { prefsStore } from './prefsStore';

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

async function resetLocalTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM personalization; DELETE FROM accessibility;
     DELETE FROM sync_metadata;`,
  );
}

beforeEach(resetLocalTables);

describe('prefs field-level merge through the real backend', () => {
  it('local edits to font, line-height and spread survive a concurrent remote theme edit', async () => {
    const id = personalizationId(USER_ID);
    const base = await prefsStore.getPrefs();

    // This device changes three fields, then push. `savePrefs` replaces a nested group wholesale, so
    // spread the current group and override the one field. push runs before pull, so the server now
    // holds this device's doc with per-field stamps for exactly these three columns.
    await prefsStore.savePrefs({
      font: { ...base.font, family: 'Lora' },
      typography: { ...base.typography, lineHeight: 1.8 },
      layout: { ...base.layout, spread: 'double' },
    });
    const pushReport = await syncEngine.run();
    expect(pushReport.failed).toBe(0);

    // Another device writes directly on the server: theme changed, stamped in the future so it wins
    // its own field; it carries the OLD values (and no stamps) for the three fields this device just
    // edited, so those must NOT overwrite the local edits. fieldUpdatedAt keys are LOCAL snake_case.
    await api.update('personalization', id, {
      id,
      userId: USER_ID,
      bookId: BOOK_ID, // PERSONALIZATION_REQUIRES_BOOK_ID — backend validation only
      theme: 'sepia',
      fontFamily: 'system',
      customFontUri: null,
      typographySize: 16,
      typographyLineHeight: 1.5,
      typographySpacing: 0,
      typographyMargins: 16,
      layoutFlow: 'paginated',
      layoutSpread: 'single',
      zoom: 1,
      updatedAt: '2099-01-01T00:00:00.000Z',
      isDeleted: false,
      fieldUpdatedAt: { theme: '2099-01-01T00:00:00.000Z' },
    });

    // Pull merges the server record field-by-field into the local row.
    const pullReport = await syncEngine.run();
    expect(pullReport.pulled).toBeGreaterThanOrEqual(1);

    const row = await personalizationStore.current();
    expect(row?.theme).toBe('sepia'); // remote edit to a different field adopted
    expect(row?.font_family).toBe('Lora'); // local edit kept
    expect(row?.typography_line_height).toBe(1.8); // local edit kept
    expect(row?.layout_spread).toBe('double'); // local edit kept

    // CONVERGENCE: the merged row is marked synced=1 (mergeFieldLevel), so a bare re-sync pushes
    // nothing — the union of stamps lives only on this device until a fresh edit re-pushes it. One
    // more local edit does that; afterwards the SERVER's fieldUpdatedAt holds every field's stamp,
    // not just the last writer's `theme`.
    await prefsStore.savePrefs({ zoom: { level: 2 } });
    expect((await syncEngine.run()).failed).toBe(0);

    const merged = await personalizationStore.current();
    expect(merged?.synced).toBe(1); // pushed successfully
  });
});
