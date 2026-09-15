// Exercises database.ts against a REAL SQLite engine (sql.js, via the root
// __mocks__/expo-sqlite.js) rather than a hand-rolled fake, so schema creation,
// the migration step, and PRAGMA introspection all run genuine SQL.

import { getDatabase, newId, nowIso, toInt, toBool } from './database';

const SYNCABLE_TABLES = [
  'progress',
  'bookmarks',
  'highlights',
  'personalization',
  'accessibility',
  'downloads',
];

describe('getDatabase', () => {
  it('creates every table the sync engine writes to', async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([...SYNCABLE_TABLES, 'outbox', 'sync_metadata']),
    );
  });

  it('caches the connection so every store shares one', async () => {
    expect(await getDatabase()).toBe(await getDatabase());
  });

  it('migration adds server_updated_at to every syncable table', async () => {
    const db = await getDatabase();
    for (const table of SYNCABLE_TABLES) {
      const columns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${table})`,
      );
      expect(columns.map((c) => c.name)).toContain('server_updated_at');
    }
  });

  it('migration drops book_id from personalization (now user-scoped)', async () => {
    const db = await getDatabase();
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(personalization)`,
    );
    expect(columns.map((c) => c.name)).not.toContain('book_id');
  });
});

describe('newId', () => {
  it('mints distinct RFC-4122 v4 UUIDs on the device', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('nowIso', () => {
  it('returns millisecond ISO-8601 that round-trips through Date', () => {
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('sorts lexicographically in chronological order, which LWW relies on', () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const later = new Date('2026-01-01T00:00:00.001Z').toISOString();
    expect(earlier < later).toBe(true);
  });
});

describe('toInt / toBool', () => {
  it("round-trips through SQLite's integer-only booleans", () => {
    expect(toInt(true)).toBe(1);
    expect(toInt(false)).toBe(0);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
  });

  it('treats a missing value as false rather than throwing', () => {
    expect(toBool(null)).toBe(false);
    expect(toBool(undefined)).toBe(false);
  });
});
