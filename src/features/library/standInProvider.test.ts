// src/features/library/standInProvider.test.ts
// The stand-in that backs the Library seam until Team 4's stack merges: reads
// this repo's own stores, refuses to open (no reader in this build).
import type { Bookmark } from '@/shared/contracts';
import { useBookmarkStore } from '@store/bookmarkStore';
import { useDownloadStore } from '@store/downloadStore';

import { ReaderUnavailableError, standInLibraryProvider } from './standInProvider';

const USER = 'user_1';

function aBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm_1',
    userId: USER,
    bookId: 'item_42',
    locator: { type: 'PDF', page: 12 },
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    synced: false,
    ...over,
  };
}

beforeEach(() => {
  useDownloadStore.getState().clear();
  useBookmarkStore.getState().clear();
});

describe('standInLibraryProvider.listDownloads', () => {
  it('maps store records to the view-model', async () => {
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_42', downloadedAt: 5, sizeBytes: 2048 });

    expect(await standInLibraryProvider.listDownloads(USER)).toEqual([
      { itemId: 'item_42', downloadedAt: 5, sizeBytes: 2048 },
    ]);
  });

  it('omits sizeBytes when the store has none', async () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 5 });

    const [view] = await standInLibraryProvider.listDownloads(USER);
    expect(view).toEqual({ itemId: 'item_42', downloadedAt: 5 });
    expect('sizeBytes' in view).toBe(false);
  });

  it('is empty when nothing is downloaded', async () => {
    expect(await standInLibraryProvider.listDownloads(USER)).toEqual([]);
  });
});

describe('standInLibraryProvider.listBookmarks', () => {
  it('returns live bookmarks and drops tombstones', async () => {
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_1' }));
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_2' }));
    useBookmarkStore.getState().removeBookmark('bm_2', 2);

    const rows = await standInLibraryProvider.listBookmarks(USER);
    expect(rows.map((b) => b.id)).toEqual(['bm_1']);
  });
});

describe('standInLibraryProvider opening', () => {
  it('refuses to open a book — the reader is not in this build', async () => {
    await expect(standInLibraryProvider.openBook('item_42', 'PDF')).rejects.toBeInstanceOf(
      ReaderUnavailableError,
    );
  });

  it('openReader is a no-op that does not throw', () => {
    expect(() =>
      standInLibraryProvider.openReader({ itemId: 'item_42', format: 'PDF' }),
    ).not.toThrow();
  });
});
