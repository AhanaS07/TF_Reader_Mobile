// src/features/library/standInProvider.test.ts
// The stand-in that backs the Library seam: reads real device-local/synced
// stores, refuses to open (no adapter wired to the real reader yet — see
// standInProvider.ts's own header).
import { getDatabase } from '@/features/sync/localDb/database';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { useDownloadStore } from '@store/downloadStore';

import { ReaderUnavailableError, standInLibraryProvider } from './standInProvider';

const USER = 'user_1';

// Same reset shape `src/features/sync/stores/bookmarkStore.test.ts` already
// uses: `getDatabase()` caches its instance at module scope, so a fresh test
// run gets a clean table by deleting rows, not by recreating the database.
async function resetBookmarksTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM bookmarks; DELETE FROM outbox;`);
}

beforeEach(async () => {
  useDownloadStore.getState().clear();
  await resetBookmarksTable();
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
    const bm1 = await bookmarkStore.addForPage(12, undefined, 'item_42', USER);
    const bm2 = await bookmarkStore.addForPage(88, undefined, 'item_42', USER);
    await bookmarkStore.remove(bm2.id);

    const rows = await standInLibraryProvider.listBookmarks(USER);
    expect(rows.map((b) => b.id)).toEqual([bm1.id]);
  });

  it('lists across every book for the user, not one hard-coded book', async () => {
    await bookmarkStore.addForPage(1, undefined, 'item_a', USER);
    await bookmarkStore.addForPage(1, undefined, 'item_b', USER);

    const rows = await standInLibraryProvider.listBookmarks(USER);
    expect(rows.map((b) => b.bookId).sort()).toEqual(['item_a', 'item_b']);
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
