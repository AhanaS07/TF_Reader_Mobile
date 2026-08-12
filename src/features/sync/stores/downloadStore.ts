import { getDatabase, newId, nowIso, toInt } from '../localDb/database';
import { downloadMapper } from '../localDb/mappers';
import type { DownloadRow } from '../localDb/types';
import { BOOK_ID, USER_ID } from '../syncConfig';
import { createSyncableTable } from './syncableTable';

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
    return downloadTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE');
  },

  /**
   * Records the server's licence verdict on the column the reader gates on.
   *
   * Deliberately *not* `saveLocal`: this is a raw column write with no outbox
   * entry, and `updated_at` and `synced` are left exactly as they were. The
   * verdict came from the server, so queueing it for push would only echo the
   * server's own state back at it - and a bumped `updated_at` would make this
   * row win the next Last-Write-Wins comparison against a genuinely newer
   * server record, losing whatever else that record carried.
   *
   * Every row for the book is updated, not just the newest, so a device holding
   * more than one format cannot be left half revoked.
   *
   * Returns whether anything actually changed, which is how the caller tells a
   * revocation worth announcing from a re-confirmation of what we already knew.
   */
  async setValidity(isValid: boolean): Promise<boolean> {
    const db = await getDatabase();
    const flag = toInt(isValid);
    const result = await db.runAsync(
      `UPDATE downloads SET is_valid = ?
        WHERE user_id = ? AND book_id = ? AND is_valid IS NOT ?`,
      [flag, USER_ID, BOOK_ID, flag],
    );
    return (result?.changes ?? 0) > 0;
  },

  /**
   * May the reader open this book?
   *
   * A device with no downloads row has no book to open, so the question does not
   * arise and the answer is yes - the reader shows its "no book yet" state on
   * its own. Only an explicit `is_valid = 0` blocks.
   */
  async isBookValid(): Promise<boolean> {
    const row = await this.currentForBook();
    return row ? row.is_valid !== 0 : true;
  },

  remove(id: string): Promise<void> {
    return downloadTable.softDeleteLocal(id);
  },
};
