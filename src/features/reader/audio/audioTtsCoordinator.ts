// Owner: Reader (Ahana) & Accessibility (Hruthik).
//
// AUDIO SESSION CONCURRENCY COORDINATOR.
//
// Solves mutual exclusion between Audiobook playback (`expo-audio`) and Text-to-Speech
// (`@iternio/react-native-tts`). Because both native engines share the device's audio session
// under AVAudioSessionCategoryPlayback (iOS) / media and guidance audio attributes (Android)
// without native preemption, this coordinator guarantees that ONLY ONE audio source runs
// at a time:
//
//   1. TTS activated (play/resume) -> active Audiobook playback is PAUSED, committing its position.
//   2. Audiobook begins playback (UI play, lock screen, bluetooth) -> active TTS is STOPPED,
//      halting speech synthesis, clearing the EPUB highlight, and returning TTS status to 'idle'.
//
// Pure TypeScript — NO native module imports directly. Both subsystems register their callbacks
// here when active and unregister on teardown, avoiding cyclic imports and keeping the coordinator
// trivially testable under Jest without native mocking.
//
// AUDIO PLAYBACK BRIDGE (originally added for SLEEP_TIMER_PLAN.md §7, now a second consumer too —
// see the plain-TTS-play alert further down) keeps that same invariant, on purpose — importing
// `isAudioPlaying`/`resumeCurrentAudioPlayer` from audioPlayerInstance.ts directly (as
// SLEEP_TIMER_PLAN.md's own illustrative snippet does) would put a real edge back onto this file,
// and audioPlayerInstance.ts already imports FROM here (`registerAudioPauseHandler`,
// `stopActiveTts`) — a genuine cycle, not a hypothetical one: confirmed by reproducing it in
// isolation, this crashes with "registerAudioPauseHandler is not a function" whenever
// audioTtsCoordinator.ts happens to be the FIRST module loaded (exactly what
// audioTtsCoordinator.test.ts does today), because audioPlayerInstance.ts's own top-level
// `registerAudioPauseHandler(pauseCurrentAudioPlayer)` call would then run while THIS file is still
// mid-evaluation, before it has exported that function. `registerAudioPlaybackBridge` below is the
// same registration-callback shape this file already uses for TTS and for the pause handler,
// applied to what any caller here needs to ask of live audio — it gets the identical runtime
// behavior direct imports would, without adding the edge that breaks.

import { Alert } from 'react-native';

import { sleepTimerStore } from './sleepTimerStore';

export interface ActiveTtsSession {
  stop: () => void;
  isSpeaking: () => boolean;
  isActive: () => boolean;
}

let activeTtsSession: ActiveTtsSession | null = null;
let activeAudioPause: (() => void) | null = null;

/**
 * Registers the live TTS session so audio playback can stop speech if an audiobook plays.
 * Returns an unregister cleanup function to be called on session teardown.
 */
export function registerActiveTtsSession(session: ActiveTtsSession): () => void {
  activeTtsSession = session;
  return () => {
    if (activeTtsSession === session) {
      activeTtsSession = null;
    }
  };
}

/**
 * Stops active TTS speech and reconciles session state (clearing highlights and resetting
 * UI to idle). Safe to call when TTS is already idle or unmounted.
 */
export function stopActiveTts(): void {
  if (activeTtsSession && activeTtsSession.isActive()) {
    activeTtsSession.stop();
  }
}

/**
 * Returns whether TTS is currently active (speaking or paused).
 */
export function isTtsActive(): boolean {
  return activeTtsSession !== null && activeTtsSession.isActive();
}

/**
 * Returns whether TTS is currently producing speech.
 */
export function isTtsSpeaking(): boolean {
  return activeTtsSession !== null && activeTtsSession.isSpeaking();
}

/**
 * Registers the active audiobook pause handler (provided by audioPlayerInstance).
 */
export function registerAudioPauseHandler(pauseFn: () => void): () => void {
  activeAudioPause = pauseFn;
  return () => {
    if (activeAudioPause === pauseFn) {
      activeAudioPause = null;
    }
  };
}

/**
 * Pauses active audiobook playback if currently playing and commits the live player position.
 * Called before TTS begins speaking so audio session concurrency is mutually exclusive.
 */
export function pauseActiveAudio(): void {
  activeAudioPause?.();
}

/**
 * Test-only reset helper to clear registered TTS session between test cases.
 */
export function _resetAudioTtsCoordinatorForTests(): void {
  activeTtsSession = null;
}

// ── Additive extensions below this point — nothing above changes: pauseActiveAudio() (TTS→pause
// audio) and stopActiveTts() (audio→stop TTS) keep doing exactly what they do today, for every
// caller, sleep timer or not.

export interface AudioPlaybackBridge {
  /** A fresh read of whether the live audio player is producing sound right now. */
  isAudioPlaying: () => boolean;
  /** Resumes audio the same way AudioPlayerScreen's own beginPlayback() would — including
   * re-asserting the audio session, since TTS may have touched AVAudioSession. */
  resumeAudioAfterTts: () => void;
}

let audioPlaybackBridge: AudioPlaybackBridge | null = null;

/**
 * Registers the live audio query/resume hooks this file's TTS-side callers need (provided by
 * audioPlayerInstance.ts, mirroring `registerAudioPauseHandler`'s own shape). Returns an
 * unregister cleanup function; see this file's header for why this exists instead of a direct
 * import. Originally added for the sleep timer's TTS guard (below); `pauseActiveAudioForTtsPlay`
 * is a second, independent consumer of the same `isAudioPlaying` query.
 */
export function registerAudioPlaybackBridge(bridge: AudioPlaybackBridge): () => void {
  audioPlaybackBridge = bridge;
  return () => {
    if (audioPlaybackBridge === bridge) {
      audioPlaybackBridge = null;
    }
  };
}

/**
 * Called before TTS is switched ON. If a sleep timer is currently running and audio is currently
 * playing, pauses it (via the EXISTING pauseActiveAudio(), unchanged), marks that pause as
 * TTS-caused for resumeAudioIfPausedForSleepTimerTts()'s resume rule, shows a compulsory
 * one-button Alert, and only invokes `proceed` after the user acknowledges. Otherwise invokes
 * `proceed` immediately — a total no-op outside the sleep-timer-armed case.
 */
export function guardTtsEnableForSleepTimer(proceed: () => void): void {
  const isAudioPlaying = audioPlaybackBridge?.isAudioPlaying() ?? false;
  if (sleepTimerStore.getState().phase === 'running' && isAudioPlaying) {
    pauseActiveAudio();
    sleepTimerStore.getState().setPausedForTts(true);
    Alert.alert(
      'Sleep Timer Active',
      'Audio has been paused because Text-to-Speech is starting. It will not play while TTS is ' +
        'active — your sleep timer will keep running in the background.',
      [{ text: 'OK', onPress: proceed }],
      { cancelable: false },
    );
    return;
  }
  proceed();
}

/**
 * Called when TTS is switched OFF. If the pause it left behind was this module's own doing (not
 * an ordinary manual pause) and the timer hasn't fired since, resumes playback. A no-op otherwise
 * (nothing here ever resumes audio that paused for any other reason, and never resumes after the
 * timer has already fired — sleepTimerStore's own `fire()` clears `pausedForTts` unconditionally).
 */
export function resumeAudioIfPausedForSleepTimerTts(): void {
  const { phase, pausedForTts } = sleepTimerStore.getState();
  if (phase === 'running' && pausedForTts) {
    sleepTimerStore.getState().setPausedForTts(false);
    audioPlaybackBridge?.resumeAudioAfterTts();
  }
}

/**
 * Called ONLY from the actual TTS "Play" action (useTtsSession.ts's `playRef.current`) — not from
 * the sentence-to-sentence/continuation call sites in that same file, which already hold audio
 * paused from the FIRST such call and would otherwise pop this alert on every sentence. Reads
 * `isAudioPlaying()` BEFORE pausing so the Alert only fires when this press genuinely interrupted
 * something: the ordinary case (audio already paused, or nothing was ever playing) stays silent,
 * matching pauseActiveAudio()'s own existing idempotent-no-op behavior for that case.
 *
 * Independent of the sleep timer guard above — this fires regardless of whether a sleep timer is
 * armed, because pressing TTS Play in `TtsControls` never goes through
 * `guardTtsEnableForSleepTimer` (that gate only wraps the Accessibility settings toggle, per
 * SLEEP_TIMER_PLAN.md §7). No double-alert risk in practice: if the settings toggle already paused
 * audio for a sleep timer, `isAudioPlaying()` is already false by the time Play is pressed, so
 * this function stays silent.
 */
export function pauseActiveAudioForTtsPlay(): void {
  const wasPlaying = audioPlaybackBridge?.isAudioPlaying() ?? false;
  pauseActiveAudio();
  if (wasPlaying) {
    Alert.alert('Audio Paused', 'Audio has been paused because Text-to-Speech started playing.', [
      { text: 'OK' },
    ]);
  }
}

/**
 * Test-only reset helper, mirroring `_resetAudioTtsCoordinatorForTests()` above for the audio
 * playback bridge specifically — kept separate rather than folded into that function since
 * existing tests for the pause-handler channel already register/unregister explicitly per test
 * instead of relying on a shared reset (see audioTtsCoordinator.test.ts's "Audio pause
 * registration" block).
 */
export function _resetAudioPlaybackBridgeForTests(): void {
  audioPlaybackBridge = null;
}
