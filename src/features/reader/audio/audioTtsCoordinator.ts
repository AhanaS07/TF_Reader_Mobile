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
