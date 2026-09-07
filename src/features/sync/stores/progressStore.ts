import { getDatabase, nowIso } from '../localDb/database';
import { parseLocator, progressMapper } from '../localDb/mappers';
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
 * Deterministic id for the per-(user, book) progress singleton - same reasoning as
 * `personalizationId`/`accessibilityId`: a device-minted UUID is wrong for a record the backend
 * enforces as one-per-(userId, bookId) (a compound unique index, confirmed against the real
 * backend - see `syncEngine.integration.test.ts`'s "push: progress" describe block). A random
 * id meant a device whose local `progress` row was ever lost (reinstall, a local reset, or this
 * app's own local-SQLite-wipe tooling) would mint a fresh id on its next save and permanently
 * 409 against whatever id the OLDER row still occupies server-side - `GET` on the fresh id
 * 404s (nothing was ever stored under it), and `POST` collides with the compound index. Deriving
 * the id from the scope makes every device (and every reinstall) agree on the same slot, so a
 * stale local state becomes an ordinary update-or-create instead of an unrecoverable conflict.
 */
export const progressId = (userId: string, bookId: string) => `progress-${userId}-${bookId}`;

/**
 * Reading position. There is exactly one live progress row per user + book, so
 * saving a new page updates that row rather than appending a new one.
 */
export const progressStore = {
  ...progressTable,

  /**
   * `userId`/`bookId` default to the prototype's single hardcoded constants - every current
   * caller gets identical behaviour to before. A caller that actually knows the signed-in user
   * and/or the open book (multi-user/multi-book capable) should pass them explicitly instead of
   * relying on the defaults.
   */
  async current(userId: string = USER_ID, bookId: string = BOOK_ID): Promise<ProgressRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<ProgressRow>(
      `SELECT * FROM progress
        WHERE user_id = ? AND book_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId, bookId],
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
  async savePosition(
    locator: Locator,
    bookId: string = BOOK_ID,
    userId: string = USER_ID,
  ): Promise<ProgressRow> {
    return withWriteLock(async () => {
      const existing = await this.current(userId, bookId);
      const row: ProgressRow = {
        id: existing?.id ?? progressId(userId, bookId),
        user_id: userId,
        book_id: bookId,
        // AUDIO has no page and must not inherit a stale/leftover offset from a prior locator on
        // this row - see the AUDIO variant's own comment in annotations.ts. EPUB has no true
        // offset either, but keeps the fallback: `offset` is a lower bound for it, not garbage.
        offset:
          locator.type === 'PDF'
            ? locator.page
            : locator.type === 'AUDIO'
              ? 0
              : (existing?.offset ?? 0),
        locator: JSON.stringify(locator),
        updated_at: nowIso(),
        is_deleted: 0,
        synced: 0,
      };
      return progressTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', { locked: true });
    });
  },

  /** Convenience for the PDF path, which addresses by page. */
  savePage(page: number, bookId: string = BOOK_ID, userId: string = USER_ID): Promise<ProgressRow> {
    return this.savePosition({ type: 'PDF', page }, bookId, userId);
  },

  /**
   * The stored position, preferring the Locator and falling back to `offset` for rows written
   * before the column existed (where a PDF page is all there ever was) - and for a `locator`
   * that fails to parse as one of today's shapes, which gets the same treatment rather than
   * handing a caller raw untyped JSON. `parseLocator` does the validation; a bare `JSON.parse`
   * cast would trust the column's shape at compile time even though nothing enforces it on the
   * data actually sitting in SQLite.
   */
  async currentLocator(userId: string = USER_ID, bookId: string = BOOK_ID): Promise<Locator | null> {
    const row = await this.current(userId, bookId);
    if (!row) return null;
    // null locator means a legacy row written before the column existed — those are always PDF,
    // so the offset fallback is correct. A non-null but corrupt locator is a different case:
    // we don't know the format, so returning null lets callers start from the beginning rather
    // than sending a reader to page 0 of the wrong format.
    return parseLocator(row.locator) ?? (row.locator == null ? { type: 'PDF', page: row.offset } : null);
  },
};
