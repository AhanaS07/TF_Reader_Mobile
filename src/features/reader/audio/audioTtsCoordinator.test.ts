// Owner: Reader (Ahana) & Accessibility (Hruthik).
//
// Unit tests for audioTtsCoordinator.ts: proves mutual exclusion guarantees and lifecycle registration.

import {
  _resetAudioTtsCoordinatorForTests,
  isTtsActive,
  isTtsSpeaking,
  pauseActiveAudio,
  registerActiveTtsSession,
  registerAudioPauseHandler,
  stopActiveTts,
} from './audioTtsCoordinator';

describe('audioTtsCoordinator', () => {
  beforeEach(() => {
    _resetAudioTtsCoordinatorForTests();
  });

  describe('TTS session registration and stopping', () => {
    it('reports TTS inactive when no session is registered', () => {
      expect(isTtsActive()).toBe(false);
      expect(isTtsSpeaking()).toBe(false);
      // stopActiveTts is a safe no-op
      expect(() => stopActiveTts()).not.toThrow();
    });

    it('stops active TTS session when active and isTtsActive is true', () => {
      const stopFn = jest.fn();
      let speaking = true;
      let active = true;

      const unregister = registerActiveTtsSession({
        stop: stopFn,
        isSpeaking: () => speaking,
        isActive: () => active,
      });

      expect(isTtsActive()).toBe(true);
      expect(isTtsSpeaking()).toBe(true);

      stopActiveTts();
      expect(stopFn).toHaveBeenCalledTimes(1);

      // When inactive (e.g. idle), stopActiveTts does not call stop again
      active = false;
      speaking = false;
      stopActiveTts();
      expect(stopFn).toHaveBeenCalledTimes(1);

      unregister();
      expect(isTtsActive()).toBe(false);
    });

    it('unregisters cleanly and ignores stale unregister calls', () => {
      const stop1 = jest.fn();
      const stop2 = jest.fn();

      const unregister1 = registerActiveTtsSession({
        stop: stop1,
        isSpeaking: () => true,
        isActive: () => true,
      });

      const unregister2 = registerActiveTtsSession({
        stop: stop2,
        isSpeaking: () => true,
        isActive: () => true,
      });

      // Calling stale unregister1 does not clear session 2
      unregister1();
      expect(isTtsActive()).toBe(true);

      stopActiveTts();
      expect(stop1).not.toHaveBeenCalled();
      expect(stop2).toHaveBeenCalledTimes(1);

      unregister2();
      expect(isTtsActive()).toBe(false);
    });
  });

  describe('Audio pause registration', () => {
    it('calls registered pause handler when pauseActiveAudio is invoked', () => {
      const pauseFn = jest.fn();
      const unregister = registerAudioPauseHandler(pauseFn);

      pauseActiveAudio();
      expect(pauseFn).toHaveBeenCalledTimes(1);

      unregister();
      pauseActiveAudio();
      expect(pauseFn).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op when no pause handler is registered', () => {
      expect(() => pauseActiveAudio()).not.toThrow();
    });
  });
});
