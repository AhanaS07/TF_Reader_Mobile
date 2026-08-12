import { getDatabase, newId, nowIso } from '../db/database';
import { downloadMapper } from '../db/mappers';
import type { DownloadRow } from '../db/types';
import { BOOK_ID, USER_ID } from '../config';
import { createSyncableTable } from './syncableTable';

export const downloadTable = createSyncableTable<DownloadRow>({
  table: 'downloads',
  entityType: 'downloads',
  toServer: downloadMapper.toServer,
  toRow: downloadMapper.toRow,
});

export const downloadRepository = {
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

  remove(id: string): Promise<void> {
    return downloadTable.softDeleteLocal(id);
  },
};
