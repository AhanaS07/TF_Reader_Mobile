// Owner: Reader (Ahana & Team).
//
// Unit tests for audioQueueCoordinator.

import type { BookId } from '@/shared/contracts';
import { audioAssetResolver } from './audioAssetResolver';
import {
  getAudioPlayerFor,
  releaseCurrentAudioPlayer,
} from './audioPlayerInstance';
import { audioQueueStore } from './audioQueueStore';
import {
  handleTrackFinished,
  jumpToQueueIndex,
  playQueueItem,
  selectAndPlayAudiobook,
  skipToNextTrack,
  skipToPreviousTrack,
  toggleAudioPlayback,
} from './audioQueueCoordinator';

jest.mock('./audioAssetResolver', () => ({
  audioAssetResolver: {
    resolveAudioAssetUri: jest.fn(),
  },
}));

jest.mock('./useAudioPlayerSetup', () => ({
  ensureAudioModeConfigured: jest.fn(() => Promise.resolve()),
}));

const mockResolve = audioAssetResolver.resolveAudioAssetUri as jest.Mock;

describe('audioQueueCoordinator', () => {
  const itemA = { bookId: 'book-a' as BookId, title: 'Book A' };
  const itemB = { bookId: 'book-b' as BookId, title: 'Book B' };
  const itemC = { bookId: 'book-c' as BookId, title: 'Book C' };

  beforeEach(() => {
    releaseCurrentAudioPlayer();
    jest.clearAllMocks();
    audioQueueStore.getState().clearQueue();
    audioQueueStore.getState().setRepeatMode('off');
    mockResolve.mockResolvedValue('file:///scratch/audio.wav');
  });

  it('plays a queue item and replaces source on the singleton player', async () => {
    const { player } = getAudioPlayerFor(itemA.bookId); // Initialize player
    const replaceSpy = jest.spyOn(player, 'replace');
    const playSpy = jest.spyOn(player, 'play');

    const success = await playQueueItem(itemB);
    expect(success).toBe(true);
    expect(mockResolve).toHaveBeenCalledWith(itemB.bookId);

    expect(replaceSpy).toHaveBeenCalledWith({ uri: 'file:///scratch/audio.wav' });
    expect(playSpy).toHaveBeenCalled();
  });

  it('handles track completion by advancing to next item', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB], 0);
    getAudioPlayerFor(itemA.bookId);

    const advanced = await handleTrackFinished();
    expect(advanced).toBe(true);
    expect(audioQueueStore.getState().currentIndex).toBe(1);
    expect(mockResolve).toHaveBeenCalledWith(itemB.bookId);
  });

  it('handles track completion with repeatMode one by seeking to 0 and playing', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB], 0);
    audioQueueStore.getState().setRepeatMode('one');
    const { player } = getAudioPlayerFor(itemA.bookId);
    const seekSpy = jest.spyOn(player, 'seekTo');
    const playSpy = jest.spyOn(player, 'play');

    const result = await handleTrackFinished();
    expect(result).toBe(true);
    expect(audioQueueStore.getState().currentIndex).toBe(0);
    expect(seekSpy).toHaveBeenCalledWith(0);
    expect(playSpy).toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('stops at end of queue when repeatMode is off', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB], 1);
    getAudioPlayerFor(itemB.bookId);

    const result = await handleTrackFinished();
    expect(result).toBe(false);
    expect(audioQueueStore.getState().currentIndex).toBe(1);
  });

  it('skips to next track via skipToNextTrack', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB, itemC], 0);
    getAudioPlayerFor(itemA.bookId);

    const success = await skipToNextTrack();
    expect(success).toBe(true);
    expect(audioQueueStore.getState().currentIndex).toBe(1);
    expect(mockResolve).toHaveBeenCalledWith(itemB.bookId);
  });

  it('restarts current track on skipToPreviousTrack when playback > 3s', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB], 1);
    const { player } = getAudioPlayerFor(itemB.bookId);
    const seekSpy = jest.spyOn(player, 'seekTo');

    const result = await skipToPreviousTrack(10.5);
    expect(result).toBe(true);
    expect(seekSpy).toHaveBeenCalledWith(0);
    expect(audioQueueStore.getState().currentIndex).toBe(1); // Didn't change
  });

  it('skips to previous track on skipToPreviousTrack when playback <= 3s', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB], 1);
    getAudioPlayerFor(itemB.bookId);

    const result = await skipToPreviousTrack(1.2);
    expect(result).toBe(true);
    expect(audioQueueStore.getState().currentIndex).toBe(0);
    expect(mockResolve).toHaveBeenCalledWith(itemA.bookId);
  });

  it('jumps to target queue index via jumpToQueueIndex', async () => {
    audioQueueStore.getState().setQueue([itemA, itemB, itemC], 0);
    getAudioPlayerFor(itemA.bookId);

    const result = await jumpToQueueIndex(2);
    expect(result).toBe(true);
    expect(audioQueueStore.getState().currentIndex).toBe(2);
    expect(mockResolve).toHaveBeenCalledWith(itemC.bookId);
  });

  it('returns false gracefully when audio asset resolution fails', async () => {
    mockResolve.mockRejectedValueOnce(new Error('Licence revoked'));
    audioQueueStore.getState().setQueue([itemA, itemB], 0);
    getAudioPlayerFor(itemA.bookId);

    const result = await skipToNextTrack();
    expect(result).toBe(false);
  });

  it('selects and plays an audiobook, enqueuing it if not already in queue', async () => {
    const result = await selectAndPlayAudiobook(itemB);
    expect(result).toBe(true);
    expect(audioQueueStore.getState().items).toEqual([itemB]);
    expect(audioQueueStore.getState().currentIndex).toBe(0);
    expect(mockResolve).toHaveBeenCalledWith(itemB.bookId);
  });

  it('toggles playback between play and pause on toggleAudioPlayback', async () => {
    await playQueueItem(itemA);
    const player = getAudioPlayerFor(itemA.bookId).player;
    expect(player.playing).toBe(true);
    expect(audioQueueStore.getState().isPlaying).toBe(true);

    // Toggle to pause
    const pausedResult = await toggleAudioPlayback();
    expect(pausedResult).toBe(true);
    expect(player.playing).toBe(false);
    expect(audioQueueStore.getState().isPlaying).toBe(false);

    // Toggle back to play
    const playedResult = await toggleAudioPlayback();
    expect(playedResult).toBe(true);
    expect(player.playing).toBe(true);
    expect(audioQueueStore.getState().isPlaying).toBe(true);
  });
});
