// Owner: Reader (Ahana & Team).
//
// AUDIO QUEUE STORE.
// A centralized Zustand store managing the playlist queue for audiobook playback.
// Survives screen navigation and background playback at module scope.

import { create } from 'zustand';

import type { BookId } from '@/shared/contracts';

export interface AudioQueueItem {
  bookId: BookId;
  title: string;
  artist?: string;
  durationSeconds?: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface AudioQueueState {
  items: AudioQueueItem[];
  currentIndex: number;
  repeatMode: RepeatMode;

  // Actions
  setQueue: (items: AudioQueueItem[], startIndex?: number) => void;
  enqueue: (item: AudioQueueItem) => void;
  playNext: (item: AudioQueueItem) => void;
  skipToNext: () => AudioQueueItem | null;
  skipToPrevious: () => AudioQueueItem | null;
  skipToIndex: (index: number) => AudioQueueItem | null;
  removeItem: (index: number) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  toggleRepeatMode: () => void;
  clearQueue: () => void;
  getCurrentItem: () => AudioQueueItem | null;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
}

export const useAudioQueueStore = create<AudioQueueState>((set, get) => ({
  items: [],
  currentIndex: -1,
  repeatMode: 'off',

  setQueue: (items, startIndex = 0) => {
    const validIndex = items.length > 0 ? Math.min(Math.max(0, startIndex), items.length - 1) : -1;
    set({ items: [...items], currentIndex: validIndex });
  },

  enqueue: (item) => {
    set((state) => {
      const items = [...state.items, item];
      const currentIndex = state.currentIndex === -1 ? 0 : state.currentIndex;
      return { items, currentIndex };
    });
  },

  playNext: (item) => {
    set((state) => {
      if (state.items.length === 0 || state.currentIndex === -1) {
        return { items: [item], currentIndex: 0 };
      }
      const items = [...state.items];
      items.splice(state.currentIndex + 1, 0, item);
      return { items };
    });
  },

  skipToNext: () => {
    const { items, currentIndex, repeatMode } = get();
    if (items.length === 0 || currentIndex === -1) return null;

    if (repeatMode === 'one') {
      return items[currentIndex];
    }

    if (currentIndex < items.length - 1) {
      const nextIndex = currentIndex + 1;
      set({ currentIndex: nextIndex });
      return items[nextIndex];
    }

    if (repeatMode === 'all' && items.length > 0) {
      set({ currentIndex: 0 });
      return items[0];
    }

    return null;
  },

  skipToPrevious: () => {
    const { items, currentIndex, repeatMode } = get();
    if (items.length === 0 || currentIndex === -1) return null;

    if (repeatMode === 'one') {
      return items[currentIndex];
    }

    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      set({ currentIndex: prevIndex });
      return items[prevIndex];
    }

    if (repeatMode === 'all' && items.length > 0) {
      const lastIndex = items.length - 1;
      set({ currentIndex: lastIndex });
      return items[lastIndex];
    }

    return null;
  },

  skipToIndex: (index) => {
    const { items } = get();
    if (index < 0 || index >= items.length) return null;
    set({ currentIndex: index });
    return items[index];
  },

  removeItem: (index) => {
    set((state) => {
      if (index < 0 || index >= state.items.length) return state;

      const items = state.items.filter((_, i) => i !== index);
      if (items.length === 0) {
        return { items: [], currentIndex: -1 };
      }

      let currentIndex = state.currentIndex;
      if (index < state.currentIndex) {
        currentIndex = state.currentIndex - 1;
      } else if (index === state.currentIndex) {
        currentIndex = Math.min(state.currentIndex, items.length - 1);
      }

      return { items, currentIndex };
    });
  },

  reorder: (fromIndex, toIndex) => {
    set((state) => {
      const { items, currentIndex } = state;
      if (
        fromIndex < 0 ||
        fromIndex >= items.length ||
        toIndex < 0 ||
        toIndex >= items.length ||
        fromIndex === toIndex
      ) {
        return state;
      }

      const activeItem = currentIndex >= 0 ? items[currentIndex] : null;
      const newItems = [...items];
      const [moved] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, moved);

      // Keep currentIndex pointing to the same active item if possible
      let newCurrentIndex = currentIndex;
      if (activeItem !== null) {
        const foundIndex = newItems.findIndex((item) => item.bookId === activeItem.bookId);
        if (foundIndex !== -1) {
          newCurrentIndex = foundIndex;
        }
      }

      return { items: newItems, currentIndex: newCurrentIndex };
    });
  },

  setRepeatMode: (mode) => set({ repeatMode: mode }),

  toggleRepeatMode: () => {
    set((state) => {
      const modes: RepeatMode[] = ['off', 'all', 'one'];
      const nextIndex = (modes.indexOf(state.repeatMode) + 1) % modes.length;
      return { repeatMode: modes[nextIndex] };
    });
  },

  clearQueue: () => set({ items: [], currentIndex: -1 }),

  getCurrentItem: () => {
    const { items, currentIndex } = get();
    if (currentIndex >= 0 && currentIndex < items.length) {
      return items[currentIndex];
    }
    return null;
  },

  hasNext: () => {
    const { items, currentIndex, repeatMode } = get();
    if (items.length === 0 || currentIndex === -1) return false;
    if (repeatMode === 'all' || repeatMode === 'one') return true;
    return currentIndex < items.length - 1;
  },

  hasPrevious: () => {
    const { items, currentIndex, repeatMode } = get();
    if (items.length === 0 || currentIndex === -1) return false;
    if (repeatMode === 'all' || repeatMode === 'one') return true;
    return currentIndex > 0;
  },
}));

/** Imperative handle for background audio coordination and non-React call sites */
export const audioQueueStore = {
  getState: useAudioQueueStore.getState,
  setState: useAudioQueueStore.setState,
  subscribe: useAudioQueueStore.subscribe,
};
