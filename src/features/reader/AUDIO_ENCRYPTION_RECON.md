# Audio encryption recon — is audio encrypted, and what is left before the pipeline is complete?

**First run: 2026-08-25. Updated after the backend's `main` moved the same day. Owner: Reader (Ahana).**
**Not committed — working-tree document.**

The audio build (Phases 0–5) was designed around **"audio is never encrypted,"** citing
`downloadManager.ts:262-264`, `contentStore.ts`'s plaintext branch, and `devContentSeed`'s
`encryption: null`. The team reported that audio *should* be encrypted and decrypted live into RAM,
and that the backend now serves audio.

**Verdict: the team is right, and as of the backend's `225230e` it is all on `main`.** Encrypted
audio is served, the scheme matches EPUB/PDF exactly, and the two blockers this recon originally
found on the backend side are both gone. What remains is entirely on the client, plus one
self-contradiction in the backend's mime type.

---

## 1. What the backend serves (updated — now on `main`)

Repo: `/Users/ahanamurthy/TF Reader/tf_reader_backend_temp`, Java/Spring Boot, owner `Deepu1004`.
(The path in the original brief, `/Users/ahana.srinathmurthy/TF_Reader/`, does not exist.)
Authority: `content/service/ContentAccessGrantImpl.java`. Now at `225230e` (`Merge PR #34 from Abhinav`).

### What changed between the two runs of this recon

| | First run (`d0f8c61`) | Now (`225230e`) |
| --- | --- | --- |
| Audio fixtures | **none at all** | `sample-small.wav` + `sample-small.wav.enc`, on `main` |
| Encrypted-audio work | unmerged, on `origin/Abhinav` | **merged** (`31d3d25`) |
| Encryption decided by | `isAudio ? null : …` | `fixture.path().endsWith(".enc")` |
| `AUDIO` fallback in `resolveFixture` | 🔴 silently returned a 20 MB **EPUB** | ✅ `case AUDIO -> audioSmallFixture` |
| Audio `DOWNLOAD` | 🔴 refused at every tier (403) | ✅ **restriction removed** (`a2a1e51`) |
| Catalogue item | none | `dev-sample-audio-encrypted`, SUBSCRIPTION, `pub_rtlg` |

### Answers to the five questions

1. **Encrypted?** Yes — one fixture (`dev-sample-audio-encrypted`), genuine AES-256-GCM whole-file
   ciphertext. Every other audio item is still unencrypted; `shared.md`'s rule is *qualified* by a
   named exception, not replaced.
2. **Scheme / key exchange?** **Identical to EPUB/PDF.** `AES-256-GCM`,
   `nonce(12) || ciphertext || tag(16)`, same `MOCK_BEK`, `wrappedBek` = a real RSA-OAEP-256 wrap
   under *this request's* device public key, `keyId` `master-v1`, `keyFingerprint` =
   `"sha256:" + hex(SHA-256(devicePublicKey))`. The app's existing on-device unwrap+decrypt works
   against it unmodified — no client crypto change needed.
3. **Whole file or streamed?** **Whole file.** One signed URL; `cipherLength` = file size,
   `originalLength` = file size − 28. No range or chunk semantics.
4. **Codec?** **WAV** — and the backend now disagrees with itself, see §5 item 4.
5. **Distinct licence/DRM model?** **No longer.** `a2a1e51` rewrote `RightsService` to be
   tier-only: *"Audio follows exactly the same rule as PDF/EPUB: downloadable on every tier except
   ELITE."* The stream-only rule this recon originally flagged as the biggest risk is gone.

---

## 2. What this repo's contracts say

**Mixed: the fixture layer is updated, the contract comments are not.**

| File | State |
| --- | --- |
| `devContentSeed.ts` | ✅ **no longer seeds audio at all** — `DEV_SAMPLE_AUDIO_*`, `DevFixture.audioEncrypted` and `buildAudioPackage` were deleted 2026-08-25 when audio was wired to the backend. The id now lives in `BookListScreen.tsx` as a catalogue id |
| `navigation/BookListScreen.tsx:61` | ✅ `Audiobook (Encrypted)` row |
| `shared/contracts/content-provider.ts` | ✅ relaxed by `343ec81` |
| `encryption/contentStore.ts` | ✅ decrypt branch is format-blind; correctly needed no change |
| `download/downloadManager.ts:262-264` | ❌ still asserts audio is never encrypted |
| `shared/types/primitives.ts:25` | ❌ same claim, **frozen file** |
| `shared/contracts/reading-session.ts:60` | ❌ same claim, **frozen file** — and it also says *"Audio streams, never encrypted,"* which `a2a1e51` has now made wrong twice over |

The mobile fixture id `dev-sample-audio-encrypted` **matches the backend's catalogue `_id` exactly**.
That coordination is done.

**What today's encrypted fixture proves, and what it doesn't.** `devContentSeed` encrypts a *bundled
local WAV* through the real `buildPackage()`. That genuinely exercises RSA-OAEP + AES-GCM decrypt for
audio. It proves nothing about backend integration — no byte comes from the backend.

---

## 3. Is there a mismatch?

**Not in the crypto — only in prose and reachability.** Scheme, key exchange, fixture ids and
catalogue tier all line up. `contentStore` needed no change and got none. What is out of step:

- ~10 client comments still assert an invariant that now has a named exception, two of them frozen.
- The encrypted path is exercised only by a locally-seeded fixture; nothing fetches the backend's.

---

## 4. Where the online read path stands

`src/features/download/openBook.ts` is the "decrypt live into RAM" flow:

```
checkLicense(bookId, format, 'STREAM')
  → fetchEncryptedAssetChunked(signed URL, maxBytes)   ciphertext, never lands on disk
  → ephemeral package, canPersist forced FALSE          contentStore Elite branch = RAM only
  → decrypt → Uint8Array
```

Format-generic, budget-enforced mid-transfer, persists nothing. `BookListScreen.handleOpen()` calls
it at `BookListScreen.tsx:121` for every format **except audio**.

**Audio's bypass is deliberate.** A licence gate on the audio path would gate Reader out of its own
work while the audio pipeline is still being built. `BookListScreen.tsx:145`'s comment calls it *"a
real gap, not a design choice made here"* — **that comment is misleading**; the deferral is
intentional and the gate is wanted later, not now. (A gate was wired here on 2026-08-25 and reverted
the same day for exactly this reason.)

Consequence to keep in view: **audio currently reaches the resolver only via `devContentSeed`**, so
nothing on the audio path talks to the backend yet. That is the single biggest gap between "audio
plays" and "audio pipeline is complete."

### One trap for whoever connects audio to the network later

`openBook` builds an *ephemeral Elite* package for books not on disk. `audioAssetResolver` calls
`closeBook(bookId)` right after writing its scratch file, and per CLAUDE.md's known open item 1
`close()` is terminal for Elite: it drops the sole `packageCache` entry. Won't bite the seeded
fixtures (they short-circuit to the disk copy); will bite the first genuinely streamed audiobook.
Abhinav's to fix.

---

## 5. Options if audio is encrypted (unchanged)

`expo-audio` **57.0.4, installed, re-confirmed**:
`AudioSource = string | number | null | { uri?, assetId?, headers?, name? }`.
Zero `ArrayBuffer`/`Uint8Array` in `Audio.types.d.ts`. **No API accepts bytes.**

| Option | Works? | Cost |
| --- | --- | --- |
| **Decrypt → scratch file → `file://` → play** (today) | ✅ shipping | Decrypted audio on disk in `Paths.cache`. The resolver is encryption-blind, so it needed no change when the encrypted fixture arrived. |
| **`data:` base64 URI** | ⚠️ "works" | **Strictly worse.** `AudioUtils.swift:81-82,131-152`: iOS detects base64 and calls `handleBase64Asset`, which does `try data.write(to: fileURL)` into `NSTemporaryDirectory` under a random UUID — still plaintext on disk, in a file this app never names, tracks or sweeps, plus a ~27 MB base64 string on top of the buffer. |
| **`blob:` URL** | ❌ | Doesn't apply — the reader's pdf.js trick works *inside a WebView*; there is none here, and AVPlayer/ExoPlayer cannot resolve a JS-registry blob URL. |
| **True RAM-only playback** | ✅ but expensive | Custom Expo module: `AVAssetResourceLoaderDelegate` (iOS) + custom ExoPlayer `DataSource` (Android). The only option that keeps plaintext off disk. |

**Recommendation: keep the scratch-file design and bound its exposure.** At the 20 MB cap the window
is one file; sweeping it on `destroy()`/licence-expiry/foreground closes the part that matters — a
decrypted file outliving the licence that authorised it.

---

## 6. Status board

### Fixed since the first run
- ✅ **Audio download refused server-side** — `RightsService` is tier-only now (`a2a1e51`).
- ✅ **`AUDIO` grant returned an EPUB** — `resolveFixture` has a real `case AUDIO`.
- ✅ **Backend audio work unmerged** — merged to `main` (`225230e`).
- ✅ **Encrypted audio unreachable** — catalogue item seeded, SUBSCRIPTION, id matches the client's.
- ✅ **Client-side hardcoded `.wav` extension** — closed by Abhinav's `ContentProvider.getMimeType()`
  (PR #85); the resolver derives the extension from the stored MIME type via `MIME_TO_EXTENSION`.
  **The BACKEND half is still open and is not ours:** the catalogue asset says `audio/wav` while the
  grant's `mimeTypeFor()` hardcodes `audio/mpeg` for AUDIO, so the same bytes can be stored under
  either. The client maps both to something sane and the sweep matches on bookId rather than
  filename, so nothing breaks either way — but the backend still contradicts itself.
- ✅ **Audio never touches the backend** (was #1) — `audioAssetResolver` now acquires through
  `openBook(bookId, 'AUDIO')`, the same licence gate EPUB/PDF use, which serves the streaming and
  the downloaded path in one call. The audio dev seed, its WAV fixture and its generator are
  deleted; `BookListScreen`'s row names the backend's `dev-sample-audio-encrypted` directly. See
  `audio/AUDIO_PLAYER_DECISION.md` Part 3 for the tap-to-sound flow and the closeBook/re-entry
  decision.
- ✅ **Decrypted audio outliving its licence on disk** (was #2) — `audioScratchReclaimer.ts` now
  sweeps `SCRATCH_DIR` on both app-state edges and deletes a book's copy on Sync's `content.lock`
  signal, for `revoked` **and** `expired`. The live book is spared on the app-state sweeps only —
  background playback is a supported state — but never on a lock, since the licence is gone.
- ⚠️ **No test covered the encrypted audio fixture** (was #4) — resolved once, then **un-resolved by
  the backend wiring.** It was closed by an `ENCRYPTED` block in `devContentSeed.audio.test.ts`,
  which pinned the full seed-side round trip (encrypt on seed → cold read → real `unwrapBek` +
  tag-verified decrypt → byte-identical WAV). That file was deleted with the audio seed on
  2026-08-25, because the thing it tested — seeding audio locally — no longer happens. Nothing
  regressed; the coverage simply stopped being about anything real. **What is actually untested now
  is the backend path, which is row 5 below.** Recorded rather than deleted so the same finding is
  not re-opened as new.
  **Residual, now a player problem not a file one:** unlinking does not stop a native player that
  already has the file open, so a book revoked mid-playback plays on until the player is released.
  Stopping it means releasing the singleton and clearing the lock-screen card — a product call, and
  `offline-lock.ts` is explicit that Sync's signals are advisory. See `AUDIO_PLAYER_DECISION.md`
  Part 2.

### Still open

| # | Issue | Why | Owner |
| - | --- | --- | --- |
| 1 | 🔴 **`contentStore.destroy()` emits no event, so a destroyed book's decrypted scratch file survives until the next app-state sweep** — Sync-driven revocation/expiry IS handled (`content.lock` → release player → delete). A direct `destroy()` is not observable from Reader. Recommended hook (one `eventBus.emit` at the end of `destroy()`) written up in `audio/AUDIO_PLAYER_DECISION.md` Part 4 | no hook exists; adding one edits `contentStore.ts` | **Abhinav** |
| 2 | 🟡 **Delete-after-open REJECTED for Android** — unlinking the scratch file once the player holds a descriptor would cut exposure to milliseconds, but media3's `FileDataSource` reopens **by path** on every unbuffered seek, so seek breaks. iOS (AVURLAsset) looks fine. **Source-analysis only — the device test was not run.** Full reasoning + the retest recipe in `AUDIO_PLAYER_DECISION.md` Part 4 | library architecture, not our code | Reader, if revisited |
| 3 | 🟡 **iOS `NSFileProtectionComplete` not applied** — `expo-file-system`'s new File/Directory API exposes no file-attribute surface; would need a native call, which is out of scope. Default is `CompleteUntilFirstUserAuthentication` | library gap | documented, not fixed |
| 4 | 🔴 `closeBook()` is terminal for an `openBook`-acquired audiobook | CLAUDE.md open item 1, new route | **Abhinav** |
| 5 | 🟡 **No automated test exercises the REAL encrypted audio path** — `audioAssetResolver.test.ts` mocks `openBook`, so fetch → unwrap → decrypt → play is only ever proven by hand. Inherent to needing a live backend and a device keypair; the manual steps are in `AUDIO_PLAYER_DECISION.md` Part 3 | was "nothing references `audioEncrypted`", which is now deleted | Reader |
| 6 | 🟡 stale "audio is never encrypted" claims | Reader-owned ones are now **all corrected** (`readerAssets.ts`, `readerBridge.ts`, `audioAssetResolver.ts`, `devContentSeed.ts`, `AUDIO_PLAYER_DECISION.md`). What remains is outside Reader: `primitives.ts:25` and `reading-session.ts:60` are **frozen**, and `downloadManager.ts:263` ("both contracts agree audio is never encrypted regardless of tier") + `contentStore.ts:482` ("open access / audio: already plaintext") are Abhinav's | Reader ✅; the rest → **Abhinav** |
| 7 | 🟡 `MAX_DECRYPTED_BYTES` mis-cited — encrypted audio still gets `MAX_AUDIO_DECRYPTED_BYTES` (20 MB), not 25 MB; `maxDecryptedBytesFor` keys off **format** (`contentStore.ts:74`) | | one-word fix, both repos |
| 8 | 🟡 Encrypted-audio memory unmeasured | `AUDIO_MEMORY_REPORT.md` measured the **plaintext** path (2 copies, ~+40 MB). Encrypted audio takes the EPUB/PDF decrypt path — CLAUDE.md open item 2 puts that at ~6 copies, order ~120 MB transient at the cap | Reader |

### Not issues
Memory headroom (closed by the 20 MB cap). `contentStore` decrypt (already format-blind).
Fixture-id coordination (aligned). Client crypto (the backend's scheme is the one already implemented).

---

## 7. Reproducing this

```bash
git -C "../tf_reader_backend_temp" log --oneline -3          # expect 225230e
sed -n '120,180p' ../tf_reader_backend_temp/src/main/java/com/tf/reader/content/service/ContentAccessGrantImpl.java
cat ../tf_reader_backend_temp/src/main/java/com/tf/reader/reading/service/RightsService.java
grep -c "ArrayBuffer\|Uint8Array" node_modules/expo-audio/build/Audio.types.d.ts   # → 0
```
