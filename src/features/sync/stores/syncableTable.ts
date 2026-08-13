import { getDatabase, nowIso } from '../localDb/database';
import type { EntityType, OutboxOperation } from '../localDb/types';
import { outboxStore } from './outboxStore';

interface SyncableTableOptions<TRow> {
  table: string;
  entityType: EntityType;
  /** Maps a local row to the camelCase shape the server expects. */
  toServer: (row: TRow) => Record<string, unknown>;
  /** Maps a server record to a local row. */
  toRow: (record: any) => TRow;
}

interface RowShape {
  id: string;
  updated_at: string;
  is_deleted: number;
  synced: number;
  /** Base version for conflict detection - see {@link LocalSyncFields}. */
  server_updated_at?: string | null;
}

/**
 * A stamp for a new local edit that is always later than the row it replaces.
 *
 * Normally that is just the wall clock. It matters when it is not: the server
 * writes its own `updatedAt`, and the device adopts it, so a local row can end
 * up holding a timestamp from a clock that runs ahead of the phone's. Left
 * alone, the very next offline edit would be stamped *earlier* than the row it
 * modifies, and the pre-push comparison would read it as stale and throw it
 * away. A page turn would silently fail to save.
 *
 * Bumping by a millisecond instead keeps the sequence monotonic without
 * inventing time - the ordering is what Last-Write-Wins actually needs.
 */
function monotonicStamp(candidate: string, previous?: string): string {
  if (!previous || isAfter(candidate, previous)) return candidate;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}

/**
 * Compares two wire timestamps as instants, not as text.
 *
 * Lexicographic string comparison is only correct while every timestamp shares one format, one
 * precision and one zone. That holds today because `syncApi.normalize` truncates every `…At`
 * field to millisecond UTC on the way in - but it holds because of that function, not because
 * of anything the comparison itself enforces. A backend that started emitting microseconds
 * (`…54.199801Z`) or an offset form (`…+05:30`) would silently invert the ordering, and
 * Last-Write-Wins would start discarding the newer record. Parsing costs nothing here and
 * removes the coupling.
 *
 * An unparseable timestamp sorts as older, which is the safe direction: it can only lose a
 * comparison, never win one and overwrite good data.
 */
function toMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

function isAfter(a: string, b: string): boolean {
  return toMs(a) > toMs(b);
}

function isAtOrAfter(a: string, b: string): boolean {
  return toMs(a) >= toMs(b);
}

/**
 * Serializes every local write across every syncable table onto one queue.
 *
 * One SQLite connection backs the whole app (`getDatabase()`'s cached promise), and a
 * connection can only have one transaction open at a time - confirmed against both the real
 * expo-sqlite (`withTransactionAsync`'s own doc comment: "this transaction is not exclusive and
 * can be interrupted by other async queries") and the sql.js-backed test mock, which throws
 * "cannot start a transaction within a transaction" outright. Two concurrent calls to
 * `saveLocal` - even for two entirely unrelated rows, e.g. adding two different bookmarks at
 * once - would otherwise both try to open a transaction and one throws.
 *
 * It also gives the four "find the current singleton row for this user (+book), else create
 * one" store methods (progress, personalization, accessibility, downloads) somewhere to make
 * their read-then-write atomic: without this, two concurrent first-time callers each see
 * "nothing yet" and each create their own row, silently producing two live rows where the
 * design promises exactly one. `saveLocal`'s own `{ locked: true }` escape hatch lets those
 * callers hold the queue across their read *and* their write instead of it being reacquired
 * (and deadlocking) inside `saveLocal` itself.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  // Swallow the rejection here so one failed write doesn't jam every write after it - the
  // caller of `run` still sees the real rejection via `run` itself.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Shared local-write behaviour for the six syncable tables.
 *
 * Every local mutation does two things atomically: write the row with
 * `synced = 0`, and append the matching operation to the outbox. That pairing is
 * what makes an offline edit survive an app restart and still reach the server.
 */
export function createSyncableTable<TRow extends RowShape>(
  options: SyncableTableOptions<TRow>,
) {
  const { table, entityType, toServer, toRow } = options;

  const columnsOf = (row: TRow) => Object.keys(row) as (keyof TRow & string)[];

  const upsertSql = (row: TRow) => {
    const columns = columnsOf(row);
    const quoted = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const assignments = columns
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(', ');
    return {
      sql: `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET ${assignments}`,
      values: columns.map((c) => row[c] as any),
    };
  };

  return {
    entityType,

    /** Raw upsert with no outbox side effect. Used by the pull path. */
    async writeRow(row: TRow): Promise<void> {
      const db = await getDatabase();
      const { sql, values } = upsertSql(row);
      await db.runAsync(sql, values);
    },

    /**
     * A local user edit: persist it, mark it unsynced, and queue it for push.
     * Works identically online and offline - the network is never on this path.
     *
     * Runs under `withWriteLock` by default so it can never overlap another table's write and
     * collide on the single SQLite connection's one-transaction-at-a-time limit (see
     * `withWriteLock`'s doc comment above). Pass `{ locked: true }` only when the caller has
     * *already* taken the lock itself - e.g. to hold it across a `current()` read and this
     * write as one atomic unit - since re-acquiring it here would deadlock against itself.
     */
    async saveLocal(
      row: TRow,
      operation: OutboxOperation,
      opts?: { locked?: boolean },
    ): Promise<TRow> {
      const write = async () => {
        const db = await getDatabase();
        const previous = await db.getFirstAsync<{
          updated_at: string;
          server_updated_at: string | null;
        }>(`SELECT updated_at, server_updated_at FROM ${table} WHERE id = ?`, [row.id]);

        const stamped = {
          ...row,
          updated_at: monotonicStamp(row.updated_at || nowIso(), previous?.updated_at),
          synced: 0,
          // Editing locally changes nothing about the server's copy, so the base
          // version has to survive the write - it is what the next push compares
          // against to decide whether anyone else got there first.
          server_updated_at: previous?.server_updated_at ?? row.server_updated_at ?? null,
        };
        const { sql, values } = upsertSql(stamped);

        await db.withTransactionAsync(async () => {
          await db.runAsync(sql, values);
          await outboxStore.enqueue(
            entityType,
            stamped.id,
            operation,
            toServer(stamped),
          );
        });
        return stamped;
      };

      return opts?.locked ? write() : withWriteLock(write);
    },

    /** Tombstone delete - the row survives so the delete can propagate. */
    async softDeleteLocal(id: string): Promise<void> {
      const db = await getDatabase();
      const existing = await db.getFirstAsync<TRow>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [id],
      );
      if (!existing) return;
      const tombstone = { ...existing, is_deleted: 1, updated_at: nowIso(), synced: 0 };
      await this.saveLocal(tombstone as TRow, 'DELETE');
    },

    async findById(id: string): Promise<TRow | null> {
      const db = await getDatabase();
      return db.getFirstAsync<TRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    },

    /** Everything still alive, newest first. */
    async listActive(userId: string, bookId?: string): Promise<TRow[]> {
      const db = await getDatabase();
      if (bookId) {
        return db.getAllAsync<TRow>(
          `SELECT * FROM ${table}
            WHERE user_id = ? AND book_id = ? AND is_deleted = 0
            ORDER BY updated_at DESC`,
          [userId, bookId],
        );
      }
      return db.getAllAsync<TRow>(
        `SELECT * FROM ${table} WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC`,
        [userId],
      );
    },

    async countActive(userId: string, bookId?: string): Promise<number> {
      const rows = await this.listActive(userId, bookId);
      return rows.length;
    },

    async markSynced(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const db = await getDatabase();
      const placeholders = ids.map(() => '?').join(', ');
      await db.runAsync(
        `UPDATE ${table} SET synced = 1 WHERE id IN (${placeholders})`,
        ids,
      );
    },

    /**
     * PULL: apply a record the server sent us, using Last-Write-Wins.
     *
     * A local row that is newer wins and is left alone - it still has an outbox
     * entry waiting, so the server will catch up on the next push.
     */
    async applyServerRecord(record: any): Promise<boolean> {
      const db = await getDatabase();
      const incoming = toRow(record);
      const existing = await db.getFirstAsync<TRow>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [incoming.id],
      );

      if (existing && isAtOrAfter(existing.updated_at, incoming.updated_at)) {
        return false;
      }

      const { sql, values } = upsertSql(mergeLocalColumns(existing, incoming));
      await db.runAsync(sql, values);
      return true;
    },

    /**
     * PUSH echo: the server accepted our payload and returned what it stored.
     *
     * We take its version verbatim rather than keeping the device's, because
     * the server stamps its own `updatedAt`. Skip this and the local row keeps
     * a timestamp the server never had, so every later pull sees a difference
     * and re-applies the same record forever.
     *
     * `pushedUpdatedAt` is the stamp that was in the payload. If the row no
     * longer carries it the user edited the record while the push was in
     * flight: that newer edit is left alone, still unsynced, with its own
     * outbox entry queued for the next run. Comparing for equality rather than
     * order keeps this decision independent of any clock.
     */
    async adoptPushResult(record: any, pushedUpdatedAt: string): Promise<boolean> {
      const db = await getDatabase();
      const incoming = toRow(record);
      const existing = await db.getFirstAsync<TRow>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [incoming.id],
      );

      if (existing && existing.updated_at !== pushedUpdatedAt) {
        return false;
      }

      const { sql, values } = upsertSql(mergeLocalColumns(existing, incoming));
      await db.runAsync(sql, values);
      return true;
    },
  };
}

/**
 * Combines a server record with the device-only columns of the row it replaces.
 *
 * `local_path` is the one that matters: it is where the PDF lives on *this*
 * device, so the server has no column for it and always sends null. Dropping it
 * would leave a downloaded book unreadable after the next sync.
 */
function mergeLocalColumns<TRow extends RowShape>(
  existing: TRow | null,
  incoming: TRow,
): TRow {
  if (!existing) return { ...incoming, synced: 1 };

  const merged: TRow = { ...existing, ...incoming, synced: 1 };
  if ('local_path' in existing) {
    (merged as any).local_path =
      (existing as any).local_path ?? (incoming as any).local_path ?? null;
  }
  return merged;
}
