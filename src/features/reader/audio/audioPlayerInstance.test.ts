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
  commitCurrentPlayerPosition,
  currentAudioBookId,
  getAudioPlayerFor,
  isAudioPlaying,
  pauseCurrentAudioPlayer,
  releaseCurrentAudioPlayer,
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
  });
});
