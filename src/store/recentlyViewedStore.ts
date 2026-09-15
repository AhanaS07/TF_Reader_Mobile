// src/store/recentlyViewedStore.ts
// Client-side "recently viewed" for the catalogue search surface (screen 09's
// idle state) — a reader's own last few opened items, not a wokay capability.
//
// CLIENT-SIDE ONLY, SAME REASONING AS recentSearchesStore. wokay's detail
// endpoint has no view history of its own to read back, and per-device
// browsing history is not something a shared institutional account should
// sync — this is a convenience for the one device the reader is holding.
//
// STORES THE REAL `Publication`, NOT A HAND-PICKED SUBSET. An earlier version
// of this file trimmed it to a few display fields; that meant Search's own
// "Recently viewed" row could not be drawn by the SAME `ContentCard` +
// `resolveAccess` path an ordinary result row uses — a a second, thinner
// rendering for what is otherwise identical data. Keeping the whole
// `Publication` costs nothing extra (it is already-fetched metadata, capped
// at a handful of entries) and lets both rows share one implementation.
//
// SAME PATTERN AS recentSearchesStore: Zustand, persisted through the shared
// `storage` AsyncStorage wrapper, most-recent-first, capped so the list
// cannot grow without bound.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';
import type { Publication } from '@model/types';

// Same order of magnitude as recentSearchesStore's own cap — enough to be
// useful without needing its own scroll inside an already-scrolling screen.
export const MAX_RECENTLY_VIEWED = 6;

interface RecentlyViewedState {
  /** Most recent first. */
  items: Publication[];
  recordView: (publication: Publication) => void;
  clear: () => void;
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      items: [],

      recordView: (publication) =>
        set((state) => ({
          items: [
            publication,
            ...state.items.filter((existing) => existing.id !== publication.id),
          ].slice(0, MAX_RECENTLY_VIEWED),
        })),

      clear: () => set({ items: [] }),
    }),
    {
      name: 'recently-viewed',
      storage: createJSONStorage(() => storage),
      version: 2,
    },
  ),
);
