# Audio player: react-native-track-player → expo-audio

**Status: decided.** Recorded here because anyone reviewing the audio work will reasonably ask
"why not RNTP" — it's the obvious, most-featureful choice for background audio in RN, and it's
what AUDIO_PHASE0_FINDINGS.md's own Phase 2 plan originally called for. This answers it once.

## What happened

Phase 2 started with `react-native-track-player` (RNTP) 4.1.2 — pinned exactly, installed, wired
(`registerPlaybackService` in `index.js`, `useAudioPlayerSetup()` in `App.tsx`, a throwaway smoke
test). Before shipping it, `npx expo-doctor` plus a build-config validation pass surfaced a real
blocker, and the decision was made to drop RNTP entirely in favor of `expo-audio` instead.

## The three reasons

1. **This project runs on New Architecture with no way to turn it off.** RN 0.86.2 (installed)
   hardcodes `RCTIsNewArchEnabled() { return YES; }` in its own native source
   (`node_modules/react-native/React/Base/RCTUtils.mm`) — confirmed by reading the actual shipped
   code, not assumed. There is no `newArchEnabled: false` escape hatch at this RN version; the old
   architecture is gone.

2. **RNTP's stable (v4) line is frozen and not New-Architecture-supported.** `expo-doctor` flagged
   it directly: *"Unsupported on New Architecture: react-native-track-player."* React Native
   Directory's own metadata confirms `"newArchitecture": false`. It can still often run under RN's
   backward-compatibility interop layer for old-style native modules, but that is exactly the kind
   of "probably works, not verified" foundation a core, always-on background-audio feature
   shouldn't be built on — real, recent community reports exist of New-Arch-specific breakage in
   RNTP v4 (e.g. iOS background audio dropping ~30s after screen lock; Android cold-start headless
   task delivery failing). None of that is hypothetical risk-aversion; it's what turned up checking.

3. **RNTP's New-Arch-native rewrite (v5) is commercially licensed.** v5 is no longer an alpha —
   it's stable and built New-Arch-native from the ground up, which would solve reason #2 outright.
   But it ships under a commercial license. This is a Taylor & Francis product; adopting a paid,
   licensed dependency is a legal/procurement decision, not an engineering one, and is out of
   scope for this work regardless of its technical merits.

Given RN 0.86's architecture is fixed (reason 1) and RNTP v4 doesn't support it (reason 2) and
RNTP v5 isn't available to this project (reason 3), staying on RNTP in any form wasn't an option
— not a preference between "patch it" and "pay for it," there wasn't a free, New-Arch-compatible
path through RNTP at all.

## Why expo-audio

- New-Architecture-native by construction (it's an Expo SDK module, not a community RN library
  bridging the old Native Modules API).
- Already present in this project's SDK (57) — `npx expo install expo-audio` resolves and pins the
  SDK-matched version with zero extra dependency-compatibility risk.
- Free — no licensing question at all.
- Ships its own Expo config plugin (`node_modules/expo-audio/plugin/build/withAudio.js`), so
  background-mode/manifest configuration is declarative in `app.json` rather than requiring a
  custom plugin the way RNTP's Android service registration would have (RNTP shipped no Expo
  plugin of its own).

## What changed as a result — and what didn't

Everything RNTP-specific is gone: the dependency, `trackPlayerSetup.ts`, `playbackService.ts`,
`__mocks__/react-native-track-player.js`, and `index.js`'s `registerPlaybackService` call (reverted
to byte-identical with its pre-Phase-2 state — expo-audio has no root/headless service
registration to make; its background service is wired entirely by the config plugin at prebuild
time, not by a runtime call).

**Everything player-agnostic from Phases 1–2 is untouched**: `audioAssetResolver.ts` (interface +
stopgap), `devContentSeed.ts`'s `buildAudioPackage`, the sample WAV fixture and its generator
script, `CONTRACTS_GATE_PROPOSAL_PLAINTEXT_PATH.md`, the `BookListScreen` audiobook row, and every
frozen contract / `contentStore.ts` / `downloadManager.ts`. None of that code named RNTP or made
any assumption about which player library would eventually consume `resolveAudioAssetUri()`'s
`file://` URI — which is exactly why swapping the player underneath it needed no changes to any
of it.

## Known upstream issue, DEFERRED: iOS lock screen / Now Playing card doesn't appear

**Status: deferred, not fixed. No patch is applied.** Background playback itself works correctly
(audio continues after navigating away or locking the screen, confirmed on a real device) — this
is only about the lock screen / Control Center never showing a Now Playing card (no title, no
play/pause), even though `setActiveForLockScreen(true, ...)` is called and returns successfully.
Deprioritized rather than chased further for now; recorded here so the investigation already done
isn't lost or repeated.

**What was tried and reverted.** A `patch-package` patch
(`AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])`, re-asserted
inside `MediaController.swift`'s `setActivePlayerOnMain`, mirroring
[expo/expo#40919](https://github.com/expo/expo/pull/40919)'s own diff) was applied, built, and
tested on a real device. **It did not resolve the symptom**, and diagnostic `NSLog` instrumentation
added alongside it never appeared in the device log even after a full clean rebuild
(`prebuild --clean` + fresh Pods) — meaning either the real fix is elsewhere in the call chain, or
something about this app's specific audio-session setup differs from the upstream repro. Both the
patch and the diagnostic logging were reverted; `node_modules/expo-audio` is stock, unpatched
`57.0.4` again (verified byte-identical to the published package).

**What the investigation established, for whoever picks this up next:**
- The call chain is confirmed correct: `AudioPlayerScreen.tsx`'s `player.setActiveForLockScreen()`
  → `AudioPlayer.swift` → `MediaController.shared.setActivePlayer()` → `setActivePlayerOnMain()` →
  `updateNowPlayingInfoOnMain()`. The JS call reaches native code and returns without error.
- [expo/expo#40919](https://github.com/expo/expo/pull/40919) (still open/unmerged as of this
  writing) is the upstream team's own tracking issue for this exact symptom. Their own automated
  `/verify` investigation on that PR later concluded the audio-session **category** probably isn't
  the actual root cause after all — their hypothesis shifted to the `.mixWithOthers`
  `AVAudioSession.CategoryOptions` flag (tied to `interruptionMode`) — but their own investigation
  was explicitly inconclusive ("I could not observe the card in this environment... inference, not
  measurement"). We already use `interruptionMode: 'doNotMix'` (`useAudioPlayerSetup.ts`), which
  per `AudioModule.swift`'s own category logic should avoid `.mixWithOthers` entirely — so even
  that upstream hypothesis doesn't obviously explain our case.
- Before restarting this investigation, check `expo-audio`'s CHANGELOG for a released fix first —
  #40919 shipping (or an equivalent fix) may make this moot without any patch of ours.

### 2026-08-25 follow-up: #40919 is a DEAD END for this app — do not re-patch it

Re-investigated against the installed `57.0.4` native source. **The reverted patch could never have
worked, and the reason is not the one assumed above.**

`MediaController.swift` in 57.0.4 contains no `setCategory` and no `setActive` call anywhere — so
#40919's fix is genuinely absent from the installed version (the CHANGELOG confirms no lock-screen
fix in any `57.0.x`; #40919 remains unshipped). **But re-asserting the category there is redundant
regardless**, because `AudioModule.setAudioMode` already sets exactly the call the patch adds. With
this app's mode (`playsInSilentMode: true`, `allowsRecording: false`, `interruptionMode: 'doNotMix'`)
the native branch resolves to `category = .playback` and `sessionOptions = []`
(`AudioModule.swift:789`, `792-799`), reaching `session.setCategory(.playback, mode: .default)` at
`AudioModule.swift:818` — the identical call, with the identical arguments, that the patch
re-asserted. The session category was already correct before the patch, during it, and after the
revert. That is why it changed nothing.

Two more candidates were ruled out by reading native source rather than by inference:

- **NaN in `nowPlayingInfo`** (a classic cause of iOS silently dropping the whole dictionary) is
  impossible here: `AudioPlayer.duration` and `.currentTime` both coerce NaN to `0.0`
  (`AudioPlayer.swift:57-65`) before `applyPlaybackInfo` ever reads them.
- **A silently-rejected audio mode** is impossible: `AudioUtils.validateAudioMode` throws only on
  three `playsInSilentMode == false` combinations (`AudioUtils.swift:178-188`), and this app sets it
  `true`.

**The JS call chain is intact.** `setActiveForLockScreen` runs on the live module singleton (there is
exactly one `createAudioPlayer` call site, `audioPlayerInstance.ts`; the smoke-test player that could
once have contended for the lock screen was deleted in `bc01731`), gated on `status.isLoaded`, so
after a source is loaded. No orphaned reference survived the `useAudioPlayer` → singleton migration.

**Root cause is still NOT established.** Steps 1-3 of this pass eliminated the audio-mode config, the
native category, and the singleton wiring without finding it. Two real defects WERE found and fixed
(below), but neither explains a card that never appears at all — only one that disappears. If the
card still does not appear on a rebuild, this is an `expo-audio` version/upstream escalation, not
something to work around in this repo.

### Fixed in the same pass — real, evidenced, but NOT proven to be the root cause

1. **`keepAudioSessionActive: true`** (`audioPlayerInstance.ts`). It defaults to `false`, and at that
   default expo-audio's `Function("pause")` calls `deactivateSession()` on every pause
   (`AudioModule.swift:244-249`), as does the constructor's `onPlaybackComplete` at end of track
   (`AudioModule.swift:135-139`). Deactivating the session tears the Now Playing card down. Wrong for
   an audiobook, where pausing is constant and the card must survive it. **Explains a card that
   vanishes on pause; does not explain one that never appears.**
2. **Ordering made explicit** (`useAudioPlayerSetup.ts` exports `ensureAudioModeConfigured`;
   `AudioPlayerScreen.tsx` awaits it before resolving the URI). `setActiveForLockScreen` only
   associates the OS lock screen with a player if the session category is already `.playback`.
   App.tsx's mount-time hook call made that true in practice; awaiting the same memoized promise
   makes it true by construction rather than by navigation timing. **Hardening — no evidence this
   was ever actually violated at runtime.**

`useAudioPlayerSetup.ts` keeps its filename and hook name across the swap — `App.tsx`'s call site
was never touched twice; only the hook's own implementation changed.
