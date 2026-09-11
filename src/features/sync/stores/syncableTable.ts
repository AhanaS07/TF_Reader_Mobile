import { getDatabase, nowIso } from '../localDb/database';
import type { EntityType, OutboxOperation } from '../localDb/types';
import { outboxStore } from './outboxStore';
import { parseFieldTimestamps, stringifyFieldTimestamps } from './fieldTimestamps';
import { requestSync } from '../syncTrigger';

interface SyncableTableOptions<TRow> {
  table: string;
  entityType: EntityType;
  /** Maps a local row to the camelCase shape the server expects. */
  toServer: (row: TRow) => Record<string, unknown>;
  /** Maps a server record to a local row. */
  toRow: (record: any) => TRow;
  /**
   * Column names eligible for field-level merge, for a multi-field singleton row where two
   * devices commonly edit different fields between syncs (personalization, accessibility).
   * Omitted entirely for every other table, which keeps the original whole-row
   * Last-Write-Wins behaviour byte-for-byte - this option is additive, not a replacement.
   */
  mergeFields?: readonly string[];
}

interface RowShape {
  id: string;
  updated_at: string;
  is_deleted: number;
  synced: number;
  /** Base version for conflict detection - see {@link LocalSyncFields}. */
  server_updated_at?: string | null;
}

interface FieldMergeRowShape extends RowShape {
  field_updated_at: string;
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
  const { table, entityType, toServer, toRow, mergeFields } = options;

  /**
   * Live-change notification, ONE PER TABLE (closed over here, not shared across `bookmarks` vs
   * `highlights` vs ...). Mirrors `prefsStore.subscribe`'s shape and its own documented gap:
   * that store's header comment says outright "a prefs row pulled by Sync from the server does
   * not pass through here... if that path ever needs to drive a live re-apply it must notify too
   * — call it out then rather than assuming this covers it." This is that call-out, for bookmarks:
   * a delete (or any other edit) that arrives via `pull()`'s `applyServerRecord` now notifies too,
   * not just a local `saveLocal` edit — so a panel already open on this book can reload instead of
   * showing a bookmark that was deleted on another device (or directly against the backend) until
   * the book happens to be reopened. No payload on purpose: every current subscriber (Reader's
   * bookmarks-panel effect) already re-fetches its own book-scoped list on any signal, and a
   * generic "something in this table changed" is enough to trigger that — see `bookmarkStore.ts`'s
   * re-export and `ReaderScreen.tsx`'s subscribing effect for the one call site that needs it today.
   */
  const changeListeners = new Set<() => void>();

  function notifyChanged(): void {
    // A throwing subscriber must not fail the write that already succeeded — same reasoning as
    // prefsStore.ts's own `notify`. Snapshot first so a listener that unsubscribes mid-notify
    // does not skip a sibling.
    for (const listener of [...changeListeners]) {
      try {
        listener();
      } catch {
        // Swallowed deliberately — one bad subscriber must not take out the others or the caller.
      }
    }
  }

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

    /** Set only for a field-merge table - see {@link SyncableTableOptions.mergeFields}. */
    mergeFields,

    /**
     * Subscribe to this table's changes — a local edit (`saveLocal`) or a pulled server change
     * that actually applied (`applyServerRecord` returning `true`). See `changeListeners`'s own
     * doc above for why this exists and what it deliberately does not do (no payload; a listener
     * that needs to know WHICH row changed re-reads its own scoped list). Returns an unsubscribe.
     */
    subscribe(listener: () => void): () => void {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    /**
     * Rebuilds the wire payload from a row currently on disk - see `push()`'s field-merge path.
     *
     * Takes `any`, not `TRow`, on purpose: every other method called across the heterogeneous
     * `TABLES` map (`applyServerRecord`, `adoptPushResult`, ...) already takes `any` for the
     * same reason - a parameter typed by the per-table generic breaks TypeScript's ability to
     * treat `TABLES[op.entity_type]` as one clean union when calling across all six tables.
     */
    toServerPayload(row: any): Record<string, unknown> {
      return toServer(row);
    },

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
        // Outside the transaction: this only schedules a future sync attempt, it is not part of
        // the write itself, and must run even if the caller never awaits push draining it.
        requestSync();
        notifyChanged();
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

    /**
     * Raw hard delete, no tombstone, no outbox entry. For a row that never actually reached the
     * server under this id - a locally-generated duplicate whose CREATE lost to a server-side
     * uniqueness constraint (see `syncEngine.ts`'s locator-collision handling). A tombstone would
     * be wrong here: nothing else has ever seen this id, so there is nothing to propagate a
     * delete to - the row simply should never have existed as a separate document.
     */
    async hardDeleteLocal(id: string): Promise<void> {
      const db = await getDatabase();
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
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
     * PULL: apply a record the server sent us.
     *
     * Whole-row Last-Write-Wins by default: a local row that is newer wins and is left alone -
     * it still has an outbox entry waiting, so the server will catch up on the next push.
     *
     * With `mergeFields` set, this instead merges field by field - see `mergeFieldLevel` below.
     */
    async applyServerRecord(record: any): Promise<boolean> {
      const db = await getDatabase();
      const incoming = toRow(record);
      const existing = await db.getFirstAsync<TRow>(
        `SELECT * FROM ${table} WHERE id = ?`,
        [incoming.id],
      );

      if (mergeFields) {
        const merged = mergeFieldLevel(
          existing as FieldMergeRowShape | null,
          incoming as unknown as FieldMergeRowShape,
          mergeFields,
        );
        if (!merged.changed) return false;

        // Outbox refresh for a preserved pending edit (merged.row.synced === 0) is deliberately
        // NOT done here - see syncEngine.ts's pull(). This function is also called by
        // serverHasDiverged() DURING an active push for this exact row, which already owns
        // rebuilding the payload and clearing the outbox once send() succeeds; enqueuing here
        // too would insert a second outbox row that push()'s own `outboxStore.remove([op.id])`
        // (keyed on the ORIGINAL op's id) would never find and clean up.
        const { sql, values } = upsertSql(merged.row as unknown as TRow);
        await db.runAsync(sql, values);
        notifyChanged();
        return true;
      }

      // Deletes are STICKY, regardless of timestamp - once either side has deleted this record,
      // it stays deleted. Without this, a same-id update-in-place (e.g. bookmarkStore.rename())
      // could resurrect a row another device deleted, just by carrying a later stamp than the
      // delete - the exact race the original create-and-delete-only design (union via distinct
      // ids) never had to consider. See READER_BOOKMARKS_WIRING.md's "Real rename op" open item.
      //
      // A tombstone already held locally rejects ANY incoming record outright (nothing to
      // change - includes another delete arriving late, which is a no-op here). A live local row
      // meeting an incoming delete applies it unconditionally, skipping the timestamp compare
      // below entirely: this is "deletes win", not "the newer write wins and happens to be a
      // delete" - a delete that is chronologically OLDER than a rename still must not be
      // out-voted, or the two directions of this guard would contradict each other.
      if (existing?.is_deleted === 1) {
        return false;
      }
      if (existing && incoming.is_deleted !== 1 && isAtOrAfter(existing.updated_at, incoming.updated_at)) {
        return false;
      }

      const { sql, values } = upsertSql(mergeLocalColumns(existing, incoming));
      await db.runAsync(sql, values);
      notifyChanged();
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
 * PULL / push-conflict merge for a field-merge table: each field keeps whichever side touched
 * it most recently, instead of the newer ROW replacing the other wholesale.
 *
 * This is what fixes the whole-row-LWW failure mode for a multi-field singleton: device A
 * changes theme, device B (still on an older base) changes font size and syncs later - under
 * whole-row LWW, B's newer row would silently revert A's theme change even though the two
 * edits never touched the same field. Comparing per field means each edit survives.
 *
 * Four cases per field, not one comparison, because the two sides can each independently have
 * or lack an explicit stamp for it:
 *
 *   - BOTH stamped: compare the two field timestamps directly.
 *   - Local stamped, remote not: remote's client never touched this field, so its value is
 *     just whatever it was carrying already - it must not overwrite a knowingly-fresher local
 *     edit just because the remote ROW happens to be newer for some unrelated reason.
 *   - Remote stamped, local not: local never touched this field, so there is nothing local to
 *     protect - but comparing against the row's own `updated_at` would be wrong, because that
 *     bumps on every edit to ANY field, making an untouched field look "just changed" the
 *     moment something else on the row is. Comparing against `server_updated_at` (the last
 *     point this device is known to have agreed with the server) is stable across unrelated
 *     local edits and answers the right question: "has the server told us something new about
 *     this field since we last synced?"
 *   - NEITHER stamped: the pre-migration case, or a field nothing has ever individually
 *     touched on either side. Falls back to whole-row `updated_at` - exactly the original
 *     whole-row LWW guard - which is why an upgraded row behaves identically to before until
 *     something starts recording per-field times again.
 */
function mergeFieldLevel<TRow extends FieldMergeRowShape>(
  existing: TRow | null,
  incoming: TRow,
  fields: readonly string[],
): { row: TRow; changed: boolean } {
  if (!existing) return { row: { ...incoming, synced: 1 }, changed: true };

  const existingTimes = parseFieldTimestamps(existing.field_updated_at);
  const incomingTimes = parseFieldTimestamps(incoming.field_updated_at);

  const merged: any = { ...existing };
  const mergedTimes: Record<string, string> = { ...existingTimes };
  let changed = false;
  // Whether the merged row keeps a field the incoming record does NOT carry the same value for
  // - i.e. the server's own document, whatever pushed `incoming`, is missing something this
  // device now knows. Tracked separately from `changed` (which only means "adopted something
  // FROM incoming") because it is the opposite direction: it means incoming is stale relative to
  // the merge, not that local was.
  let divergesFromIncoming = false;

  for (const field of fields) {
    const localTime = existingTimes[field];
    const remoteTime = incomingTimes[field];

    let remoteWins: boolean;
    if (localTime !== undefined && remoteTime !== undefined) {
      remoteWins = isAfter(remoteTime, localTime);
    } else if (localTime !== undefined) {
      remoteWins = false;
    } else if (remoteTime !== undefined) {
      remoteWins = isAfter(remoteTime, existing.server_updated_at ?? existing.updated_at);
    } else {
      remoteWins = isAfter(incoming.updated_at, existing.updated_at);
    }

    if (remoteWins) {
      merged[field] = (incoming as any)[field];
      mergedTimes[field] = remoteTime ?? incoming.updated_at;
      changed = true;
    } else if (merged[field] !== (incoming as any)[field]) {
      divergesFromIncoming = true;
    }
  }

  // If nothing changed (remote won no fields), reject the stale incoming record.
  if (!changed) return { row: existing, changed: false };

  merged.field_updated_at = stringifyFieldTimestamps(mergedTimes);
  merged.updated_at = isAfter(incoming.updated_at, existing.updated_at)
    ? incoming.updated_at
    : existing.updated_at;
  // `existing.synced === 0` (a pending local edit) always survives the merge, as before. NEW:
  // also force 0 when the merge kept a field `incoming` did not carry - otherwise that field
  // lives only on this device and the server's own copy of it goes stale until some unrelated
  // edit happens to carry a fresh value along with it. `pull()` already enqueues an outbox
  // refresh whenever the merged row comes back `synced: 0`; this is the only change needed to
  // make that existing mechanism cover the "no pending edit, pure remote-wins-mostly merge" case
  // too, instead of just "there was already a pending edit".
  merged.synced = existing.synced === 0 || divergesFromIncoming ? 0 : 1;
  merged.server_updated_at = incoming.updated_at;
  return { row: merged as TRow, changed: true };
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
