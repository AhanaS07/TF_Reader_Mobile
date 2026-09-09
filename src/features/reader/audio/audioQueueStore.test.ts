// Owner: Reader (Ahana & Team).
//
// Unit tests for audioQueueStore.

import type { BookId } from '@/shared/contracts';
import { useAudioQueueStore } from './audioQueueStore';

describe('audioQueueStore', () => {
  beforeEach(() => {
    useAudioQueueStore.getState().clearQueue();
    useAudioQueueStore.getState().setRepeatMode('off');
  });

  const itemA = { bookId: 'book-a' as BookId, title: 'Book A' };
  const itemB = { bookId: 'book-b' as BookId, title: 'Book B' };
  const itemC = { bookId: 'book-c' as BookId, title: 'Book C' };

  it('initializes with empty state', () => {
    const state = useAudioQueueStore.getState();
    expect(state.items).toEqual([]);
    expect(state.currentIndex).toBe(-1);
    expect(state.repeatMode).toBe('off');
    expect(state.getCurrentItem()).toBeNull();
    expect(state.hasNext()).toBe(false);
    expect(state.hasPrevious()).toBe(false);
  });

  it('sets queue and clamps starting index', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB, itemC], 1);

    const updated = useAudioQueueStore.getState();
    expect(updated.items).toEqual([itemA, itemB, itemC]);
    expect(updated.currentIndex).toBe(1);
    expect(updated.getCurrentItem()).toEqual(itemB);
    expect(updated.hasNext()).toBe(true);
    expect(updated.hasPrevious()).toBe(true);
  });

  it('enqueues items to the end of the queue', () => {
    const store = useAudioQueueStore.getState();
    store.enqueue(itemA);
    expect(useAudioQueueStore.getState().items).toEqual([itemA]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);

    store.enqueue(itemB);
    expect(useAudioQueueStore.getState().items).toEqual([itemA, itemB]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
  });

  it('inserts items next up via playNext', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemC], 0);

    store.playNext(itemB);
    expect(useAudioQueueStore.getState().items).toEqual([itemA, itemB, itemC]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
  });

  it('skips to next item with repeat mode off', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB], 0);

    const next = store.skipToNext();
    expect(next).toEqual(itemB);
    expect(useAudioQueueStore.getState().currentIndex).toBe(1);

    const pastEnd = store.skipToNext();
    expect(pastEnd).toBeNull();
    expect(useAudioQueueStore.getState().currentIndex).toBe(1);
  });

  it('skips to next item with repeat mode all (loops to top)', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB], 1);
    store.setRepeatMode('all');

    const next = store.skipToNext();
    expect(next).toEqual(itemA);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
  });

  it('skips to next item with repeat mode one (stays on current)', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB], 0);
    store.setRepeatMode('one');

    const next = store.skipToNext();
    expect(next).toEqual(itemA);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
  });

  it('skips to previous item with repeat mode off', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB], 1);

    const prev = store.skipToPrevious();
    expect(prev).toEqual(itemA);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);

    const beforeStart = store.skipToPrevious();
    expect(beforeStart).toBeNull();
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
  });

  it('skips to previous item with repeat mode all (loops to end)', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB, itemC], 0);
    store.setRepeatMode('all');

    const prev = store.skipToPrevious();
    expect(prev).toEqual(itemC);
    expect(useAudioQueueStore.getState().currentIndex).toBe(2);
  });

  it('skips to a specific index via skipToIndex', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB, itemC], 0);

    const jumped = store.skipToIndex(2);
    expect(jumped).toEqual(itemC);
    expect(useAudioQueueStore.getState().currentIndex).toBe(2);

    const outOfBounds = store.skipToIndex(99);
    expect(outOfBounds).toBeNull();
    expect(useAudioQueueStore.getState().currentIndex).toBe(2);
  });

  it('removes item and adjusts currentIndex correctly', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB, itemC], 1); // active is itemB

    // Remove item after active: currentIndex stays 1
    store.removeItem(2);
    expect(useAudioQueueStore.getState().items).toEqual([itemA, itemB]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(1);

    // Remove item before active: currentIndex decrements to 0
    store.removeItem(0);
    expect(useAudioQueueStore.getState().items).toEqual([itemB]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);

    // Remove current active: queue becomes empty
    store.removeItem(0);
    expect(useAudioQueueStore.getState().items).toEqual([]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(-1);
  });

  it('reorders items and preserves active item tracking', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB, itemC], 1); // active is itemB

    // Move itemB from index 1 to index 0
    store.reorder(1, 0);
    expect(useAudioQueueStore.getState().items).toEqual([itemB, itemA, itemC]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(0);
    expect(useAudioQueueStore.getState().getCurrentItem()).toEqual(itemB);
  });

  it('toggles repeat mode in cycle off -> all -> one -> off', () => {
    const store = useAudioQueueStore.getState();
    expect(store.repeatMode).toBe('off');

    store.toggleRepeatMode();
    expect(useAudioQueueStore.getState().repeatMode).toBe('all');

    store.toggleRepeatMode();
    expect(useAudioQueueStore.getState().repeatMode).toBe('one');

    store.toggleRepeatMode();
    expect(useAudioQueueStore.getState().repeatMode).toBe('off');
  });

  it('clears queue properly', () => {
    const store = useAudioQueueStore.getState();
    store.setQueue([itemA, itemB], 0);
    store.setIsPlaying(true);
    store.setPlaybackProgress({ positionSeconds: 15, durationSeconds: 60 });

    store.clearQueue();
    expect(useAudioQueueStore.getState().items).toEqual([]);
    expect(useAudioQueueStore.getState().currentIndex).toBe(-1);
    expect(useAudioQueueStore.getState().isPlaying).toBe(false);
    expect(useAudioQueueStore.getState().playbackProgress).toEqual({ positionSeconds: 0, durationSeconds: 0 });
  });

  it('updates isPlaying and playbackProgress state', () => {
    const store = useAudioQueueStore.getState();
    expect(store.isPlaying).toBe(false);
    expect(store.playbackProgress).toEqual({ positionSeconds: 0, durationSeconds: 0 });

    store.setIsPlaying(true);
    expect(useAudioQueueStore.getState().isPlaying).toBe(true);

    store.setPlaybackProgress({ positionSeconds: 42, durationSeconds: 120 });
    expect(useAudioQueueStore.getState().playbackProgress).toEqual({ positionSeconds: 42, durationSeconds: 120 });
  });
});
