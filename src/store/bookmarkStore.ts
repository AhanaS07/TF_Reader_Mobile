// src/store/bookmarkStore.ts
// The reader's bookmarks, on this device.
//
// TYPED AGAINST THE REAL CONTRACT, NOT A LOCAL SHAPE. `Bookmark` comes from
// `@/shared/contracts` (CAP-7 Reader & Offline, owner Vaishnavi), which freezes
// the record: a `SyncRecordBase` (id, userId, updatedAt, isDeleted, synced) plus
// bookId, locator, optional chapterId and name. Declaring our own `{ bookId,
// title }` here would be a second source of truth for a shape another team has
// already frozen, and the day their repository lands the two would have to be
// reconciled row by row.
//
// THE SEAM IS THIS STORE. Their bookmarks live in SQLite, each row an
// independently synced record with LWW-on-`updatedAt` conflict resolution.
// Nothing in this repo implements that yet, so this is a local stand-in with
// the same record shape: when the real repository arrives, the Library screen
// keeps reading `Bookmark[]` and only the source changes.
//
// LWW AND TOMBSTONES ARE HONOURED EVEN THOUGH NOTHING SYNCS YET. `remove` sets
// `isDeleted` rather than splicing, and every write stamps `updatedAt` and
// clears `synced`. Writing a "simpler" local store that hard-deletes would
// produce records that cannot be handed to the sync layer without being
// rewritten — a deleted bookmark that was never tombstoned comes back on the
// next pull from another device.
//
// NOTHING WRITES TO IT YET. The reader that would create a bookmark is CAP-7's
// and is not in this repo, so the Bookmarks section renders empty today. That
// is the correct empty: this reader has bookmarked nothing here.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Bookmark } from '@/shared/contracts';
import storage from '@storage/storage';

interface BookmarkState {
  /**
   * Every bookmark this device knows about, TOMBSTONES INCLUDED. Callers that
   * render must filter through `liveBookmarks` — keeping the deleted ones in
   * state is what lets a future sync layer send the deletion.
   */
  bookmarks: Bookmark[];
  /**
   * Add or update a bookmark. Upserts on `id`, so re-saving an edited bookmark
   * (a rename) replaces the record rather than duplicating the row.
   *
   * THE CALLER STAMPS `updatedAt`, because the contract says the CLIENT stamps
   * it at EDIT time and it is the LWW comparison key — a store that stamped it
   * on write would date the record to when it was stored rather than when the
   * reader changed it, and would also mean sampling a clock in here (see
   * `downloadStore` for the same rule).
   */
  addBookmark: (bookmark: Bookmark) => void;
  /**
   * Soft-delete: tombstone the record, keep it in state, re-stamp `updatedAt`
   * so the deletion wins LWW against an older edit on another device.
   *
   * A NO-OP FOR AN UNKNOWN ID rather than inventing a tombstone out of an id
   * alone — a tombstone needs a `userId` and a `bookId` to be sendable, and
   * this store has neither for a record it has never seen.
   */
  removeBookmark: (id: string, updatedAt: number) => void;
  clear: () => void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      bookmarks: [],

      addBookmark: (bookmark) =>
        set((state) => {
          const index = state.bookmarks.findIndex((existing) => existing.id === bookmark.id);
          if (index === -1) return { bookmarks: [...state.bookmarks, bookmark] };
          // Replaced IN PLACE rather than moved to the end: order in this array
          // is arrival order and means nothing to a reader. What the shelf sorts
          // on is `updatedAt` (see `groupBookmarks`), so churning the array
          // order here would only make the persisted blob differ between two
          // devices holding identical bookmarks.
          const next = [...state.bookmarks];
          next[index] = bookmark;
          return { bookmarks: next };
        }),

      removeBookmark: (id, updatedAt) =>
        set((state) => ({
          bookmarks: state.bookmarks.map((existing) =>
            existing.id === id
              ? { ...existing, isDeleted: true, synced: false, updatedAt }
              : existing,
          ),
        })),

      clear: () => set({ bookmarks: [] }),
    }),
    {
      name: 'bookmarks',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);

/**
 * The bookmarks a reader still has — tombstones dropped.
 *
 * A FREE FUNCTION RATHER THAN A SELECTOR IN THE STORE, so it is testable
 * without a store and cannot be forgotten by a caller that reads `bookmarks`
 * directly through `useBookmarkStore((s) => s.bookmarks)`: the filter is the
 * one thing every render path needs and it lives where a test can reach it.
 */
export function liveBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return bookmarks.filter((bookmark) => !bookmark.isDeleted);
}
