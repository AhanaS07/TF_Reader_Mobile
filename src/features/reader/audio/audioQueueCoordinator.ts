// Owner: Reader (Ahana & Team).
//
// AUDIO QUEUE COORDINATOR.
// Coordinates auto-advancing, skipping, and just-in-time decryption between
// audioQueueStore, audioAssetResolver, and audioPlayerInstance.

import { audioAssetResolver } from './audioAssetResolver';
import {
  commitCurrentPlayerPosition,
  getCurrentAudioPlayer,
  registerTrackCompletionHandler,
  switchActiveAudioTrack,
} from './audioPlayerInstance';
import { audioQueueStore, type AudioQueueItem } from './audioQueueStore';
import { stopActiveTts } from './audioTtsCoordinator';
import { ensureAudioModeConfigured } from './useAudioPlayerSetup';

let isTransitioning = false;

/**
 * Loads and plays an AudioQueueItem:
 * 1. Stops any active TTS.
 * 2. Reconfigures audio session if needed.
 * 3. Resolves/decrypts the book via audioAssetResolver (JIT).
 * 4. Switches active audio track on the singleton player.
 */
export async function playQueueItem(item: AudioQueueItem): Promise<boolean> {
  if (isTransitioning) return false;
  isTransitioning = true;
  try {
    stopActiveTts();
    await ensureAudioModeConfigured(true);
    const uri = await audioAssetResolver.resolveAudioAssetUri(item.bookId);
    switchActiveAudioTrack(item.bookId, uri, item.title, item.artist);
    return true;
  } catch {
    // If acquisition fails (e.g. licence revoked or offline without download), return false
    return false;
  } finally {
    isTransitioning = false;
  }
}

/**
 * Handles automatic track completion:
 * - If repeatMode is 'one', seeks back to 0:00 and continues playing.
 * - If repeatMode is 'all' or there is a next track, advances and plays.
 * - If at end of queue with repeatMode 'off', does nothing (playback stops).
 */
export async function handleTrackFinished(): Promise<boolean> {
  const { repeatMode } = audioQueueStore.getState();
  if (repeatMode === 'one') {
    const player = getCurrentAudioPlayer();
    if (player) {
      await player.seekTo(0);
      player.play();
      return true;
    }
    return false;
  }

  const nextItem = audioQueueStore.getState().skipToNext();
  if (!nextItem) return false;
  return playQueueItem(nextItem);
}

/**
 * User action: Skip to next track in queue.
 */
export async function skipToNextTrack(): Promise<boolean> {
  const nextItem = audioQueueStore.getState().skipToNext();
  if (!nextItem) return false;
  return playQueueItem(nextItem);
}

/**
 * User action: Skip to previous track in queue.
 * Audio convention: if current track has played for > 3.0s, restarts current track.
 * Otherwise skips to previous track in queue.
 */
export async function skipToPreviousTrack(currentPositionSeconds: number = 0): Promise<boolean> {
  const player = getCurrentAudioPlayer();
  if (currentPositionSeconds > 3.0 && player) {
    await player.seekTo(0);
    player.play();
    return true;
  }

  const prevItem = audioQueueStore.getState().skipToPrevious();
  if (!prevItem) {
    if (player) {
      await player.seekTo(0);
    }
    return false;
  }
  return playQueueItem(prevItem);
}

/**
 * User action: Jump directly to a track at the given queue index.
 */
export async function jumpToQueueIndex(index: number): Promise<boolean> {
  const targetItem = audioQueueStore.getState().skipToIndex(index);
  if (!targetItem) return false;
  return playQueueItem(targetItem);
}

/**
 * Toggles play/pause on the current active player, or starts playback of current queue item.
 */
export async function toggleAudioPlayback(): Promise<boolean> {
  const player = getCurrentAudioPlayer();
  if (player && player.isLoaded) {
    if (player.playing) {
      player.pause();
      commitCurrentPlayerPosition();
      audioQueueStore.getState().setIsPlaying(false);
    } else {
      stopActiveTts();
      await ensureAudioModeConfigured(true);
      player.play();
      audioQueueStore.getState().setIsPlaying(true);
    }
    return true;
  }

  const currentItem = audioQueueStore.getState().getCurrentItem();
  if (currentItem) {
    return playQueueItem(currentItem);
  }
  return false;
}

/**
 * User action: Selects an audiobook, ensures it is in queue, and starts playing immediately.
 */
export async function selectAndPlayAudiobook(item: AudioQueueItem): Promise<boolean> {
  const { items } = audioQueueStore.getState();
  let index = items.findIndex((i) => i.bookId === item.bookId);
  if (index === -1) {
    audioQueueStore.getState().enqueue(item);
    index = audioQueueStore.getState().items.length - 1;
  }
  audioQueueStore.getState().skipToIndex(index);
  return playQueueItem(item);
}

// Register auto-advance listener with player singleton
registerTrackCompletionHandler(async () => {
  await handleTrackFinished();
});
