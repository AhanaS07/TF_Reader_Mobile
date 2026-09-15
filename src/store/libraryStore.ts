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
//
// `refreshFailed` EXISTS BECAUSE A SILENT STALE READ IS A REAL DEFECT FOR THIS DATA,
// found live: a loan's `expiresAt` (what every "Due in N days" label reads) only ever
// updates on a successful refresh, and a failed one used to leave the OLD loan sitting
// in state with nothing to say so — a reader (or a real device with a flaky connection)
// could keep seeing "Due in 14 days" for a loan the server had already returned,
// re-issued with a different expiry, or dropped outright, for as long as every refresh
// kept failing. "Stale but present beats a blank screen" is still the right call for
// most of this screen; it is NOT the right call for an expiry date with no visible sign
// it might be wrong. `refresh()` still keeps the last-known loans/holds on failure —
// this flag only adds a way for a screen to say "unconfirmed" atop them.
import { create } from 'zustand';
import { getLicenceSource } from '@config/licence';
import type { Hold, Loan } from '@model/types';

interface LibraryState {
  loans: Loan[];
  holds: Hold[];
  loading: boolean;
  /** True when the MOST RECENT refresh() failed — loans/holds below are the last
   *  successful read, not a confirmed current one. Cleared by the next successful
   *  refresh(); never true before the first refresh() has run at all (there is
   *  nothing "stale" about data that was never fetched to begin with). */
  refreshFailed: boolean;
  /** True once a refresh() has genuinely SUCCEEDED at least once this session.
   *  Exists so a consumer that reacts to an empty `loans` array — LibraryScreen's
   *  own expiry sweep treats a downloaded Elite/Subscription title with no
   *  matching active loan as licence-lapsed and deletes it — can tell "confirmed:
   *  nothing is held" apart from "nothing has loaded yet" (the cold-start empty
   *  array) and never treat the latter as grounds to delete anything. */
  hasSyncedOnce: boolean;
  refresh: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  loans: [],
  holds: [],
  loading: false,
  refreshFailed: false,
  hasSyncedOnce: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const library = await getLicenceSource().getLibrary();
      set({ loans: library.loans, holds: library.holds, refreshFailed: false, hasSyncedOnce: true });
    } catch (error) {
      // A failed refresh leaves the last-known data in place. A stale but present loan
      // is better than blanking the UI — the reader still sees the correct tier badge
      // and action bar from before the refresh failure. Logged so a persistent failure
      // (auth, backend outage) doesn't stay invisible just because the UI looks fine.
      console.log('libraryStore.refresh: failed, keeping last-known loans/holds', error);
      set({ refreshFailed: true });
    } finally {
      set({ loading: false });
    }
  },
}));
