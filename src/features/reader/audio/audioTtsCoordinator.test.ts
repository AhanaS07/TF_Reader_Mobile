// Owner: Reader (Ahana) & Accessibility (Hruthik).
//
// Unit tests for audioTtsCoordinator.ts: proves mutual exclusion guarantees and lifecycle registration.

import { Alert } from 'react-native';

import {
  _resetAudioTtsCoordinatorForTests,
  _resetAudioPlaybackBridgeForTests,
  guardTtsEnableForSleepTimer,
  isTtsActive,
  isTtsSpeaking,
  pauseActiveAudio,
  pauseActiveAudioForTtsPlay,
  registerActiveTtsSession,
  registerAudioPauseHandler,
  registerAudioPlaybackBridge,
  resumeAudioIfPausedForSleepTimerTts,
  stopActiveTts,
} from './audioTtsCoordinator';
import { useSleepTimerStore } from './sleepTimerStore';

// Module-scope, shared by every describe block below that needs it — a SECOND jest.spyOn(Alert,
// 'alert') call in a later describe would spy on top of an already-spied function rather than
// replacing it, stacking rather than cleanly resetting between blocks.
const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

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
// sleepTimerStore + a mocked AudioPlaybackBridge, not the TTS-session/pause-handler channels
// that block's own beforeEach resets. registerAudioPlaybackBridge/pauseActiveAudio are exercised
// directly here rather than through a real audioPlayerInstance import, on purpose — the whole
// point of that registration seam (see audioTtsCoordinator.ts's own header) is that this file
// stays testable without mocking a native module.
describe('sleep timer additions', () => {
  beforeEach(() => {
    _resetAudioTtsCoordinatorForTests();
    _resetAudioPlaybackBridgeForTests();
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
      registerAudioPlaybackBridge({
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
      registerAudioPlaybackBridge({
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
      // No registerAudioPlaybackBridge call at all — phase is 'idle', so isAudioPlaying() must
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
      registerAudioPlaybackBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).toHaveBeenCalledTimes(1);
      expect(useSleepTimerStore.getState().pausedForTts).toBe(false);
    });

    it('is a no-op for an ordinary manual pause (pausedForTts was never set)', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      const resumeFn = jest.fn();
      registerAudioPlaybackBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).not.toHaveBeenCalled();
    });

    it('is a no-op once the timer has fired, even if pausedForTts was set beforehand', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);
      useSleepTimerStore.getState().fire();
      const resumeFn = jest.fn();
      registerAudioPlaybackBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resumeFn });

      resumeAudioIfPausedForSleepTimerTts();

      expect(resumeFn).not.toHaveBeenCalled();
    });

    it('is a safe no-op when no bridge is registered', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);

      expect(() => resumeAudioIfPausedForSleepTimerTts()).not.toThrow();
    });
  });

  describe('registerAudioPlaybackBridge', () => {
    it('unregisters cleanly and ignores stale unregister calls', () => {
      useSleepTimerStore.getState().arm(60, Date.now() + 60_000);
      useSleepTimerStore.getState().setPausedForTts(true);

      const resume1 = jest.fn();
      const unregister1 = registerAudioPlaybackBridge({
        isAudioPlaying: () => false,
        resumeAudioAfterTts: resume1,
      });
      const resume2 = jest.fn();
      registerAudioPlaybackBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: resume2 });

      // Stale unregister1 must not clear bridge 2's registration.
      unregister1();
      resumeAudioIfPausedForSleepTimerTts();

      expect(resume1).not.toHaveBeenCalled();
      expect(resume2).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Plain TTS "Play" alert ───────────────────────────────────────────────────────────────────────
//
// Exercises `pauseActiveAudioForTtsPlay` — the plain-audio-and-plain-TTS case, independent of any
// sleep timer. A separate top-level describe for the same reason as "sleep timer additions" above.
describe('pauseActiveAudioForTtsPlay', () => {
  beforeEach(() => {
    _resetAudioTtsCoordinatorForTests();
    _resetAudioPlaybackBridgeForTests();
    mockAlert.mockClear();
  });

  it('pauses audio and shows the "Audio Paused" alert when audio was actually playing', () => {
    const pauseFn = jest.fn();
    registerAudioPauseHandler(pauseFn);
    registerAudioPlaybackBridge({ isAudioPlaying: () => true, resumeAudioAfterTts: jest.fn() });

    pauseActiveAudioForTtsPlay();

    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, message] = mockAlert.mock.calls[0];
    expect(title).toBe('Audio Paused');
    expect(message).toBe('Audio has been paused because Text-to-Speech started playing.');
  });

  it('is silent when audio was not playing — nothing was interrupted', () => {
    const pauseFn = jest.fn();
    registerAudioPauseHandler(pauseFn);
    registerAudioPlaybackBridge({ isAudioPlaying: () => false, resumeAudioAfterTts: jest.fn() });

    pauseActiveAudioForTtsPlay();

    // pauseActiveAudio() is still called — it's already an idempotent no-op when nothing is
    // playing (matching the existing rule 1's own behavior) — but no Alert.
    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('is silent with no bridge registered at all — never even reads isAudioPlaying', () => {
    const pauseFn = jest.fn();
    registerAudioPauseHandler(pauseFn);

    expect(() => pauseActiveAudioForTtsPlay()).not.toThrow();
    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('does not double-alert on a second call once audio is already paused (the continuation-call-site case)', () => {
    let playing = true;
    const pauseFn = jest.fn(() => {
      playing = false;
    });
    registerAudioPauseHandler(pauseFn);
    registerAudioPlaybackBridge({ isAudioPlaying: () => playing, resumeAudioAfterTts: jest.fn() });

    pauseActiveAudioForTtsPlay();
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // A second call (mirroring speakSentence()/handleTtsStart()'s own redundant calls to the plain
    // pauseActiveAudio() elsewhere in useTtsSession.ts) — audio is already paused, so this must
    // stay silent rather than popping a second Alert.
    mockAlert.mockClear();
    pauseActiveAudioForTtsPlay();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

// ── Sleep timer alert vs. plain TTS-play alert: proven independent, not just asserted ──────────
//
// guardTtsEnableForSleepTimer (wired to AccessibilitySettingsPanel's TTS toggle) and
// pauseActiveAudioForTtsPlay (wired to useTtsSession's actual Play action) are two separate call
// sites that never call each other and never fire from the same user action. Each scenario below
// is the realistic sequence a user could actually trigger.
describe('sleep timer alert vs. plain TTS-play alert', () => {
  beforeEach(() => {
    _resetAudioTtsCoordinatorForTests();
    _resetAudioPlaybackBridgeForTests();
    useSleepTimerStore.getState().cancel();
    mockAlert.mockClear();
  });

  it('toggling TTS on with a sleep timer running shows ONLY "Sleep Timer Active" — pressing Play afterward stays silent', () => {
    let playing = true;
    registerAudioPauseHandler(
      jest.fn(() => {
        playing = false;
      }),
    );
    registerAudioPlaybackBridge({
      isAudioPlaying: () => playing,
      resumeAudioAfterTts: jest.fn(),
    });
    useSleepTimerStore.getState().arm(60, Date.now() + 60_000);

    // 1) The settings toggle — guardTtsEnableForSleepTimer.
    guardTtsEnableForSleepTimer(jest.fn());
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toBe('Sleep Timer Active');

    // 2) The user then presses Play in TtsControls — pauseActiveAudioForTtsPlay. Audio is
    // already paused from step 1, so this must add NO second alert of either kind.
    mockAlert.mockClear();
    pauseActiveAudioForTtsPlay();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('toggling TTS on with NO sleep timer running shows nothing — pressing Play afterward shows ONLY "Audio Paused"', () => {
    registerAudioPauseHandler(jest.fn());
    registerAudioPlaybackBridge({ isAudioPlaying: () => true, resumeAudioAfterTts: jest.fn() });
    // Sleep timer left idle (beforeEach's cancel()).

    guardTtsEnableForSleepTimer(jest.fn());
    expect(mockAlert).not.toHaveBeenCalled();

    pauseActiveAudioForTtsPlay();
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toBe('Audio Paused');
  });

  it('pressing Play directly with a sleep timer running (settings toggle never touched) shows the plain alert, not the sleep timer one', () => {
    // guardTtsEnableForSleepTimer is never called in this scenario — the two functions genuinely
    // don't call each other, so nothing here can produce "Sleep Timer Active".
    registerAudioPauseHandler(jest.fn());
    registerAudioPlaybackBridge({ isAudioPlaying: () => true, resumeAudioAfterTts: jest.fn() });
    useSleepTimerStore.getState().arm(60, Date.now() + 60_000);

    pauseActiveAudioForTtsPlay();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toBe('Audio Paused');
  });
});
