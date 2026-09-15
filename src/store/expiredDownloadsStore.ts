// src/store/expiredDownloadsStore.ts
// Pending "this download was removed" notices — recorded by LibraryScreen's own
// expiry sweep (see that screen's own comment) the moment a downloaded Elite or
// Subscription title's licence is confirmed gone, surfaced next time the reader
// sees the Library screen.
//
// PERSISTED, DELIBERATELY. The sweep only ever runs once a fresh loans list has
// actually arrived — it needs the server's current answer, so it can only ever
// fire while online — but the reader who should hear about a deletion might not
// be looking at this screen at that exact moment, or might background the app
// immediately after. A notice waits here, across a cold start, until the reader
// actually dismisses it, rather than firing once into a screen nobody saw.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import storage from '@storage/storage';

export interface ExpiredDownloadNotice {
  itemId: string;
  title: string;
  expiredAt: number;
}

interface ExpiredDownloadsState {
  notices: ExpiredDownloadNotice[];
  /** Replaces any existing notice for the same item rather than duplicating it —
   *  a title swept twice (e.g. a second failed delete retried later) is still
   *  one fact worth telling the reader, not two. */
  recordExpired: (notice: ExpiredDownloadNotice) => void;
  dismiss: (itemId: string) => void;
  dismissAll: () => void;
}

export const useExpiredDownloadsStore = create<ExpiredDownloadsState>()(
  persist(
    (set) => ({
      notices: [],

      recordExpired: (notice) =>
        set((state) => ({
          notices: [...state.notices.filter((existing) => existing.itemId !== notice.itemId), notice],
        })),

      dismiss: (itemId) =>
        set((state) => ({ notices: state.notices.filter((existing) => existing.itemId !== itemId) })),

      dismissAll: () => set({ notices: [] }),
    }),
    {
      name: 'expired-downloads',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);
