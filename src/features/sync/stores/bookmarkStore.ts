import { getDatabase, newId, nowIso } from '../localDb/database';
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

  /**
   * `userId`/`bookId` default to the prototype's single hardcoded constants - every current
   * caller gets identical behaviour to before. A caller that actually knows the signed-in user
   * and/or the open book (multi-user/multi-book capable) should pass them explicitly instead of
   * relying on the defaults.
   */
  list(userId: string = USER_ID, bookId: string = BOOK_ID): Promise<BookmarkRow[]> {
    return bookmarkTable.listActive(userId, bookId);
  },

  /**
   * PDF bookmarks use a page locator. chapter_id doubles as the human-facing
   * section id, which for this sample book is simply "page-N".
   */
  addForPage(
    page: number,
    name?: string,
    bookId: string = BOOK_ID,
    userId: string = USER_ID,
  ): Promise<BookmarkRow> {
    return this.add(
      { type: 'PDF', page, offset: 0 },
      `page-${page}`,
      name ?? `Page ${page}`,
      bookId,
      userId,
    );
  },

  /** EPUB bookmarks anchor by CFI - a reflowable book has no stable page number. */
  addForCfi(
    cfi: string,
    chapterId?: string,
    name?: string,
    bookId: string = BOOK_ID,
    userId: string = USER_ID,
  ): Promise<BookmarkRow> {
    return this.add({ type: 'EPUB', cfi }, chapterId ?? null, name, bookId, userId);
  },

  /**
   * Idempotent on `locator`: a device already holding an active bookmark at this exact
   * position returns it unchanged rather than creating a second one - same reasoning as
   * highlightStore.add(). `chapter_id` is not part of the match: it is metadata derived from
   * the locator, not an independent identity, so matching on locator alone is sufficient.
   */
  async add(
    locator: Locator,
    chapterId: string | null,
    name?: string,
    bookId: string = BOOK_ID,
    userId: string = USER_ID,
  ): Promise<BookmarkRow> {
    const locatorJson = JSON.stringify(locator);

    const db = await getDatabase();
    const existing = await db.getFirstAsync<BookmarkRow>(
      `SELECT * FROM bookmarks
        WHERE user_id = ? AND book_id = ? AND locator = ? AND is_deleted = 0
        LIMIT 1`,
      [userId, bookId, locatorJson],
    );
    if (existing) return existing;

    const now = nowIso();
    const row: BookmarkRow = {
      id: newId(),
      user_id: userId,
      book_id: bookId,
      chapter_id: chapterId,
      locator: locatorJson,
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

  /**
   * Rename an existing bookmark in place: change only `name`, keep the id, locator and everything
   * else. A same-id UPDATE through the shared `saveLocal` primitive - the row is re-stamped
   * (`synced = 0`) and an UPDATE outbox op is enqueued in one transaction, exactly like `add`'s CREATE.
   *
   * A missing or already-tombstoned row is a no-op returning null: there is nothing live to rename, and
   * re-writing a tombstone's name would be meaningless (and could fight a delete still propagating). No
   * dedup guard like `add`'s is needed - the locator does not change, so a rename can never create a
   * second row at a position.
   *
   * NOTE (Sync ownership - Karthik): this store method is the local half. The delete-vs-edit race an
   * update-in-place op reintroduces is settled engine-side and is NOT this method's to re-decide:
   * `applyServerRecord` (`syncableTable.ts`) makes deletes sticky regardless of timestamp, so a late
   * rename cannot resurrect a bookmark another device deleted, and rename-vs-rename stays plain LWW
   * (later name wins). Pinned by `syncableTable.test.ts` and this file's "delete-vs-rename
   * (cross-device)" block.
   */
  async rename(id: string, name: string): Promise<BookmarkRow | null> {
    const existing = await bookmarkTable.findById(id);
    if (!existing || existing.is_deleted === 1) return null;
    const renamed: BookmarkRow = { ...existing, name, updated_at: nowIso() };
    return bookmarkTable.saveLocal(renamed, 'UPDATE');
  },
};

/**
 * Re-exported from the mappers so bookmarks and highlights read locators the same way -
 * including the read-time upgrade for rows written with the old lowercase discriminants.
 */
export { parseLocator } from '../localDb/mappers';
