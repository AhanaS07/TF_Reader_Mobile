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

import {
  ReaderUnavailableError,
  type BookmarkView,
  type ContentFormat,
  type DownloadView,
  type LibraryProvider,
} from './ports';

// Re-exported so existing importers of `./standInProvider` keep working; the
// class itself lives in `ports.ts` as part of the seam contract.
export { ReaderUnavailableError };

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
