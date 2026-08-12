/**
 * expo-sqlite's async surface over Node's built-in synchronous SQLite.
 *
 * Only the six methods the repositories call are implemented, and each maps
 * one-to-one onto node:sqlite. The SQL itself is untouched - both are the same
 * SQLite engine, so a statement that works here works on the device.
 */
import { DatabaseSync } from 'node:sqlite';

class AsyncDatabase {
  constructor(db) {
    this.db = db;
  }

  async execAsync(sql) {
    this.db.exec(sql);
  }

  async runAsync(sql, params = []) {
    const result = this.db.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getAllAsync(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async getFirstAsync(sql, params = []) {
    return this.db.prepare(sql).get(...params) ?? null;
  }

  /** Rolls back on throw, which is what makes the row + outbox pairing atomic. */
  async withTransactionAsync(body) {
    this.db.exec('BEGIN');
    try {
      await body();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  closeSync() {
    this.db.close();
  }
}

export async function openDatabaseAsync(name) {
  return new AsyncDatabase(new DatabaseSync(process.env.VERIFY_DB_PATH ?? name));
}
