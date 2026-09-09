// src/store/recentSearchesStore.ts
// Client-side recent searches for the catalogue search surface (screen 09).
//
// CLIENT-SIDE ONLY, ON PURPOSE. wokay's search endpoint has no history of its
// own to read back (and even if it did, per-device browsing history is not
// something a shared institutional account should sync) — this is a
// convenience for the one device the reader is holding, same footing as
// `institutionStore`'s recently-used row.
//
// SAME PATTERN AS institutionStore: Zustand, persisted through the shared
// `storage` AsyncStorage wrapper, most-recent-first, capped so the list
// cannot grow without bound.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';

// Arbitrary, same reasoning as institutionStore's cap of 3: enough to be
// useful, small enough that the list never needs its own scroll.
export const MAX_RECENT_SEARCHES = 5;

interface RecentSearchesState {
  /** Most recent first. Deduplicated case-insensitively — "Climate" and
   * "climate" are the same recent search, not two. */
  queries: string[];
  addQuery: (query: string) => void;
  removeQuery: (query: string) => void;
  clear: () => void;
}

export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      queries: [],

      addQuery: (query) =>
        set((state) => {
          const trimmed = query.trim();
          // Blank is not a search — SearchInput never submits one, but a
          // caller here should not have to know that to stay safe.
          if (trimmed.length === 0) return state;

          const folded = trimmed.toLowerCase();
          return {
            queries: [
              trimmed,
              ...state.queries.filter((existing) => existing.toLowerCase() !== folded),
            ].slice(0, MAX_RECENT_SEARCHES),
          };
        }),

      removeQuery: (query) =>
        set((state) => ({ queries: state.queries.filter((existing) => existing !== query) })),

      clear: () => set({ queries: [] }),
    }),
    {
      name: 'recent-searches',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);
