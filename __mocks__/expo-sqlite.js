// Jest manual mock for `expo-sqlite` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by Node's real, built-in `node:sqlite` (DatabaseSync) — genuine SQL execution, real
// SQLite semantics (constraints, indexes, PRAGMA table_info, transactions), not a hand-rolled
// fake. What this proves: sync's db/schema/migrations/repositories logic is correct against a
// real SQLite engine. What it does NOT prove: expo-sqlite's own native (JSI) implementation
// behaves identically on-device — that's a separate on-device confirmation, same caveat as every
// other native-module mock in this directory.
//
// Each `openDatabaseAsync(name)` call gets its OWN fresh in-memory database — matching a real
// per-test-file Jest module registry reset, and matching that `database.ts`'s own
// `databasePromise` caching means this only runs once per test file in practice.

const { DatabaseSync } = require('node:sqlite');

class MockSQLiteDatabase {
  constructor(nativeDb) {
    this._db = nativeDb;
  }

  async execAsync(sql) {
    this._db.exec(sql);
  }

  async runAsync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getAllAsync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    return stmt.all(...params);
  }

  async getFirstAsync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    const row = stmt.get(...params);
    return row === undefined ? null : row;
  }

  /**
   * node:sqlite has no named transaction helper — plain BEGIN/COMMIT/ROLLBACK, same as the real
   * SQL expo-sqlite's own withTransactionAsync ultimately issues under the hood.
   */
  async withTransactionAsync(callback) {
    this._db.exec('BEGIN');
    try {
      await callback();
      this._db.exec('COMMIT');
    } catch (error) {
      this._db.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync() {
    this._db.close();
  }
}

async function openDatabaseAsync(_name) {
  const nativeDb = new DatabaseSync(':memory:');
  return new MockSQLiteDatabase(nativeDb);
}

module.exports = { openDatabaseAsync };
