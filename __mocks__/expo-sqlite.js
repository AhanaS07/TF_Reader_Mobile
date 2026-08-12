// Jest manual mock for `expo-sqlite` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by `sql.js` — real SQLite, compiled to plain JavaScript (the `sql-asm.js` build, NOT
// the default WASM build — see below for why). Genuine SQL execution, real SQLite semantics
// (constraints, indexes, PRAGMA table_info, transactions), not a hand-rolled fake — same
// property the previous `node:sqlite`-backed version of this file had. What this proves: sync's
// db/schema/migrations/repositories logic is correct against a real SQLite engine. What it does
// NOT prove: expo-sqlite's own native (JSI) implementation behaves identically on-device — a
// separate on-device confirmation, same caveat as every other native-module mock here.
//
// REPLACED 2026-08-12 (was `node:sqlite`'s DatabaseSync): that built-in doesn't exist on Node 20,
// which `.github/workflows/ci.yml` pins — CI failed with "No such built-in module: node:sqlite"
// while every local run passed, since local Node here is newer. Chose `sql.js` over rewriting
// this as a hand-rolled SQL interpreter for the same reason the original author chose
// `node:sqlite` over one: real SQLite semantics, not an approximation that could silently
// diverge from what expo-sqlite's native engine actually does.
//
// USES `sql.js/dist/sql-asm.js`, NOT the package's default WASM build (plain `require('sql.js')`
// resolves to `sql-wasm.js`) — confirmed empirically, not assumed: the WASM build's
// `new SQL.Database()` throws an EMPTY-message error under Jest's test environment (traced into
// sql.js's own source: `sqlite3_open` itself fails, before any SQL runs) even though the exact
// same WASM build works fine in plain Node outside Jest. The asm.js build is pure JavaScript —
// no `WebAssembly.instantiate` step at all — and passes the identical test cleanly. This also
// means zero WASM-loading/Node-version coupling of any kind, not just avoiding `node:sqlite`.
//
// Each `openDatabaseAsync(name)` call gets its OWN fresh in-memory database — matching a real
// per-test-file Jest module registry reset, and matching that `database.ts`'s own
// `databasePromise` caching means this only runs once per test file in practice. The `sql.js`
// WASM engine itself (`initSqlJsPromise`) is loaded once and reused — only the `Database`
// instance is fresh per call, same split as before (module load once, DB fresh per call).

const initSqlJs = require('sql.js/dist/sql-asm.js');

// Pure JS (asm.js) — no .wasm file to locate, unlike the package's default WASM build.
const initSqlJsPromise = initSqlJs();

class MockSQLiteDatabase {
  constructor(db) {
    this._db = db;
  }

  async execAsync(sql) {
    this._db.run(sql);
  }

  async runAsync(sql, params = []) {
    this._db.run(sql, params);
    const changes = this._db.getRowsModified();
    const idRows = this._db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowId = idRows.length > 0 ? idRows[0].values[0][0] : 0;
    return {
      changes: Number(changes),
      lastInsertRowId: Number(lastInsertRowId),
    };
  }

  async getAllAsync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  async getFirstAsync(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /**
   * sql.js has no named transaction helper — plain BEGIN/COMMIT/ROLLBACK, same as the real SQL
   * expo-sqlite's own withTransactionAsync ultimately issues under the hood.
   */
  async withTransactionAsync(callback) {
    this._db.run('BEGIN');
    try {
      await callback();
      this._db.run('COMMIT');
    } catch (error) {
      this._db.run('ROLLBACK');
      throw error;
    }
  }

  async closeAsync() {
    this._db.close();
  }
}

async function openDatabaseAsync(_name) {
  const SQL = await initSqlJsPromise;
  const db = new SQL.Database();
  return new MockSQLiteDatabase(db);
}

module.exports = { openDatabaseAsync };
