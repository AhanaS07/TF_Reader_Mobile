import { getDatabase, newId, nowIso } from '../db/database';
import { progressMapper } from '../db/mappers';
import type { ProgressRow } from '../db/types';
import { BOOK_ID, USER_ID } from '../config';
import { createSyncableTable } from './syncableTable';

export const progressTable = createSyncableTable<ProgressRow>({
  table: 'progress',
  entityType: 'progress',
  toServer: progressMapper.toServer,
  toRow: progressMapper.toRow,
});

/**
 * Reading position. There is exactly one live progress row per user + book, so
 * saving a new page updates that row rather than appending a new one.
 */
export const progressRepository = {
  ...progressTable,

  async current(): Promise<ProgressRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<ProgressRow>(
      `SELECT * FROM progress
        WHERE user_id = ? AND book_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [USER_ID, BOOK_ID],
    );
  },

  /** Called whenever the reader lands on a different page. */
  async savePosition(page: number): Promise<ProgressRow> {
    const existing = await this.current();
    const row: ProgressRow = {
      id: existing?.id ?? newId(),
      user_id: USER_ID,
      book_id: BOOK_ID,
      offset: page,
      updated_at: nowIso(),
      is_deleted: 0,
      synced: 0,
    };
    return progressTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE');
  },
};
