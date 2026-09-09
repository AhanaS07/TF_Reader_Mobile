// Owner: Reader (Ahana).
//
// Unit tests for audioPlayerInstance.ts: proves singleton player management,
// audio session concurrency (stopping TTS when audio starts, pausing audio on command),
// and position persistence.


import { progressStore } from '@/features/sync/stores/progressStore';
import type { BookId } from '@/shared/contracts';

import {
  _resetAudioTtsCoordinatorForTests,
  pauseActiveAudio,
  registerActiveTtsSession,
} from './audioTtsCoordinator';
import {
  _resetTrackCompletionHandlerForTests,
  commitCurrentPlayerPosition,
  currentAudioBookId,
  getAudioPlayerFor,
  getCurrentAudioPlayer,
  isAudioPlaying,
  pauseCurrentAudioPlayer,
  registerTrackCompletionHandler,
  releaseCurrentAudioPlayer,
  switchActiveAudioTrack,
} from './audioPlayerInstance';

jest.mock('@/features/sync/stores/progressStore', () => ({
  progressStore: {
    savePosition: jest.fn(() => Promise.resolve()),
  },
}));

const mockSavePosition = progressStore.savePosition as jest.Mock;

describe('audioPlayerInstance', () => {
  beforeEach(() => {
    releaseCurrentAudioPlayer();
    jest.clearAllMocks();
    _resetAudioTtsCoordinatorForTests();
  });

  describe('singleton lifecycle', () => {
    it('creates a new player for a book and reuses it on subsequent calls', () => {
      const book1 = 'book-1' as BookId;
      const { player: player1, isNew: isNew1 } = getAudioPlayerFor(book1);
      expect(isNew1).toBe(true);
      expect(currentAudioBookId()).toBe(book1);

      const { player: player2, isNew: isNew2 } = getAudioPlayerFor(book1);
      expect(isNew2).toBe(false);
      expect(player2).toBe(player1);
    });

    it('releases the previous player and creates a new one when switching books', () => {
      const book1 = 'book-1' as BookId;
      const book2 = 'book-2' as BookId;

      const { player: player1 } = getAudioPlayerFor(book1);
      const removeSpy = jest.spyOn(player1, 'remove');

      const { player: player2, isNew: isNew2 } = getAudioPlayerFor(book2);
      expect(isNew2).toBe(true);
      expect(removeSpy).toHaveBeenCalled();
      expect(currentAudioBookId()).toBe(book2);
      expect(player2).not.toBe(player1);
    });
  });

  describe('concurrency and pauseCurrentAudioPlayer', () => {
    it('is a safe no-op when nothing is playing', () => {
      expect(() => pauseCurrentAudioPlayer()).not.toThrow();
      expect(mockSavePosition).not.toHaveBeenCalled();
    });

    it('pauses the player and commits position when playing', () => {
      const book = 'book-concurrency' as BookId;
      const { player } = getAudioPlayerFor(book);
      player.isLoaded = true;
      player.playing = true;
      player.currentTime = 42;

      const pauseSpy = jest.spyOn(player, 'pause');

      pauseCurrentAudioPlayer();

      expect(pauseSpy).toHaveBeenCalled();
      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 42000 },
        book,
      );
    });

    it('reports isAudioPlaying correctly and commitCurrentPlayerPosition writes position', () => {
      expect(isAudioPlaying()).toBe(false);

      const book = 'book-playing' as BookId;
      const { player } = getAudioPlayerFor(book);
      expect(isAudioPlaying()).toBe(false);

      player.isLoaded = true;
      player.playing = true;
      player.currentTime = 50;
      expect(isAudioPlaying()).toBe(true);

      commitCurrentPlayerPosition();
      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 50000 },
        book,
      );
    });

    it('can be triggered via coordinator pauseActiveAudio', () => {
      const book = 'book-coord' as BookId;
      const { player } = getAudioPlayerFor(book);
      player.isLoaded = true;
      player.playing = true;
      player.currentTime = 15;

      const pauseSpy = jest.spyOn(player, 'pause');

      pauseActiveAudio();

      expect(pauseSpy).toHaveBeenCalled();
      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 15000 },
        book,
      );
    });

    it('stops active TTS when player status changes to playing: true', () => {
      const ttsStopMock = jest.fn();
      registerActiveTtsSession({
        stop: ttsStopMock,
        isSpeaking: () => true,
        isActive: () => true,
      });

      const book = 'book-playback-event' as BookId;
      const { player } = getAudioPlayerFor(book);

      type PlayerWithEmit = typeof player & { emit: (event: string, payload: unknown) => void };
      const playerWithEmit = player as PlayerWithEmit;

      // Trigger status update where playing turns true
      playerWithEmit.emit('playbackStatusUpdate', {
        playing: true,
        currentTime: 0,
        duration: 100,
        isLoaded: true,
        isBuffering: false,
        playbackRate: 1,
        shouldCorrectPitch: false,
      });

      expect(ttsStopMock).toHaveBeenCalledTimes(1);

      // Subsequent ticks while still playing do not repeatedly fire
      playerWithEmit.emit('playbackStatusUpdate', {
        playing: true,
        currentTime: 1,
        duration: 100,
        isLoaded: true,
        isBuffering: false,
        playbackRate: 1,
        shouldCorrectPitch: false,
      });

      expect(ttsStopMock).toHaveBeenCalledTimes(1);
    });

    it('triggers registered track completion handler when didJustFinish is true', () => {
      const completionMock = jest.fn();
      registerTrackCompletionHandler(completionMock);

      const book = 'book-finished' as BookId;
      const { player } = getAudioPlayerFor(book);

      type PlayerWithEmit = typeof player & { emit: (event: string, payload: unknown) => void };
      const playerWithEmit = player as PlayerWithEmit;

      playerWithEmit.emit('playbackStatusUpdate', {
        playing: false,
        currentTime: 100,
        duration: 100,
        isLoaded: true,
        isBuffering: false,
        playbackRate: 1,
        shouldCorrectPitch: false,
        didJustFinish: true,
      });

      expect(completionMock).toHaveBeenCalledTimes(1);
      _resetTrackCompletionHandlerForTests();
    });

    it('switches active audio track replacing source and lock-screen metadata', () => {
      const book1 = 'book-switch-1' as BookId;
      const book2 = 'book-switch-2' as BookId;

      const { player } = getAudioPlayerFor(book1);
      player.isLoaded = true;
      player.currentTime = 50;

      const replaceSpy = jest.spyOn(player, 'replace');
      const lockScreenSpy = jest.spyOn(player, 'setActiveForLockScreen');
      const playSpy = jest.spyOn(player, 'play');

      switchActiveAudioTrack(book2, 'file:///scratch/new.wav', 'New Title', 'New Artist');

      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 50000 },
        book1,
      );
      expect(currentAudioBookId()).toBe(book2);
      expect(getCurrentAudioPlayer()).toBe(player);
      expect(replaceSpy).toHaveBeenCalledWith({ uri: 'file:///scratch/new.wav' });
      expect(lockScreenSpy).toHaveBeenCalledWith(
        true,
        { title: 'New Title', artist: 'New Artist' },
        { showSeekForward: true, showSeekBackward: true },
      );
      expect(playSpy).toHaveBeenCalled();
    });

    it('seeks to initialPositionSeconds on switchActiveAudioTrack', () => {
      const book1 = 'book-resume-1' as BookId;
      const { player } = getAudioPlayerFor(book1);
      player.isLoaded = true;
      player.duration = 300;

      const seekSpy = jest.spyOn(player, 'seekTo');

      switchActiveAudioTrack(
        'book-resume-2' as BookId,
        'file:///scratch/track2.wav',
        'Track 2',
        'Artist 2',
        120,
      );

      expect(seekSpy).toHaveBeenCalledWith(120);
    });

    it('clamps to 0 when initialPositionSeconds is near the end of the track', () => {
      const book = 'book-finished-resume' as BookId;
      const { player } = getAudioPlayerFor(book);
      player.isLoaded = true;
      player.duration = 100;

      const seekSpy = jest.spyOn(player, 'seekTo');

      switchActiveAudioTrack(
        'book-finished-next' as BookId,
        'file:///scratch/track3.wav',
        'Track 3',
        'Artist 3',
        99.5, // near end of 100s track
      );

      // Clamped to 0:00 rather than seeking to end
      expect(seekSpy).not.toHaveBeenCalledWith(99.5);
    });

    it('reuses loaded book without replacing source if switching to same active book', () => {
      const book = 'book-same' as BookId;
      const { player } = getAudioPlayerFor(book);
      player.isLoaded = true;
      player.playing = false;

      const replaceSpy = jest.spyOn(player, 'replace');
      const playSpy = jest.spyOn(player, 'play');

      switchActiveAudioTrack(book, 'file:///scratch/same.wav', 'Same Title');

      expect(replaceSpy).not.toHaveBeenCalled();
      expect(playSpy).toHaveBeenCalled();
    });
  });
});
