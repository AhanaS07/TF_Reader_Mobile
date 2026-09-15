// src/store/downloadStore.ts
// The device's record of which items have been downloaded for offline reading.
//
// A RECORD, NOT THE BYTES — and the distinction is the whole file. The bytes,
// the wrapped key and the licence live in `ContentStore` (CAP-7, Abhinav), whose
// `isAvailableOffline(bookId)` is the only thing that can truly answer "can this
// reader open this book with no network". That store is a contract in
// `@/shared/contracts` and nothing implements it yet, so the Library screen has
// no way to list downloads at all. This is that list: what this device recorded
// itself downloading.
//
// THE SEAM IS THIS STORE, AND IT IS MEANT TO BE REPLACED. When `ContentStore`
// lands, the honest implementation is to reconcile against `isAvailableOffline`
// — either by having the download layer keep this list in step, or by dropping
// this store entirely and reading the content store directly. Screens depend on
// the shape below rather than on where it comes from, so that is a change here
// and not a change on the shelf.
//
// PERSISTED, UNLIKE `libraryStore`. Loans and holds are server truth and are
// deliberately session-only: a cold start with no network correctly shows
// nothing held. A download is the opposite — it is a fact about this device's
// disk, and the reader who downloaded a book on the train expects to see it
// after force-quitting the app in a tunnel. Not persisting it would hide,
// offline, the one list that exists for offline.
//
// NOTHING WRITES TO IT YET. `src/features/download` is an empty directory; the
// download action itself is unbuilt. So the Downloads section renders empty in
// today's app, which is the correct empty rather than a placeholder — this
// device has downloaded nothing.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import storage from '@storage/storage';

/**
 * One item whose bytes this device recorded downloading.
 *
 * KEYED ON `itemId`, WHICH IS WHAT THE SHELF AND THE CATALOGUE BOTH SPEAK. The
 * content layer calls the same identity `bookId`; `getItemsBatch` takes item
 * ids, and the shelf hydrates every row through it, so an id in another
 * namespace would render as a raw string forever.
 */
export interface DownloadRecord {
  itemId: string;
  /**
   * Device wall-time ms when the bytes finished landing, passed in by the
   * caller rather than read here.
   *
   * NOT `Date.now()` INSIDE THIS STORE. Every other clock in this module is a
   * difference against `serverTime` (see `LibraryScreen.tsx`), and a store that
   * silently samples the device clock is untestable and un-fake-able. It is
   * also honest about what this number is: a device timestamp, not a server
   * one, so it is safe to ORDER by and unsafe to count down against.
   */
  downloadedAt: number;
  /** Bytes on disk, when the download layer reported a size. Absent is normal. */
  sizeBytes?: number;
}

interface DownloadState {
  /** Most recently downloaded first — the order the Downloads section renders. */
  downloads: DownloadRecord[];
  /**
   * Record a completed download. Re-downloading an item moves it to the front
   * and replaces its record rather than adding a second row for the same book.
   */
  markDownloaded: (record: DownloadRecord) => void;
  /**
   * Forget a download — the reader deleted it, or the licence ended and
   * `ContentStore.destroy` took the key with it.
   *
   * A HARD REMOVE, NOT A TOMBSTONE, because this list never syncs. It describes
   * one device's disk, and no other device has an opinion about it. Compare
   * `bookmarkStore`, which soft-deletes because it does.
   */
  removeDownload: (itemId: string) => void;
  clear: () => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      downloads: [],

      markDownloaded: (record) =>
        set((state) => ({
          downloads: [
            record,
            ...state.downloads.filter((existing) => existing.itemId !== record.itemId),
          ],
        })),

      removeDownload: (itemId) =>
        set((state) => ({
          downloads: state.downloads.filter((existing) => existing.itemId !== itemId),
        })),

      clear: () => set({ downloads: [] }),
    }),
    {
      name: 'downloads',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);
