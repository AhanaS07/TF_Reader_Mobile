// src/store/recentlyViewedStore.ts
// Client-side "recently viewed" for the catalogue search surface (screen 09's
// idle state) — a reader's own last few opened items, not a wokay capability.
//
// CLIENT-SIDE ONLY, SAME REASONING AS recentSearchesStore. wokay's detail
// endpoint has no view history of its own to read back, and per-device
// browsing history is not something a shared institutional account should
// sync — this is a convenience for the one device the reader is holding.
//
// STORES A SNAPSHOT, NOT A LIVE REFERENCE. `recordView` copies the handful of
// display fields a row needs off the `Publication` the detail screen already
// has in hand at view time — title, authors, published date, work type,
// cover — rather than keeping the id alone and re-fetching later. A reader's
// own recently-viewed list showing a title that has since changed (or is
// temporarily unreachable) is a worse experience than one that is a few
// hours stale; re-fetching four rows just to draw them is also the kind of
// extra call `collectItemIds`'s own "one call, not twenty" reasoning warns
// against elsewhere in this app.
//
// SAME PATTERN AS recentSearchesStore: Zustand, persisted through the shared
// `storage` AsyncStorage wrapper, most-recent-first, capped so the list
// cannot grow without bound.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';
import type { Publication, WorkType } from '@model/types';

// Same order of magnitude as recentSearchesStore's own cap — enough to be
// useful without needing its own scroll inside an already-scrolling screen.
export const MAX_RECENTLY_VIEWED = 6;

/** The handful of real fields a row needs — see the file header. */
export interface RecentlyViewedEntry {
  itemId: string;
  title: string;
  authors: string[];
  /** As supplied by the feed ('2020-09-30' or similar) — never invented. */
  published?: string;
  workType?: WorkType;
  coverUrl?: string;
}

interface RecentlyViewedState {
  /** Most recent first. */
  items: RecentlyViewedEntry[];
  recordView: (publication: Publication) => void;
  clear: () => void;
}

function toEntry(publication: Publication): RecentlyViewedEntry {
  return {
    itemId: publication.id,
    title: publication.title,
    authors: publication.authors,
    ...(publication.published === undefined ? {} : { published: publication.published }),
    ...(publication.workType === undefined ? {} : { workType: publication.workType }),
    ...(publication.coverUrl === undefined ? {} : { coverUrl: publication.coverUrl }),
  };
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      items: [],

      recordView: (publication) =>
        set((state) => ({
          items: [
            toEntry(publication),
            ...state.items.filter((existing) => existing.itemId !== publication.id),
          ].slice(0, MAX_RECENTLY_VIEWED),
        })),

      clear: () => set({ items: [] }),
    }),
    {
      name: 'recently-viewed',
      storage: createJSONStorage(() => storage),
      version: 1,
    },
  ),
);
