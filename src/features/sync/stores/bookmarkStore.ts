import { newId, nowIso } from '../localDb/database';
import { bookmarkMapper } from '../localDb/mappers';
import type { BookmarkRow, Locator } from '../localDb/types';
import { BOOK_ID, USER_ID } from '../syncConfig';
import { createSyncableTable } from './syncableTable';

export const bookmarkTable = createSyncableTable<BookmarkRow>({
  table: 'bookmarks',
  entityType: 'bookmarks',
  toServer: bookmarkMapper.toServer,
  toRow: bookmarkMapper.toRow,
});

export const bookmarkStore = {
  ...bookmarkTable,

  list(): Promise<BookmarkRow[]> {
    return bookmarkTable.listActive(USER_ID, BOOK_ID);
  },

  /**
   * PDF bookmarks use a page locator. chapter_id doubles as the human-facing
   * section id, which for this sample book is simply "page-N".
   */
  addForPage(page: number, name?: string): Promise<BookmarkRow> {
    return this.add({ type: 'PDF', page, offset: 0 }, `page-${page}`, name ?? `Page ${page}`);
  },

  /** EPUB bookmarks anchor by CFI - a reflowable book has no stable page number. */
  addForCfi(cfi: string, chapterId?: string, name?: string): Promise<BookmarkRow> {
    return this.add({ type: 'EPUB', cfi }, chapterId ?? null, name);
  },

  async add(
    locator: Locator,
    chapterId: string | null,
    name?: string,
  ): Promise<BookmarkRow> {
    const now = nowIso();
    const row: BookmarkRow = {
      id: newId(),
      user_id: USER_ID,
      book_id: BOOK_ID,
      chapter_id: chapterId,
      locator: JSON.stringify(locator),
      name: name ?? null,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
      synced: 0,
    };
    return bookmarkTable.saveLocal(row, 'CREATE');
  },

  remove(id: string): Promise<void> {
    return bookmarkTable.softDeleteLocal(id);
  },
};

/**
 * Re-exported from the mappers so bookmarks and highlights read locators the same way -
 * including the read-time upgrade for rows written with the old lowercase discriminants.
 */
export { parseLocator } from '../localDb/mappers';
