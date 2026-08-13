import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { SCHEMA_SQL } from './schema';

const DATABASE_NAME = 'reader-offline.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens (and on first call creates) the offline database. The promise is cached
 * so every repository shares one connection.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(SCHEMA_SQL);
      await runMigrations(db);
      return db;
    });
  }
  return databasePromise;
}

/**
 * Schema changes that CREATE TABLE IF NOT EXISTS cannot make on its own, for
 * databases created by an earlier version of the app.
 */
const SYNCABLE_TABLES = [
  'progress',
  'bookmarks',
  'highlights',
  'personalization',
  'accessibility',
  'downloads',
] as const;

async function columnNames(
  db: SQLite.SQLiteDatabase,
  table: string,
): Promise<string[]> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.map((column) => column.name);
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // Personalization moved from user + book scoped to user scoped, so book_id goes.
  // The column has to lose its index before SQLite will drop it.
  if ((await columnNames(db, 'personalization')).includes('book_id')) {
    await db.execAsync(`
      DROP INDEX IF EXISTS idx_personalization_user_book;
      ALTER TABLE personalization DROP COLUMN book_id;
      CREATE INDEX IF NOT EXISTS idx_personalization_user ON personalization (user_id);
    `);
  }

  // Conflict detection moved off the wall clock and onto a base version, which
  // needs somewhere to remember it. Leaving it null on existing rows is right:
  // it means "the server has never acknowledged this to us", and the first sync
  // after the upgrade fills it in.
  for (const table of SYNCABLE_TABLES) {
    if (!(await columnNames(db, table)).includes('server_updated_at')) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN server_updated_at TEXT`);
    }
  }

  // Progress gained a Locator so a reflowable EPUB can restore its position; the integer
  // offset it used to carry alone cannot express a CFI. Existing rows keep offset and get a
  // null locator, which readers fall back from.
  if (!(await columnNames(db, 'progress')).includes('locator')) {
    await db.execAsync(`ALTER TABLE progress ADD COLUMN locator TEXT`);
  }

  // The nineteenth accessibility field, previously absent, so it could neither persist nor
  // sync. Defaulting to 0 matches DEFAULT_ACCESSIBILITY_PREFS.screenReaderHints.
  if (!(await columnNames(db, 'accessibility')).includes('screen_reader_hints')) {
    await db.execAsync(
      `ALTER TABLE accessibility ADD COLUMN screen_reader_hints INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/** Client-generated UUID - ids are minted on the device, never by the server. */
export function newId(): string {
  return Crypto.randomUUID();
}

/** ISO-8601 UTC, millisecond precision. Sorts lexicographically, which LWW needs. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** SQLite has no boolean type; 0/1 integers stand in for one. */
export function toInt(value: boolean): number {
  return value ? 1 : 0;
}

export function toBool(value: number | null | undefined): boolean {
  return value === 1;
}
