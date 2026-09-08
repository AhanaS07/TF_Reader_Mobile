// src/features/library/standInProvider.ts
// The `LibraryProvider` this repo ships TODAY, before Team 4's stack merges in.
//
// Reads come from this repo's own device-local stores; opening is deliberately
// inert. This exists so the Library screen can be wired to `ports.ts` NOW and
// keep working exactly as it does today — the merge then swaps this object for a
// real adapter over `downloadTable`/`bookmarkTable`/`openBook`/`Reader` and the
// screen is untouched. See INTEGRATION.md.
import { useBookmarkStore, liveBookmarks } from '@store/bookmarkStore';
import { useDownloadStore } from '@store/downloadStore';

import type { BookmarkView, ContentFormat, DownloadView, LibraryProvider } from './ports';

/**
 * Thrown by `openBook` in this build. The reader, the licence gate and the
 * content store are Team 4's and not in this repo, so there is nothing to open
 * yet — the screen catches this and keeps the row inert rather than pretending
 * to open a book it cannot. At merge the real `openBook` replaces this and the
 * catch turns into real error copy (mapping Team 4's `DownloadFailure.code`).
 */
export class ReaderUnavailableError extends Error {
  constructor() {
    super('Reading is not available in this build yet.');
    this.name = 'ReaderUnavailableError';
    Object.setPrototypeOf(this, ReaderUnavailableError.prototype);
  }
}

/**
 * `userId` is ACCEPTED BUT IGNORED here: these stores are device-local and not
 * user-scoped (a book on this phone is on this phone). The parameter is on the
 * port because Team 4's `listActive(userId, …)` needs it, so keeping it in the
 * signature is what makes the merge a no-op for the screen's call site.
 */
export const standInLibraryProvider: LibraryProvider = {
  async listDownloads(_userId: string): Promise<DownloadView[]> {
    // Mapped to fresh objects rather than handed out by reference, so a caller
    // cannot mutate store state outside a `set`. `format`/`isValid` are unknown
    // to this store and left undefined — the shelf already tolerates that.
    return useDownloadStore.getState().downloads.map((record) => ({
      itemId: record.itemId,
      downloadedAt: record.downloadedAt,
      ...(record.sizeBytes === undefined ? {} : { sizeBytes: record.sizeBytes }),
    }));
  },

  async listBookmarks(_userId: string): Promise<BookmarkView[]> {
    // Tombstones dropped here, matching Team 4's `listActive` (which filters
    // `is_deleted = 0` in SQL). The screen filters again in `sortedBookmarks`,
    // which stays harmless and correct.
    return liveBookmarks(useBookmarkStore.getState().bookmarks);
  },

  // Args are unused here but are the seam the real impl consumes.
  async openBook(_itemId: string, _format: ContentFormat): Promise<void> {
    throw new ReaderUnavailableError();
  },

  openReader(_target): void {
    // No-op: there is no `Reader` route in this repo yet. At merge this becomes
    // `navigation.navigate('Reader', { bookId, format, initialTarget })`.
  },
};
