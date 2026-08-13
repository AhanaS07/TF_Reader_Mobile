import { getDatabase, newId, nowIso } from '../localDb/database';
import { progressMapper } from '../localDb/mappers';
import type { Locator, ProgressRow } from '../localDb/types';
import { BOOK_ID, USER_ID } from '../syncConfig';
import { createSyncableTable, withWriteLock } from './syncableTable';

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
export const progressStore = {
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

  /**
   * Called whenever the reader lands on a different position.
   *
   * Takes a {@link Locator}, not a bare page number: a reflowable EPUB has no stable integer
   * offset - the same character sits at a different offset at a different font size or
   * viewport - so an int cannot restore its position. `offset` is still written, because the
   * Day-1 freeze and the Mongo document both carry it and it is exactly right for a PDF; for
   * an EPUB it is a lower bound at best, which is why `locator` is the authoritative value.
   *
   * The whole read-current-row-then-create-or-update sequence runs under `withWriteLock`:
   * without it, two overlapping calls (e.g. two rapid page turns) would each see "no row yet"
   * and each create their own, silently duplicating the one-row-per-book invariant this store
   * documents above.
   */
  async savePosition(locator: Locator): Promise<ProgressRow> {
    return withWriteLock(async () => {
      const existing = await this.current();
      const row: ProgressRow = {
        id: existing?.id ?? newId(),
        user_id: USER_ID,
        book_id: BOOK_ID,
        offset: locator.type === 'PDF' ? locator.page : (existing?.offset ?? 0),
        locator: JSON.stringify(locator),
        updated_at: nowIso(),
        is_deleted: 0,
        synced: 0,
      };
      return progressTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', { locked: true });
    });
  },

  /** Convenience for the PDF path, which addresses by page. */
  savePage(page: number): Promise<ProgressRow> {
    return this.savePosition({ type: 'PDF', page });
  },

  /**
   * The stored position, preferring the Locator and falling back to `offset` for rows written
   * before the column existed (where a PDF page is all there ever was).
   */
  async currentLocator(): Promise<Locator | null> {
    const row = await this.current();
    if (!row) return null;
    if (row.locator) return JSON.parse(row.locator) as Locator;
    return { type: 'PDF', page: row.offset };
  },
};
