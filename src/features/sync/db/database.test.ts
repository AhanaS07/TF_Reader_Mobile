// Exercises database.ts against a REAL SQLite engine (node:sqlite via __mocks__/expo-sqlite.js),
// not a fake — schema creation, migrations, and the small helpers all run real SQL.

import { getDatabase, newId, nowIso, toInt, toBool } from './database';

describe('getDatabase', () => {
  it('creates the schema and returns a working connection', async () => {
    const db = await getDatabase();
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'progress',
        'bookmarks',
        'highlights',
        'personalization',
        'accessibility',
        'downloads',
        'outbox',
        'sync_metadata',
      ])
    );
  });

  it('returns the SAME connection on repeated calls (cached promise)', async () => {
    const first = await getDatabase();
    const second = await getDatabase();
    expect(first).toBe(second);
  });

  it('every syncable table already has server_updated_at from the migration step', async () => {
    const db = await getDatabase();
    for (const table of ['progress', 'bookmarks', 'highlights', 'personalization', 'accessibility', 'downloads']) {
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      expect(columns.map((c) => c.name)).toContain('server_updated_at');
    }
  });

  it('personalization has no book_id column (moved to user-scoped)', async () => {
    const db = await getDatabase();
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(personalization)`);
    expect(columns.map((c) => c.name)).not.toContain('book_id');
  });
});

describe('newId / nowIso', () => {
  it('newId returns distinct RFC-4122-shaped UUIDs', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('nowIso returns a real, parseable ISO-8601 timestamp', () => {
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});

describe('toInt / toBool', () => {
  it('round-trip through SQLite\'s integer-only boolean representation', () => {
    expect(toInt(true)).toBe(1);
    expect(toInt(false)).toBe(0);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toBool(undefined)).toBe(false);
  });
});
