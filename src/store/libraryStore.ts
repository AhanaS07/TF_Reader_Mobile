// src/store/libraryStore.ts
// Session-only cache of the reader's active loans and holds from GET /api/v1/library.
//
// NOT PERSISTED — cold start means no holdings until refresh() runs, which is fine:
// resolveAccess treats undefined loan/hold as "nothing held", the same as a first launch.
// Persisting would require the same hydration gate as institutionStore, for data that
// goes stale the moment another device touches the same account.
//
// INVALIDATED BY THE FOUR CALLS, NOT BY TIME. borrow, returnLoan, placeHold and
// acceptOffer each mutate server state, so any cached result is stale the moment they
// succeed. Screens call refresh() after each one; this store does not watch a timer.
import { create } from 'zustand';
import { getLicenceSource } from '@config/licence';
import type { Hold, Loan } from '@model/types';

interface LibraryState {
  loans: Loan[];
  holds: Hold[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  loans: [],
  holds: [],
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const library = await getLicenceSource().getLibrary();
      set({ loans: library.loans, holds: library.holds });
    } catch {
      // A failed refresh leaves the last-known data in place. A stale but present loan
      // is better than blanking the UI — the reader still sees the correct tier badge
      // and action bar from before the refresh failure.
    } finally {
      set({ loading: false });
    }
  },
}));
