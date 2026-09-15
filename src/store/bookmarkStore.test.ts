// src/store/bookmarkStore.test.ts
//
// The store is a module singleton, so state leaks between tests unless it is
// reset — same reasoning as recentSearchesStore.test.ts.
import type { Bookmark } from '@/shared/contracts';

import { liveBookmarks, useBookmarkStore } from './bookmarkStore';

const AT = 1_700_000_000_000;

function aBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm_1',
    userId: 'user_1',
    bookId: 'item_42',
    locator: { type: 'PDF', page: 12 },
    createdAt: AT,
    updatedAt: AT,
    isDeleted: false,
    synced: false,
    ...over,
  };
}

beforeEach(() => {
  useBookmarkStore.getState().clear();
});

describe('bookmarkStore', () => {
  it('keeps a bookmark it is given', () => {
    useBookmarkStore.getState().addBookmark(aBookmark());

    expect(useBookmarkStore.getState().bookmarks).toEqual([aBookmark()]);
  });

  it('keeps several bookmarks in the same book', () => {
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_1' }));
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_2' }));

    expect(useBookmarkStore.getState().bookmarks).toHaveLength(2);
  });

  // A rename is an edit to a record that already exists, not a new bookmark.
  it('upserts on id, so an edited bookmark replaces rather than duplicates', () => {
    useBookmarkStore.getState().addBookmark(aBookmark({ name: 'Chapter opener' }));
    useBookmarkStore
      .getState()
      .addBookmark(aBookmark({ name: 'The proof', updatedAt: AT + 1000 }));

    const { bookmarks } = useBookmarkStore.getState();
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.name).toBe('The proof');
    expect(bookmarks[0]?.updatedAt).toBe(AT + 1000);
  });

  it('replaces in place, leaving the order of the other records alone', () => {
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_1' }));
    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_2' }));

    useBookmarkStore.getState().addBookmark(aBookmark({ id: 'bm_1', name: 'edited' }));

    expect(useBookmarkStore.getState().bookmarks.map((b) => b.id)).toEqual(['bm_1', 'bm_2']);
  });

  // A hard delete cannot be sent to the sync layer, so it comes back on the next
  // pull from another device. The whole record stays, flagged.
  it('soft-deletes: the record is tombstoned rather than spliced out', () => {
    useBookmarkStore.getState().addBookmark(aBookmark());

    useBookmarkStore.getState().removeBookmark('bm_1', AT + 1000);

    const { bookmarks } = useBookmarkStore.getState();
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.isDeleted).toBe(true);
    // Re-stamped so the deletion wins LWW against an older edit elsewhere, and
    // marked unsynced so the sync layer knows there is something to send.
    expect(bookmarks[0]?.updatedAt).toBe(AT + 1000);
    expect(bookmarks[0]?.synced).toBe(false);
  });

  it('leaves the rest of a tombstoned record intact, so the deletion is sendable', () => {
    useBookmarkStore.getState().addBookmark(aBookmark());

    useBookmarkStore.getState().removeBookmark('bm_1', AT + 1000);

    const tombstone = useBookmarkStore.getState().bookmarks[0];
    expect(tombstone?.userId).toBe('user_1');
    expect(tombstone?.bookId).toBe('item_42');
  });

  // A tombstone needs a userId and a bookId to be sendable, and an id alone
  // carries neither — so there is nothing honest to write.
  it('does nothing for an id it has never seen', () => {
    useBookmarkStore.getState().addBookmark(aBookmark());

    useBookmarkStore.getState().removeBookmark('bm_never', AT + 1000);

    expect(useBookmarkStore.getState().bookmarks).toEqual([aBookmark()]);
  });
});

describe('liveBookmarks', () => {
  it('drops tombstones and keeps the rest', () => {
    const live = liveBookmarks([
      aBookmark({ id: 'kept' }),
      aBookmark({ id: 'gone', isDeleted: true }),
    ]);

    expect(live.map((b) => b.id)).toEqual(['kept']);
  });

  it('does not mutate the array it was given', () => {
    const records = [aBookmark({ id: 'kept' }), aBookmark({ id: 'gone', isDeleted: true })];

    liveBookmarks(records);

    expect(records).toHaveLength(2);
  });
});
