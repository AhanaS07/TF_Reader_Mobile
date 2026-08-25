// Owner: Reader (Ahana).
//
// AUDIO PHASE 2 — REWRITTEN FOR expo-audio. See AUDIO_PLAYER_DECISION.md (this directory) for why
// react-native-track-player was dropped (New Architecture incompatibility) in favour of this.
// Filename and hook name are UNCHANGED from the RNTP version on purpose — App.tsx's call site
// (`useAudioPlayerSetup()`) did not need to change at all.
//
// UNLIKE RNTP, expo-audio has NO root/headless playback-service registration to make — its
// background-service wiring (Android's foreground service, the manifest entries) is entirely
// config-plugin-driven (app.json's `expo-audio` plugin entry, applied at prebuild time), not a
// runtime `registerPlaybackService` call. index.js is back to exactly what it was before AUDIO
// PHASE 2 first touched it.
//
// WHAT THIS HOOK ACTUALLY DOES: configures the GLOBAL audio session once, app-wide — the
// `shouldPlayInBackground`/`interruptionMode` combination expo-audio's own docs describe as the
// prerequisite for background playback and lock-screen controls to work at all. It does NOT call
// `setActiveForLockScreen` — that is a PER-PLAYER method (`AudioPlayer.setActiveForLockScreen`,
// confirmed against this installed version's AudioModule.types.d.ts), not a global one, so it has
// no meaning here, where no player exists yet. It is called wherever a player actually gets
// created instead — AudioPlayerScreen.tsx.
//
// `interruptionMode: 'doNotMix'` is REQUIRED, not just a preference, for setActiveForLockScreen to
// work reliably — expo-audio's own doc comment on that method: "the OS might not associate lock
// screen controls with your player" without it. `allowsRecording: false` is deliberate: this app
// never records audio (AUDIO_PLAYER_DECISION.md; app.json's `expo-audio` plugin options already
// set `microphonePermission`/`recordAudioAndroid` to false to match) — expo-audio derives the iOS
// AVAudioSession category from this combination of booleans rather than exposing a raw category
// string the way RNTP's `iosCategory` did; there is no separate "category" field to set.
//
// MEMOIZED, but more lightly than trackPlayerSetup.ts's RNTP version needed: setAudioModeAsync has
// no documented foreground-only timing constraint (RNTP's setupPlayer had one on Android) and no
// documented harm from being called more than once — this still runs exactly once per process
// rather than once per mount (React StrictMode), but there is no specific lifecycle hazard being
// guarded against, just avoided redundant native calls.

import { useEffect } from 'react';

import { setAudioModeAsync } from 'expo-audio';
import { AppState } from 'react-native';

import { commitCurrentPlayerPosition } from './audioPlayerInstance';

let setupPromise: Promise<void> | null = null;

/** Exported so a screen that is about to claim the lock screen can ORDER itself after the global
 * audio-session config rather than assume it. `setActiveForLockScreen` only associates the OS lock
 * screen with a player when the session category is already `.playback` — which is set here, by
 * `setAudioModeAsync`, and nowhere else. App.tsx calling this hook at mount makes that ordering
 * true in practice today; awaiting the same memoized promise makes it true by construction.
 * Idempotent: every caller shares the one in-flight/settled promise. */
export function ensureAudioModeConfigured(): Promise<void> {
  if (!setupPromise) {
    setupPromise = setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      allowsRecording: false,
    }).catch((error: unknown) => {
      setupPromise = null;
      throw error;
    });
  }
  return setupPromise;
}

export function useAudioPlayerSetup(): void {
  useEffect(() => {
    void (async () => {
      try {
        await ensureAudioModeConfigured();
      } catch (error) {
        // Without this, a rejection here becomes a silent unhandled-promise-rejection —
        // indistinguishable from "nothing played because nothing tried to." Loud on purpose; this
        // is the one thing standing between "no sound" and "no sound AND no idea why."
        console.error('[useAudioPlayerSetup] audio bootstrap failed:', error);
      }
    })();
  }, []);

  // AUDIO PHASE 4: persist the playing book's position when the app leaves the foreground.
  //
  // THIS LIVES APP-WIDE, NOT IN AudioPlayerScreen, because that is the whole point of the
  // background-playback design: audio outlives the screen, so at the moment the app is backgrounded
  // there may be no player screen mounted to react to it — and backgrounding is the last reliable
  // callback before the OS may terminate the process without one. commitCurrentPlayerPosition()
  // reads the singleton, so it does not need a screen to tell it what is playing.
  //
  // Hosted in this hook rather than a new one so App.tsx (outside Reader's ownership) needs no
  // change; this is already the app-wide audio-lifecycle hook it calls.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        commitCurrentPlayerPosition();
      }
    });
    return () => subscription.remove();
  }, []);
}
