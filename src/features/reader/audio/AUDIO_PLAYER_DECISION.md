# Audio decisions: the player, and how the player gets its bytes

**Status: decided.** This file exists for the questions anyone reviewing the audio work will
reasonably ask, so they get answered once instead of re-argued:

1. **Why not react-native-track-player?** — the obvious, most-featureful choice for background
   audio in RN, and what AUDIO_PHASE0_FINDINGS.md's own Phase 2 plan originally called for.
2. **Why does the resolver copy the whole file instead of returning the path contentStore already
   has?** — the copy looks redundant, and a contracts change to remove it was drafted, reviewed,
   and withdrawn. That is Part 2.
3. **How does an audiobook get from a tap to sound, online and offline?** — Part 3.
4. **How does audio playback interact with TTS (@iternio/react-native-tts) and audio sessions?** — Part 4.

> ## ⚠️ AUDIO IS ENCRYPTED. Read this before anything else here.
>
> **"Audio is never encrypted" is REVOKED as of 2026-08-25.** Audio uses the same AES-256-GCM
> scheme, the same wrapped-BEK unwrap and the same `decryptBook()` path as EPUB and PDF. Confirmed
> against the backend, not assumed: `ContentAccessGrantImpl` (commit `31d3d25`) keys the `Encryption`
> descriptor off the **resolved fixture**, not the format, and `dev-sample-audio-encrypted` resolves
> to `sample-small.wav.enc` with a full descriptor and `cipherLength = originalLength + 28`.
>
> Nothing in the client needed new crypto — `decryptBook()` was already format-blind, which is why
> this was a wiring change rather than a cryptography one. **Do not reintroduce an "audio skips
> encryption" branch, and do not set `encryption: null` for audio.** Comments asserting the old rule
> were correct during the build phases and are now actively dangerous; the reader-owned ones are
> corrected, and the ones in frozen contracts are flagged in `AUDIO_ENCRYPTION_RECON.md`.

---

# Part 1 — the player: react-native-track-player → expo-audio

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

**Everything player-agnostic from Phases 1–2 was untouched**: `audioAssetResolver.ts`,
`devContentSeed.ts`'s `buildAudioPackage`, the sample WAV fixture and its generator script, the
`BookListScreen` audiobook row, and every frozen contract / `contentStore.ts` / `downloadManager.ts`.
None of that code named RNTP or made any assumption about which player library would eventually
consume `resolveAudioAssetUri()`'s `file://` URI — which is exactly why swapping the player
underneath it needed no changes to any of it.

> Three items in that list no longer exist: `buildAudioPackage`, the sample WAV and its generator
> were deleted on 2026-08-25 when audio was wired to the real backend (Part 3). The sentence is left
> as written because it is a record of what the RNTP→expo-audio swap did and did not touch, and
> rewriting it would destroy the evidence for the claim it supports.

That property is worth naming, because it is the argument for the `AudioAssetResolver` interface
surviving a decision (Part 2) that removed its original justification: a seam earns its keep the
first time something on one side of it is replaced, and this one already has.

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

---

# Part 2 — why the resolver copies bytes instead of returning a path

**Status: decided 2026-08-25. The copy is the design.** A Contracts-Gate proposal to replace it
(`CONTRACTS_GATE_PROPOSAL_PLAINTEXT_PATH.md`) was drafted, measured, revised, and then **withdrawn
before review**. That file is deleted; this section is what remains of it, and it is deliberately
enough to reconstruct the decision without it.

## What the proposal asked for

A new frozen interface, `PlaintextAssetProvider`, with one method — `getPlaintextPath(bookId):
Promise<string>` — returning the path `contentStore` had *already* written, plus a new
`ContentError.NOT_PLAINTEXT` to reject any caller who aimed it at an encrypted package. Reader's
side of the change was one line: `resolveAudioAssetUri` would have returned
`file://${await getPlaintextPath(bookId)}` and stopped copying.

## Why it was withdrawn

**The problem it solved does not arise at the sizes this app serves.** The argument for it was never
efficiency — that was measured and came out immaterial (~+40 MB transient, fully reclaimed, on a
path with no WebView). The argument was a size ceiling: `getBook()` builds a whole-book
`Uint8Array`, that operation is what the RAM budget bounds, and so **this design cannot play an
audiobook longer than about 21 minutes** at the 20 MB audio cap.

That ceiling is real and has not moved. What changed is that it stopped being a *blocker* and became
a *bound the product is designed around*: the OPDS/catalogue team stores prototype audio at 20 MB or
under, so no audiobook this app can be served will exceed it. An accessor that lifts a ceiling
nothing can reach buys nothing — while costing two frozen-file changes (`content-provider.ts`,
`errors.ts`), a new error code, a canary update, and cross-capability review time.

Withdrawing it also takes the whole plaintext-path question off Contracts-Gate's agenda. **The audio
work still needs a Gate conversation** — `CONTRACTS_GATE_PROPOSAL_AUDIO_PROGRESS.md`, the time-based
`Locator` variant for durable cross-device position — but that one is Karthik's and Vaishnavi's, and
it is now the only audio item on the agenda.

## The one condition that reopens this

**If full-length audiobooks come into scope, this decision must be revisited before any other audio
work is planned** — and it will not announce itself. The failure is not subtle at runtime (an
over-cap book is refused loudly at download and at `store()`, since 2026-08-25), but the *planning*
failure is: it is easy to read "audio works" off a green test suite and a playing fixture, and not
notice that every fixture is under 20 MB.

Three things to know if that day comes, so the argument is not re-derived from scratch:

1. **Raising the cap is not the fix and never was.** The cap bounds a whole-book-into-RAM operation.
   A 10-hour audiobook is ~500 MB; there is no value of that constant that makes it work on a phone.
   Anyone proposing "just raise it to 100 MB" has misread the problem.
2. **The fix is an accessor that never builds the array** — the withdrawn proposal, recoverable in
   full from git history: it was last present at `b93b0ef`, so
   `git show b93b0ef:src/features/reader/audio/CONTRACTS_GATE_PROPOSAL_PLAINTEXT_PATH.md` prints it.
   Its two non-obvious findings are worth knowing before redrafting: the guard must key off
   `pkg.encryption === null`, **not** `format === 'AUDIO'` (an EPUB can legitimately be open access,
   and `contentStore.test.ts` already exercises that); and the implementation must read `metaFile`
   directly rather than routing through `resolvePackage`/`loadPersisted`/`openSession`, all of which
   enforce the very cap it is trying to escape.
3. **The 20 MB number is a catalogue agreement, not a device measurement.** It comes from what the
   OPDS team will store for the prototype. So "can we ship longer audio?" is a question for them
   first and for this repo second — and if their answer changes, this section is the thing that
   should change with it.

## What this decision does NOT excuse

The resolver's remaining rough edges are now permanent-code problems rather than
someone-else's-proposal problems, and they should be read that way:

- ~~**Nothing clears `tf-reader-audio-scratch/`.**~~ **Fixed 2026-08-25, in two passes**, because the
  problem turned out to be two problems:

  **Pass 1 — size.** `clearAudioScratch()` runs on every resolve, sparing only the book being
  resolved, so the directory holds one file (<=20 MB) instead of one per book ever played. Resolve
  time rather than `closeBook()` or screen unmount, because both of those are wrong here:
  `closeBook()` runs inside the resolver moments after the write (the file would be gone before the
  player opened it), and unmount is a supported state for a *still-playing* book. Safe by
  construction — `AudioPlayerScreen` releases the outgoing player during render, before the effect
  that resolves.

  **Pass 2 — entitlement, and this is the one that actually mattered.** "Bounded at one file" is a
  disk-space answer, and once a SUBSCRIPTION-tier audio fixture existed the question stopped being
  about disk: the surviving file is *decrypted licensed content*, and it survives everything that
  revokes access to it. `contentStore.destroy()`, licence expiry and BEK destruction all act on
  Encryption's copy; none of them knows this directory exists, because `SCRATCH_DIR` is private to
  `audioAssetResolver.ts`. So the last-played audiobook's plaintext outlived its licence
  indefinitely. `audioScratchReclaimer.ts` closes that: it sweeps on both app-state edges (leaving
  the foreground is when the file would otherwise sit unattended; returning catches what a killed
  process could not clean) and deletes a specific book's copy on Sync's `content.lock` signal, for
  **both** `revoked` and `expired` — the distinction between those matters for ciphertext, which is
  inert without a key, and not at all for plaintext.

  **What is still open, and it is a player problem rather than a file one:** unlinking a file does
  not stop a native player that already has it open. A book revoked mid-playback keeps playing from
  the unlinked inode until the player is released. Stopping audio on revocation means releasing the
  singleton and clearing the lock-screen card — a product decision about cutting someone off
  mid-sentence, and `offline-lock.ts` is explicit that Sync's signals are advisory. Recorded, not
  fixed.
- ~~**The extension is hardcoded to `wav`.**~~ **Fixed 2026-08-25 by Abhinav**, with exactly the
  accessor this predicted: `ContentProvider.getMimeType()` reads `PersistedMeta.mimeType`, and
  `MIME_TO_EXTENSION` in `audioAssetResolver.ts` maps it, falling back to `.bin` rather than
  guessing. Two things had to change on merge: the mime read moved to AFTER `openBook()` (a streamed
  book has no `meta.json` until the ephemeral package is stored, so issuing both together races and
  loses on the online path), and the scratch sweep now matches on the bookId prefix rather than a
  fixed filename, so a book re-stored under a different type does not leave its old file behind.

---

# Part 3 — how an audiobook reaches the speaker

**Status: wired 2026-08-25.** Audio no longer has a dev seed. It comes from the real backend by the
same two routes every other format uses, and both end at the same player.

## The two paths, and where they converge

```
                  ONLINE (not downloaded)              OFFLINE (downloaded)
                  ───────────────────────              ────────────────────
  tap row         BookListScreen -> AudioPlayer        Download button first,
                                                       then tap row
       │                    │                                   │
       │          AudioPlayerScreen effect          AudioPlayerScreen effect
       │                    │                                   │
       ▼                    ▼                                   ▼
  resolveAudioAssetUri(bookId)  ──────────────────────────────────
                              │
                    openBook(bookId, 'AUDIO')      ← the one licence gate, both paths
                              │
              ┌───────────────┴────────────────┐
     checkLicense live                 checkLicense falls back
     fetch ciphertext                  to the persisted licence
     store EPHEMERAL pkg               (no network needed)
     (canPersist: false)               openSession + decryptBook
     decryptBook                       from the LOCAL encrypted package
              └───────────────┬────────────────┘
                              ▼
                  decrypted bytes in RAM
                              │
              write tf-reader-audio-scratch/<id>.wav
                              │
                     closeBook(bookId)   ← frees the RAM copy
                              │
                        file:// URI
                              │
                  expo-audio player.replace(uri)
                              ▼
                            sound
```

**The player is told nothing about which path produced the bytes**, and neither is
`AudioPlayerScreen` — both deal only in "a URI, eventually". That is the same seam that let the
player library be swapped in Part 1.

**`openBook()` is called, never edited** (it is Download's). It already collapses both cases: it
checks `isAvailableOffline()` and short-circuits to the local package, and its licence check falls
back to the persisted licence when the network is unreachable. So the resolver needs no branch of
its own — there is exactly one acquisition call in the audio path.

## The `closeBook()` / re-entry problem, and the chosen answer

The resolver calls `closeBook()` immediately after writing the scratch file, to free the decrypted
copy from RAM. For a **downloaded** book that is reversible — the ciphertext is still on disk. For a
**streamed** book it is terminal: `close()` drops the `packageCache` entry, which for an ephemeral
`canPersist:false` package is the only copy that has ever existed. A later `getBook()` for that book
would fail `DECRYPTION_FAILED` ("no stored package") forever.

**Chosen: re-acquire on every resolve.** `resolveAudioAssetUri` calls `openBook()` each time rather
than `getBook()`, so nothing ever assumes a session is still open. Re-entering a streamed audiobook
re-fetches it; re-entering a downloaded one re-reads it from disk. `audioAssetResolver.test.ts` pins
this ("RE-ACQUIRES on every resolve").

**Rejected: keep the session open for the screen's lifetime.** It would hold the whole decrypted book
in RAM for as long as the player exists — and background playback means the player outlives the
screen, so "as long as the screen is mounted" is not even the right bound. That is precisely the cost
`closeBook()` exists to avoid. It would *also* still need a re-acquire path, for the case where the
process was killed and relaunched, so it buys nothing and pays a whole book of RAM for it.

**Rejected: detect the closed session and re-open on failure.** Same end state, reached by catching an
error instead of by never being wrong — and it would have to distinguish "session closed" from "your
licence was revoked", which is exactly the distinction that must not be papered over.

## Scratch-file lifecycle, by path

The scratch file holds **decrypted licensed content** now, which is what makes this more than
housekeeping. `SCRATCH_DIR` is private to `audioAssetResolver.ts`, so nothing that revokes access —
`contentStore.destroy()`, licence expiry, BEK destruction — reaches it on its own.

| When | What happens | Why |
| --- | --- | --- |
| Every resolve | All other books' files deleted | One file maximum, and the outgoing player is already released by then |
| App backgrounds / foregrounds | Everything deleted **except a book that is actually playing** | Leaving is when plaintext would sit unattended; returning catches what a killed process could not clean |
| Sync `content.lock` (`revoked` **or** `expired`) | That book's file deleted, playing or not | The licence is gone, so the plaintext goes |

**"Actually playing", not "currently held", is the rule** — `isAudioPlaying()`, not
`currentAudioBookId()` alone. This is what covers the online path specifically: a streamed book's
scratch file is the only decrypted copy in existence, so when the user pauses and leaves, it goes.
Sparing a paused book would buy nothing back either, since the resolver rewrites the file on every
resolve regardless. On the download path the same rule applies and costs even less — the file is
re-derivable from the local encrypted package.

**Not covered, and it is a player problem rather than a file one:** unlinking a file does not stop a
native player that already has it open, so a book revoked mid-playback plays on until the player is
released. See Part 2's closing note.

## Verifying both paths against the live backend — MANUAL, and not yet run

**Neither path has been exercised against a running backend.** Nothing in this environment can: the
crypto native modules need an `expo-dev-client` build on a simulator, and the backend needs to be up
on `:8080`. Everything below is wired and unit-tested; what follows is what has *not* been proven.

The automated suite deliberately mocks `openBook` (see `audioAssetResolver.test.ts`'s header), so it
pins how the resolver *asks* for bytes, not that fetch → unwrap → decrypt → play actually works
end to end. That gap is finding #3 in `AUDIO_ENCRYPTION_RECON.md`.

### Setup

1. Start the backend: `cd ../tf_reader_backend_temp && ./mvnw spring-boot:run` (serves `:8080`;
   `DemoDataSeeder` loads `dev-sample-audio-encrypted` from `demo-dataset.json`).
2. In the app repo, create `.env` from `.env.example` with:
   ```
   EXPO_PUBLIC_USE_REAL_BACKEND=true
   EXPO_PUBLIC_REAL_BACKEND_URL=http://<your-LAN-ip>:8080
   ```
   Use the machine's LAN IP, not `localhost` — a simulator resolves `localhost` to itself.
3. `npm run ios` (dev client required; Expo Go cannot load the crypto native modules).

### Path 1 — ONLINE (stream, nothing downloaded)

1. If the book was downloaded on a previous run, clear it first — otherwise this silently tests
   path 2. Easiest is a fresh simulator install.
2. Tap **Audiobook (Encrypted)**. Do NOT press its Download button.
3. Expect: a brief "Loading…", then transport controls and audio.

Confirms, in order: `openBook` → `checkLicense` live → ciphertext fetched → BEK unwrapped → decrypted
→ scratch file written → `expo-audio` plays.

**Watch for `B17`.** The known backend RSA-OAEP bug (MGF1 defaults to SHA-1 while the OAEP digest is
SHA-256 — `CONTRACT_ALIGNMENT.md`) breaks the BEK unwrap for **every** encrypted download, audio
included. If this fails at unwrap, it is that, not this wiring — the symptom is a decrypt failure,
not a network or licence error.

### Path 2 — OFFLINE (downloaded, no network)

1. Press **Download** on the Audiobook row; wait for the progress indicator to finish.
2. Kill the app. Turn off Wi-Fi (or stop the backend — stopping it is the stricter test, since it
   also proves nothing silently falls back to the mock).
3. Reopen the app and tap the row.
4. Expect: it plays, with no network.

Confirms: `checkLicense` falls back to the persisted licence, `isAvailableOffline()` is true,
`decryptBook()` reads the local encrypted package.

### Path 3 — re-entry (the `closeBook` case this wiring exists to handle)

While still online and **not** downloaded: play, navigate back to the list, tap the row again. It must
play again. Before this change the second tap would have failed `DECRYPTION_FAILED` — the ephemeral
package is dropped by `closeBook()`, and re-acquiring is what fixes it.

### Scratch-file lifecycle spot-check

The directory is `<app cache>/tf-reader-audio-scratch/`. Expect **at most one `.wav`** at any time,
and **none** after backgrounding the app while paused. If a streamed book's file survives being
paused-and-backgrounded, `isAudioPlaying()` is reporting the wrong thing.

---

# Part 4 — decrypted audio on disk: the security posture

**Status: hardened where it could be, and one intended hardening REJECTED on evidence.** Read the
rejection first; it is the part that changes what anyone should plan next.

## Why a file exists at all

`expo-audio` cannot play from memory. Its `AudioSource.uri` is a `URL` (iOS) / `Uri` (Android) and
its preload path takes a file or a remote URL — there is no ArrayBuffer entry point. So decrypted
audio must reach the filesystem before the player can open it.

**This is the one place audio is structurally worse than EPUB/PDF**, and it is a library limitation
rather than a design choice. EPUB/PDF go RAM → base64 → WebView `injectJavaScript` and never touch
disk. Closing the gap entirely means a native module that accepts bytes, which is explicitly out of
scope.

## REJECTED: delete-after-open (unlink once the player holds a descriptor)

The plan was: write the file, wait for the player to open it, unlink it, and let playback continue
through the open descriptor — POSIX semantics keep an unlinked inode readable to its holder while
making it invisible to everything else. That would have cut the exposure window from "until cleanup
fires" to "milliseconds".

**It does not work on Android, and the failure is architectural rather than incidental.**

`AudioModule.kt` builds `MediaItem.fromUri(uri)` with `DefaultDataSource.Factory(context)` for a
non-http scheme, so a `file://` URI is served by media3's `FileDataSource`, and `seekTo` is
ExoPlayer's own. Three facts about that stack combine badly:

1. `FileDataSource.open()` resolves the file **by path**, every time it is called.
2. ExoPlayer does not hold one descriptor for the lifetime of playback. `ProgressiveMediaPeriod`'s
   loadable **closes** its `DataSource` when a load completes.
3. A seek outside the buffered region cancels the current load and starts a new one — which calls
   `open()` again, by path.

So after an unlink, a seek past the buffer (and any re-buffer of a partially-loaded file) hits a
`FileNotFoundException`. Sequential playback of a small, fully-buffered file would appear to work,
which makes this a bug that hides in exactly the fixture we test with — `sample-small.wav` is under
1 MB, while the cap allows 20 MB and `DefaultLoadControl` buffers by duration, not whole files.

**iOS looks fine, and that is not enough.** `AudioUtils.createAVPlayerItem` builds an
`AVURLAsset` → `AVPlayerItem`, and `seekTo` calls `AVPlayer.seek()` against the already-loaded item,
which does not re-resolve the URL. AVFoundation holding its own descriptor for the asset's lifetime
is the expected behaviour. But an approach that breaks seeking on one of two shipped platforms is not
shippable, and `app.json` configures both.

> ### ⚠️ NOT RUNTIME-VERIFIED — the device test this rests on was NOT run
> Everything above is **read from `node_modules/expo-audio`'s native sources and from media3's
> documented architecture.** No simulator or device was available, so "load, unlink, seek, confirm
> playback continues" has not been executed on either platform.
>
> The Android conclusion is a confident negative: it follows from `DefaultDataSource.Factory` plus
> `FileDataSource` opening by path, both of which are visible in the installed code. The iOS
> conclusion is the weaker one — "AVFoundation probably holds the descriptor" is an expectation, not
> a measurement.
>
> **Before anyone revisits this, run the test on a real Android device with a file large enough not
> to be fully buffered, and seek past the buffer.** If it somehow passes, this section is wrong and
> should be rewritten with the evidence.

**iOS-only delete-after-open was not implemented either.** It is available — the platforms could
diverge behind the resolver — but it doubles the number of lifecycles to reason about and leaves the
weaker platform exactly where it is. That is a call worth making deliberately rather than as a
consolation prize, so it is recorded here as an option rather than taken.

## What IS in place

| Layer | What it gives | Where |
| --- | --- | --- |
| One file at a time | Every resolve deletes every other book's file | `clearAudioScratch`, `audioAssetResolver.ts` |
| App-state sweep | Deletes everything not **actively playing**, on backgrounding and foregrounding | `audioScratchReclaimer.ts` |
| Revocation / expiry | Releases the player, then deletes that book's file | `handleLock`, same file |
| Android at-rest | Internal app storage, sandboxed, FBE-encrypted on Android 10+ | see below |
| iOS at-rest | **Nothing beyond the default** — see below |

**The exposure window is therefore: from the write until the user stops playing and the app changes
state.** Minutes to hours for a listening session. That is materially better than the indefinite
window it started as, and materially worse than the milliseconds delete-after-open would have given.

## iOS file protection: NOT AVAILABLE via expo-file-system

`NSFileProtectionComplete` would make the file unreadable at rest while the device is locked. The
installed `expo-file-system` (the new `File`/`Directory` API) exposes no file-attribute surface at
all — no protection option on `create()`/`write()`, and nothing in `File.d.ts` or `Directory.d.ts`
that reaches `NSFileProtectionKey`. Setting it needs a native `setAttributes` call.

**Gap documented, not closed** — a native module for this alone is out of scope, and it was always
the second layer rather than the first. Worth noting the default is not nothing: iOS applies
`NSFileProtectionCompleteUntilFirstUserAuthentication` to app containers by default, so the file is
protected until the first unlock after boot, and unprotected thereafter. `Complete` would narrow that
to "whenever locked".

## Android storage: internal, confirmed

`SCRATCH_DIR` is `new Directory(Paths.cache, 'tf-reader-audio-scratch')`. Traced through the
installed code: `Paths.cache` → `FileSystemModule.cacheDirectory` → `AppContext.cacheDirectory` →
`AppDirectoriesService.cacheDirectory` → **`context.cacheDir`** — internal app storage
(`/data/data/<pkg>/cache`), not `externalCacheDir`. Sandboxed from other apps, and covered by
file-based encryption on Android 10+. **No move needed; the posture is adequate.**

## `contentStore.destroy()`: NO HOOK — needs Abhinav

Revocation and expiry that arrive **through Sync** are handled: `content.lock` fires, the reclaimer
releases the player and deletes the file. But `contentStore.destroy(bookId)` called **directly**
emits nothing — there is no event, callback or listener anywhere in it, and the only events on the
bus are Sync's two offline-lock signals. Nothing reader-owned can observe it.

**Not fixed, because fixing it means editing `contentStore.ts`.** Until then a directly-destroyed
book's scratch file survives until the next app-state sweep — bounded, but not immediate.

**Recommended hook, for Abhinav.** The smallest thing that closes it, matching the pattern already in
the codebase:

```ts
// src/shared/contracts/… (or wherever CONTENT_EVENTS would live)
export const CONTENT_EVENTS = { DESTROYED: 'content.destroyed' } as const;
export interface ContentDestroyedSignal {
  type: typeof CONTENT_EVENTS.DESTROYED;
  bookId: BookId;
}

// contentStore.ts, at the END of destroy(), after the files are gone:
eventBus.emit(CONTENT_EVENTS.DESTROYED, { type: CONTENT_EVENTS.DESTROYED, bookId });
```

Fire **after** the deletion succeeds, so a subscriber never acts on a destroy that then failed. One
emit, no signature change, no frozen-contract edit if the constant lives beside the existing
`OFFLINE_LOCK_EVENTS`. Reader would subscribe in `audioScratchReclaimer.ts` exactly as it already
does for `content.lock` — the handler is written and tested; it would just gain a second trigger.

## The residual risk, stated plainly

A decrypted audiobook sits in the app's cache directory for the duration of a listening session. On a
**jailbroken or rooted device**, or one where an attacker has the passcode, that file is readable for
that window. Every other copy of the content on the device is ciphertext.

Nothing here defends against a compromised device — the sandbox is the boundary, and on a rooted
device there is no sandbox. What the current layers do defend against is the file **outliving** the
session it was created for, which was the actual finding: it used to persist indefinitely.

---

# Part 4 — Audio Session concurrency & TTS interaction

**Status: verified 2026-09-08.** Audio playback (`expo-audio`) and Text-to-Speech (`@iternio/react-native-tts`) are two distinct native subsystems coexisting within the application. This section records how they interact at the OS audio-session level, how preferences are isolated, and how lock-screen controls behave across them.

## 1. Global Audio Session & Concurrency Behavior (Mutual Exclusion)

**Requirement: Only one audio source runs at a time.** Neither users nor assistive technology benefit from audiobook speech and TTS speech playing simultaneously.

### Native Subsystem Reality
- **iOS (`AVAudioSession`):**
  - Audio player (`useAudioPlayerSetup.ts`): `category = .playback`, `interruptionMode = 'doNotMix'`.
  - TTS (`TextToSpeech.m`): Configures `AVAudioSessionCategoryPlayback` with mode `AVAudioSessionModeVoicePrompt` and `AVAudioSessionCategoryOptionInterruptSpokenAudioAndMixWithOthers`.
  - Without application coordination, iOS allows both to mix concurrently.
- **Android (`AudioManager` / Audio Focus):**
  - `expo-audio` uses Media3 (`ExoPlayer`) with `USAGE_MEDIA`.
  - `@iternio/react-native-tts` uses `android.speech.tts.TextToSpeech` with `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` and `CONTENT_TYPE_SPEECH`.
  - Without application coordination, Android does not preempt playback.

### Concurrency Solution: `audioTtsCoordinator.ts`
Mutual exclusion is coordinated deterministically at the application layer via `src/features/reader/audio/audioTtsCoordinator.ts`, ensuring that whenever one source activates, the other yields:

1. **Direction 1: Audiobook playing → TTS activated:**
   - When the user presses Play (or resumes) in TTS (`useTtsSession.ts`'s `play()`, `speakSentence()`, `handleTtsStart`):
   - `pauseActiveAudio()` calls `pauseCurrentAudioPlayer()` (`audioPlayerInstance.ts`).
   - If an audiobook is currently loaded and producing sound, it immediately calls `player.pause()` and commits its live reading position to SQLite (`progressStore.savePosition()`).
   - Sound from the audiobook ceases before TTS speech begins.
   - Result: Only TTS runs. Audiobook progress is safely saved and ready to resume later.

2. **Direction 2: TTS speaking → Audiobook begins playback:**
   - **UI Play button (`AudioPlayerScreen.tsx`):**
     Inside `beginPlayback()`, before `player.play()` is invoked, `stopActiveTts()` is called.
   - **External / Lock-Screen / Bluetooth Play (`audioPlayerInstance.ts`):**
     A listener on the player's `playbackStatusUpdate` watches for `status.playing` rising edges (`status.playing && !wasPlaying`). The moment playback commences from anywhere (including lock-screen Now Playing controls or headset tap), `stopActiveTts()` is called.
   - `stopActiveTts()` triggers `stopInternal()` on the active TTS session:
     - The native speech synthesizer stops immediately (`Tts.stop()`).
     - The reader highlight on the spoken sentence is cleared (`source.setSpokenRange(null)`).
     - In-flight sentence fetches are invalidated (`generation += 1`).
     - TTS session status resets to `'idle'` so reader controls display the Play button.
   - Result: Only the Audiobook runs. TTS speech halts cleanly with no lingering highlights or orphaned audio.

## 2. Preference Isolation (Rate, Pitch, Voice)

- **TTS Preferences:**
  Stored in `sharedPrefs.accessibility.tts` (`rate: 0.5..2.0`, `pitch: 0.5..2.0`, `voiceId: string | null`). Applied strictly via native TTS methods (`Tts.setDefaultRate`, `Tts.setDefaultPitch`, `Tts.setDefaultVoice`).
- **Audiobook Player:**
  `AudioPlayerScreen.tsx` provides playback speed presets (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`) applied directly to the player instance via `player.setPlaybackRate(rate)`.
- **Verification:**
  - `AudioPlayerScreen` and `audioPlayerInstance` contain **no subscriptions or references** to `accessibility.tts` or `sharedPrefs`.
  - The `AudioPlayer` object has no concept of voice selection or pitch adjustment.
  - Native `Tts.setDefaultRate` modifies only `AVSpeechUtterance.rate` / Android TTS rate, completely independent of `AVPlayer` / Media3 playback rate.
  - **Confirmed:** TTS rate, pitch, and voice preferences never reach or affect the audiobook player.

## 3. Lock-Screen Now Playing Card Survival

- **The hazard:**
  On iOS, `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` are intrinsically tied to an active `AVAudioSession`. If any module calls `AVAudioSession.sharedInstance().setActive(false)`, iOS immediately tears down the lock-screen Now Playing card and disconnects remote command handlers.
- **Protection in place:**
  1. **`keepAudioSessionActive: true`** (`audioPlayerInstance.ts`):
     Passed to `createAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true })`.
     In `AudioModule.swift`:
     ```swift
     Function("pause") { player in
       player.ref.pause()
       if !player.keepAudioSessionActive {
         deactivateSession() // calls setActive(false)
       }
     }
     ```
     Setting `keepAudioSessionActive: true` bypasses `deactivateSession()` during pause (including coordinator-initiated pauses when TTS takes over) and on track completion.
  2. **Lock-Screen State in `MediaController.swift`:**
     When paused, `MediaController.updateNowPlayingInfoOnMain` updates `MPNowPlayingInfoPropertyPlaybackRate = 0.0`. The metadata (`MPMediaItemPropertyTitle`, `MPMediaItemPropertyArtist`, `MPMediaItemPropertyPlaybackDuration`, and `MPNowPlayingInfoPropertyElapsedPlaybackTime`) is preserved in `nowPlayingInfoCenter.nowPlayingInfo`.
  3. **TTS does not deactivate the session:**
     In `TextToSpeech.m`, `setActive:false` is guarded by `if(_ducking)` inside `didFinishSpeechUtterance`, `didPauseSpeechUtterance`, and `didCancelSpeechUtterance`. Because our application never invokes `setDucking(true)`, `_ducking` remains `false`, and TTS **never deactivates the audio session**.
  4. **Lock-Screen Resume Handshake:**
     If the user taps Play on the surviving lock-screen card while TTS is active, `player.play()` causes a status transition. The `playbackStatusUpdate` listener in `audioPlayerInstance.ts` detects `status.playing && !wasPlaying` and triggers `stopActiveTts()`, seamlessly yielding speech back to the audiobook.
- **Confirmed:**
  The lock-screen Now Playing card and lock-screen playback controls survive TTS utterances uninterrupted.


