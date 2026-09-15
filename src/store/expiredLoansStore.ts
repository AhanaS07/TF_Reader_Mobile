// src/store/expiredLoansStore.ts
// Pending "your Elite access ended" notices — recorded by LibraryScreen's own
// Elite-expiry watch the moment a previously-held Elite loan is confirmed gone
// from a fresh `libraryStore.refresh()`, surfaced next time the reader sees
// the Library screen.
//
// A SEPARATE STORE FROM `expiredDownloadsStore`, ON PURPOSE, even though the
// banner they drive looks the same shape. That one fires from the DOWNLOAD
// side (a file on this device with no licence left behind it) and can catch
// an Elite title only if it was also downloaded. This one fires from the
// LOAN side, so it also catches an Elite title the reader was reading online
// without ever downloading it — the loan simply disappearing from Library
// with no explanation is the defect this store exists to close.
//
// PERSISTED, for the identical reason `expiredDownloadsStore` is: the reader
// who should hear about it might not be looking at Library at that exact
// moment, and a notice should wait here, across a cold start, rather than
// firing once into a screen nobody saw.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import storage from '@storage/storage';

export interface ExpiredLoanNotice {
  itemId: string;
  title: string;
  expiredAt: number;
}

interface ExpiredLoansState {
  notices: ExpiredLoanNotice[];
  /** Replaces any existing notice for the same item rather than duplicating it. */
  recordExpired: (notice: ExpiredLoanNotice) => void;
  dismiss: (itemId: string) => void;
  dismissAll: () => void;
}

export const useExpiredLoansStore = create<ExpiredLoansState>()(
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
      name: 'expired-loans',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);
