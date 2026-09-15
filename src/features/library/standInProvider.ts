// src/features/library/standInProvider.ts
// The `LibraryProvider` this repo ships TODAY.
//
// `openBook`/`openReader` are STILL inert — the licence gate and the real
// `Reader` route both exist elsewhere in this app now, but wiring THIS seam
// to them (so a bookmark's own "Read" action actually opens the reader
// instead of throwing `ReaderUnavailableError`) is real integration work of
// its own and out of scope for the change that touched this file — see
// `LibraryProviderContext.ts`'s own header: nothing wraps the app root in a
// real provider yet, so this stand-in is still what every `useLibraryProvider()`
// call sees.
//
// `listBookmarks` DOES read the real store now (`bookmarkTable`,
// `src/features/sync/stores/bookmarkStore.ts`) — the sync layer this file's
// own header used to say wasn't merged in yet has been, and there was no
// reason left for this seam to keep reading a dead stand-in the Library
// screen itself stopped reading in the same change. `listDownloads` was
// already reading the real device-local `downloadStore`, so it is unchanged.
import { bookmarkFromRow } from '@/screens/LibraryScreen.holdings';
import { bookmarkTable } from '@/features/sync/stores/bookmarkStore';
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

  async listBookmarks(userId: string): Promise<BookmarkView[]> {
    // Tombstones already dropped by `listActive`'s own SQL (`is_deleted = 0`);
    // `sortedBookmarks` filters again downstream, which stays harmless and
    // correct. A row whose locator fails to parse is dropped, not surfaced —
    // see `bookmarkFromRow`'s own comment.
    const rows = await bookmarkTable.listActive(userId);
    const bookmarks: BookmarkView[] = [];
    for (const row of rows) {
      const bookmark = bookmarkFromRow(row);
      if (bookmark !== null) bookmarks.push(bookmark);
    }
    return bookmarks;
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
