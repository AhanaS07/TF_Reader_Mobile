
import { getDatabase, newId, nowIso } from '../db/database';
import type { EntityType, OutboxOperation, OutboxRow } from '../db/types';
import { MAX_PUSH_RETRIES, USER_ID } from '../config';

/** Exponential backoff for a rejected payload: 30s, 1m, 2m, 4m, … capped at 30m. */
function backoffMs(retryCount: number): number {
  return Math.min(30_000 * 2 ** retryCount, 30 * 60_000);
}

/**
 * The push queue. Every local change to a syncable table appends a row here,
 * inside the same transaction as the change itself.
 *
 * A row is deleted only when the server has acknowledged it.
 */
export const outboxRepository = {
  /**
   * Appends an operation to the queue.
   *
   * Any operation still waiting for the same record is dropped first. Payloads
   * are full snapshots rather than deltas, so the newest one supersedes the
   * others - without this, scrolling a few pages would queue one progress
   * operation per page.
   */
  async enqueue(
    entityType: EntityType,
    entityId: string,
    operation: OutboxOperation,
    payload: unknown,
  ): Promise<string> {
    const db = await getDatabase();
    const id = newId();
    const now = nowIso();
    // DEAD is included: a new edit is a new payload, and it deserves a fresh
    // attempt rather than inheriting the old one's exhausted retry budget.
    await db.runAsync(
      `DELETE FROM outbox
        WHERE entity_type = ? AND entity_id = ? AND status IN ('PENDING', 'FAILED', 'DEAD')`,
      [entityType, entityId],
    );
    await db.runAsync(
      `INSERT INTO outbox
         (id, user_id, entity_type, entity_id, operation, payload,
          created_at, updated_at, status, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
      [id, USER_ID, entityType, entityId, operation, JSON.stringify(payload), now, now],
    );
    return id;
  },

  /**
   * Oldest first, so operations replay in the order the user made them.
   * A FAILED op is skipped until its backoff has elapsed; DEAD ops are excluded.
   */
  async listPending(limit = 200): Promise<OutboxRow[]> {
    const db = await getDatabase();
    return db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox
        WHERE status IN ('PENDING', 'FAILED')
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      [nowIso(), limit],
    );
  },

  async countPending(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outbox WHERE status IN ('PENDING', 'FAILED')`,
    );
    return row?.count ?? 0;
  },

  /** Acknowledged by the server - the operation is done and the row can go. */
  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    await db.runAsync(`DELETE FROM outbox WHERE id IN (${placeholders})`, ids);
  },

  /**
   * The server rejected the payload itself. The op stays queued behind a
   * backoff, and is parked as DEAD once it has used up its retries - a payload
   * the server will never accept must not block the queue forever.
   *
   * Transient failures (offline, timeout, 5xx) deliberately do not come here:
   * they leave the row completely untouched, so reconnecting retries at once
   * instead of waiting out a backoff it did not earn.
   */
  async markFailed(row: OutboxRow, error: string): Promise<void> {
    const db = await getDatabase();
    const retryCount = row.retry_count + 1;
    const dead = retryCount >= MAX_PUSH_RETRIES;
    await db.runAsync(
      `UPDATE outbox
          SET status = ?,
              retry_count = ?,
              last_error = ?,
              next_retry_at = ?,
              updated_at = ?
        WHERE id = ?`,
      [
        dead ? 'DEAD' : 'FAILED',
        retryCount,
        error.slice(0, 500),
        dead ? null : new Date(Date.now() + backoffMs(row.retry_count)).toISOString(),
        nowIso(),
        row.id,
      ],
    );
  },

  /** Gives every parked op one more chance - for a manual "retry failed" action. */
  async revive(): Promise<number> {
    const db = await getDatabase();
    const result = await db.runAsync(
      `UPDATE outbox
          SET status = 'PENDING', retry_count = 0, next_retry_at = NULL, updated_at = ?
        WHERE status IN ('FAILED', 'DEAD')`,
      [nowIso()],
    );
    return result.changes ?? 0;
  },

  async listAll(): Promise<OutboxRow[]> {
    const db = await getDatabase();
    return db.getAllAsync<OutboxRow>(`SELECT * FROM outbox ORDER BY created_at DESC`);
  },
};
