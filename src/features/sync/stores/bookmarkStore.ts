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
  async addForPage(page: number, name?: string): Promise<BookmarkRow> {
    const locator: Locator = { type: 'pdf', page, offset: 0 };
    const now = nowIso();
    const row: BookmarkRow = {
      id: newId(),
      user_id: USER_ID,
      book_id: BOOK_ID,
      chapter_id: `page-${page}`,
      locator: JSON.stringify(locator),
      name: name ?? `Page ${page}`,
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

export function parseLocator(json: string): Locator | null {
  try {
    return JSON.parse(json) as Locator;
  } catch {
    return null;
  }
}
