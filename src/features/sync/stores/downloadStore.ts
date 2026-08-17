import { getDatabase, newId, nowIso, toInt } from '../localDb/database';
import { downloadMapper } from '../localDb/mappers';
import type { DownloadRow } from '../localDb/types';
import { BOOK_ID, USER_ID } from '../syncConfig';
import { createSyncableTable, withWriteLock } from './syncableTable';

export const downloadTable = createSyncableTable<DownloadRow>({
  table: 'downloads',
  entityType: 'downloads',
  toServer: downloadMapper.toServer,
  toRow: downloadMapper.toRow,
});

export const downloadStore = {
  ...downloadTable,

  list(): Promise<DownloadRow[]> {
    return downloadTable.listActive(USER_ID, BOOK_ID);
  },

  async currentForBook(): Promise<DownloadRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<DownloadRow>(
      `SELECT * FROM downloads
        WHERE user_id = ? AND book_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [USER_ID, BOOK_ID],
    );
  },

  /**
   * Records a completed download. `localPath` is stored here and only here -
   * the outbox payload omits it because the path means nothing on another device.
   */
  async recordCompleted(localPath: string, format = 'PDF'): Promise<DownloadRow> {
    return withWriteLock(async () => {
      const existing = await this.currentForBook();
      const now = nowIso();
      const row: DownloadRow = {
        id: existing?.id ?? newId(),
        user_id: USER_ID,
        book_id: BOOK_ID,
        format,
        local_path: localPath,
        status: 'COMPLETED',
        is_valid: 1,
        downloaded_at: now,
        updated_at: now,
        is_deleted: 0,
        synced: 0,
      };
      return downloadTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', { locked: true });
    });
  },

  /**
   * Records what the change feed said about this book's entitlement.
   *
   * ADVISORY, and that word is load-bearing. It is NOT the gate: Encryption decides whether a
   * book opens, from the licence it holds, and `getBook()` throws regardless of what this column
   * says. This exists so the UI can explain a locked book, and so a revocation is remembered
   * across a restart. Anything that gates reading on this column reintroduces two independent
   * gates that can disagree, which is what review rejected.
   *
   * Deliberately NOT `saveLocal`: a raw column write with no outbox entry, leaving `updated_at`
   * and `synced` untouched. The verdict came from the server, so queueing it for push would echo
   * the server's own state back at it - and a bumped `updated_at` would make this row win the
   * next Last-Write-Wins comparison against a genuinely newer server record, losing whatever
   * else that record carried.
   *
   * Every row for the book is updated, not just the newest, so a device holding more than one
   * format cannot end up half revoked.
   *
   * Returns whether anything actually changed, which is how the caller tells a revocation worth
   * announcing from a re-confirmation of what it already knew.
   */
  async setValidity(bookId: string, isValid: boolean): Promise<boolean> {
    const db = await getDatabase();
    const flag = toInt(isValid);
    const result = await db.runAsync(
      `UPDATE downloads SET is_valid = ?
        WHERE user_id = ? AND book_id = ? AND is_valid IS NOT ?`,
      [flag, USER_ID, bookId, flag],
    );
    return (result?.changes ?? 0) > 0;
  },

  /**
   * What the last entitlement check said about this book - for UI messaging only.
   *
   * A device with no downloads row has nothing to say, so the answer is `true`: the reader shows
   * its own "no book yet" state and there is no entitlement question to answer. Only an explicit
   * `is_valid = 0` reports false.
   *
   * Name kept from the earlier attempt, but the meaning has changed and the change is the whole
   * point: this used to be "the column the reader gates on", and it is now "the column the
   * reader explains itself with".
   */
  async isBookValid(bookId = BOOK_ID): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DownloadRow>(
      `SELECT * FROM downloads
        WHERE user_id = ? AND book_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [USER_ID, bookId],
    );
    return row ? row.is_valid !== 0 : true;
  },

  /** Book ids this device actually holds - the feed is filtered to these. */
  async downloadedBookIds(): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ book_id: string }>(
      `SELECT DISTINCT book_id FROM downloads WHERE user_id = ? AND is_deleted = 0`,
      [USER_ID],
    );
    return rows.map((r) => r.book_id);
  },

  remove(id: string): Promise<void> {
    return downloadTable.softDeleteLocal(id);
  },
};
