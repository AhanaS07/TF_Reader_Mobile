// Owner: Reader (Ahana) & Accessibility (Hruthik).
//
// Unit tests for audioTtsCoordinator.ts: proves mutual exclusion guarantees and lifecycle registration.

import { Alert } from 'react-native';

import {
  _resetAudioTtsCoordinatorForTests,
  _resetSleepTimerAudioBridgeForTests,
  guardTtsEnableForSleepTimer,
  isTtsActive,
  isTtsSpeaking,
  pauseActiveAudio,
  registerActiveTtsSession,
  registerAudioPauseHandler,
  registerSleepTimerAudioBridge,
  resumeAudioIfPausedForSleepTimerTts,
  stopActiveTts,
} from './audioTtsCoordinator';
import { useSleepTimerStore } from './sleepTimerStore';

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

// ── Sleep timer additions (SLEEP_TIMER_PLAN.md §7) ──────────────────────────────────────────────
//
// A SEPARATE top-level describe, not nested under the block above: these tests exercise the
// sleepTimerStore + a mocked SleepTimerAudioBridge, not the TTS-session/pause-handler channels
// that block's own beforeEach resets. registerSleepTimerAudioBridge/pauseActiveAudio are exercised
// directly here rather than through a real audioPlayerInstance import, on purpose — the whole
// point of that registration seam (see audioTtsCoordinator.ts's own header) is that this file
// stays testable without mocking a native module.
describe('sleep timer additions', () => {
  const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  beforeEach(() => {
    _resetAudioTtsCoordinatorForTests();
    _resetSleepTimerAudioBridgeForTests();
    useSleepTimerStore.getState().cancel();
    mockAlert.mockClear();
  });

  describe('guardTtsEnableForSleepTimer', () => {
    it('proceeds immediately when no sleep timer is running', () => {
      const proceed = jest.fn();
      guardTtsEnableForSleepTimer(proceed);

      expect(proceed).toHaveBeenCalledTimes(1);
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('proceeds immediately when a timer is running but audio is not playing', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      registerSleepTimerAudioBridge({
        isAudioPlaying: () => false,
        resumeAudioAfterTts: jest.fn(),
      });

      const proceed = jest.fn();
      guardTtsEnableForSleepTimer(proceed);

      expect(proceed).toHaveBeenCalledTimes(1);
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('pauses audio, marks pausedForTts, and shows a compulsory Alert when a timer is running and audio is playing', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      const pauseFn = jest.fn();
      registerAudioPauseHandler(pauseFn);
      registerSleepTimerAudioBridge({
        isAudioPlaying: () => true,
        resumeAudioAfterTts: jest.fn(),
      });

      const proceed = jest.fn();
      guardTtsEnableForSleepTimer(proceed);

      expect(pauseFn).toHaveBeenCalledTimes(1);
      expect(useSleepTimerStore.getState().pausedForTts).toBe(true);
      expect(mockAlert).toHaveBeenCalledTimes(1);
      // proceed is NOT called yet — only after the user acknowledges the Alert.
      expect(proceed).not.toHaveBeenCalled();

      const [title, , buttons, options] = mockAlert.mock.calls[0];
      expect(title).toBe('Sleep Timer Active');
      expect(options).toEqual({ cancelable: false });

      (buttons as { text: string; onPress?: () => void }[])[0].onPress?.();
      expect(proceed).toHaveBeenCalledTimes(1);
    });

    it('is a total no-op outside the sleep-timer-armed case even with no bridge registered', () => {
      // No registerSleepTimerAudioBridge call at all — phase is 'idle', so isAudioPlaying() must
      // never even be read.
      const proceed = jest.fn();
      expect(() => guardTtsEnableForSleepTimer(proceed)).not.toThrow();
      expect(proceed).toHaveBeenCalledTimes(1);
    });
  });

  describe('resumeAudioIfPausedForSleepTimerTts', () => {
    it('resumes audio when the pause was this module’s own doing and the timer is still running', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);
      const resumeFn = jest.fn();
      registerSleepTimerAudioBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).toHaveBeenCalledTimes(1);
      expect(useSleepTimerStore.getState().pausedForTts).toBe(false);
    });

    it('is a no-op for an ordinary manual pause (pausedForTts was never set)', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      const resumeFn = jest.fn();
      registerSleepTimerAudioBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).not.toHaveBeenCalled();
    });

    it('is a no-op once the timer has fired, even if pausedForTts was set beforehand', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);
      useSleepTimerStore.getState().fire();
      const resumeFn = jest.fn();
      registerSleepTimerAudioBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).not.toHaveBeenCalled();
    });

    it('is a safe no-op when no bridge is registered', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);

      expect(() => resumeAudioIfPausedForSleepTimerTts()).not.toThrow();
    });
  });

  describe('registerSleepTimerAudioBridge', () => {
    it('unregisters cleanly and ignores stale unregister calls', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);

      const resume1 = jest.fn();
      const unregister1 = registerSleepTimerAudioBridge({
        isAudioPlaying: () => false,
        resumeAudioAfterTts: resume1,
      });
      const resume2 = jest.fn();
      registerSleepTimerAudioBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resume2 });

      // Stale unregister1 must not clear bridge 2's registration.
      unregister1();
      resumeAudioIfPausedForSleepTimerTts();

      expect(resume1).not.toHaveBeenCalled();
      expect(resume2).toHaveBeenCalledTimes(1);
    });
  });
});
