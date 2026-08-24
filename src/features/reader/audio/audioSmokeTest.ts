// Owner: Reader (Ahana).
//
// >>> TEMPORARY — AUDIO PHASE 2 ONLY. <<<
// DELETE THIS FILE, AND THE ONE CALL TO IT FROM useAudioPlayerSetup.ts, BEFORE PHASE 3 STARTS.
// Its whole job is proving expo-audio produces sound — and, this time, SUSTAINED BACKGROUND sound
// with working lock-screen controls — on a REAL device, now that RNTP has been dropped for New
// Architecture incompatibility (see AUDIO_PLAYER_DECISION.md). Once confirmed by hand, it has no
// further reason to exist. Do not fold any of it into Phase 3's real playback wiring; write that
// fresh, against audioAssetResolver.ts, not against this file's shortcuts.
//
// DELIBERATELY DOES NOT CALL audioAssetResolver, getBook(), or contentStore — same isolation
// reasoning the RNTP version had: a failure here can only mean "the native expo-audio
// install/config is wrong," never "the acquisition wiring is wrong."
//
// Loads assets/reader/sample-plaintext.wav as a bundled Metro asset (require()) — the SAME
// generated fixture Phase 1 seeds through the encryption path, reached here by a completely
// separate route (expo-audio's own AudioSource resolution, not expo-asset/expo-file-system).
//
// OFF BY DEFAULT. Set EXPO_PUBLIC_READER_AUDIO_SMOKE_TEST=1 and reload (EXPO_PUBLIC_* is inlined
// at transform time, same caveat devContentSeed.ts's own fixture-path env vars carry) to run it.
//
// SIMULATORS DO NOT RELIABLY SHOW/ROUTE LOCK-SCREEN OR NOW-PLAYING CONTROLS. "It compiled and
// didn't crash in the simulator" is not the acceptance bar here — audible sound that SURVIVES
// backgrounding, with working lock-screen controls, on a REAL device is. expo-audio's own docs
// warn that on Android, without setActiveForLockScreen, background playback stops after ~3
// minutes regardless (an OS limitation) — our 60s fixture is too short to hit that ceiling, so a
// real audiobook-length check is still worth doing before trusting this beyond the smoke test.
//
// setActiveForLockScreen(true, ...) HAPPENS HERE, not in useAudioPlayerSetup.ts — it is a
// PER-PLAYER method, and this is the first (and, for this phase, only) place a player exists.
// Requires useAudioPlayerSetup.ts's setAudioModeAsync({interruptionMode: 'doNotMix', ...}) to have
// already run — expo-audio's own doc comment on setActiveForLockScreen says the OS "might not
// associate lock screen controls with your player" otherwise. That ordering is guaranteed by
// useAudioPlayerSetup.ts awaiting ensureAudioModeConfigured() before calling this function.

import { createAudioPlayer } from 'expo-audio';

// Metro asset handle, same convention as devContentSeed.ts's sample-asset requires().
const SAMPLE_WAV_MODULE = require('../../../../assets/reader/sample-plaintext.wav') as number;

export async function runAudioSmokeTestIfEnabled(): Promise<void> {
  if (process.env.EXPO_PUBLIC_READER_AUDIO_SMOKE_TEST !== '1') {
    // Loud on purpose: EXPO_PUBLIC_* is inlined at TRANSFORM time (Metro), not read live — a
    // stale/reused Metro bundler process is the single most common reason this flag "doesn't
    // work" despite being set correctly in the shell. If this line prints "off" when you expected
    // "on", stop and restart Metro with --clear before looking anywhere else.
    console.log('[audioSmokeTest] EXPO_PUBLIC_READER_AUDIO_SMOKE_TEST is off — skipping.');
    return;
  }

  console.log('[audioSmokeTest] flag is on — creating player for', SAMPLE_WAV_MODULE);

  try {
    // Unlike RNTP's `AddTrack` (which collapsed its own `url: string | ResourceObject` union down
    // to plain `string` — see the deleted RNTP version of this file), expo-audio's `AudioSource`
    // type correctly includes `number` (a Metro require() handle). Confirmed against this
    // installed version's own Audio.types.d.ts — no cast needed here.
    const player = createAudioPlayer(SAMPLE_WAV_MODULE);

    player.setActiveForLockScreen(true, {
      title: 'AUDIO PHASE 2 smoke test',
      artist: 'TF Reader (temporary — see this file header)',
    });

    player.play();
    console.log('[audioSmokeTest] play() called, isLoaded =', player.isLoaded);
  } catch (error) {
    // This function used to let a failure here vanish into an unhandled rejection — silent by
    // default in RN/Hermes unless you happen to be watching for the yellow-box warning. A
    // throwaway diagnostic file that fails silently defeats its entire purpose, so this is a
    // real fix, not scope creep: the whole point of this file is "tell you what broke."
    console.error('[audioSmokeTest] failed:', error);
    throw error;
  }
}
