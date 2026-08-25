// Jest manual mock for `expo-audio` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// AUDIO PHASE 2 (src/features/reader/audio/). jest-expo's preset does NOT provide a working
// runtime stand-in for this module: `expo-audio`'s `AudioPlayer` extends a native `SharedObject`
// class that isn't backed by anything under Jest, and requiring the real module unmocked throws
// immediately (`TypeError: Cannot read properties of undefined (reading 'prototype')`,
// node_modules/expo-audio/src/ExpoAudio.ts:30) the moment App.tsx's import graph reaches it —
// confirmed by running the suite without this mock first, not assumed. Same category of gap as
// this directory's other expo-*/react-native-* native module mocks.
//
// UNLIKE expo-crypto.js/react-native-quick-crypto.js in this same directory, there is no Node
// equivalent to back this with real behavior — audio playback has no server-side analogue. This
// is a plain stub: it proves the JS call sites (useAudioPlayerSetup's memoization,
// AudioPlayerScreen's player creation) are reachable and don't throw, NOT that expo-audio itself
// behaves correctly. That confirmation is manual, on a real device — see AUDIO_PLAYER_DECISION.md.
//
// Only the members this repo's code actually references (useAudioPlayerSetup.ts,
// AudioPlayerScreen.tsx) — not the full real module surface.
function createAudioPlayer() {
  return {
    playing: false,
    currentTime: 0,
    duration: 0,
    isLoaded: true,
    playbackRate: 1,
    play: () => undefined,
    pause: () => undefined,
    seekTo: () => Promise.resolve(),
    setPlaybackRate: () => undefined,
    setActiveForLockScreen: () => undefined,
    updateLockScreenMetadata: () => undefined,
    clearLockScreenControls: () => undefined,
    remove: () => undefined,
  };
}

// STATIC, NOT REACTIVE — a fixed "already loaded, at rest" snapshot, matching this file's own
// "proves reachable, not correct" scope. AudioPlayerScreen.test.tsx overrides this module locally
// with a controllable fake to actually exercise loading/error/playback states; this generic
// fallback only needs to keep anything that transitively imports AudioPlayerScreen (e.g.
// App.test.tsx, via RootNavigator's eager route imports) from crashing at render.
function useAudioPlayer(source) {
  return createAudioPlayer(source);
}

function useAudioPlayerStatus(player) {
  return player;
}

module.exports = {
  setAudioModeAsync: () => Promise.resolve(),
  createAudioPlayer,
  useAudioPlayer,
  useAudioPlayerStatus,
};
