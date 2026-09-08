# To be done — TF Reader Mobile, CAP-7 (Reader & Offline)

## 1. What this repo actually is

One repo, two unrelated work streams:

- **`main`** — team1's line of work, capabilities CAP-2/CAP-3 (institution listing /
  institute selection). See root `README.md`. Not what this doc is about.
- **The `T4_*` branches** (you're almost certainly on one, e.g. `T4_Abhinav`) — a
  second team ("t4targaryen") building **CAP-7: Reader & Offline** — an EPUB/PDF/
  audiobook reader with encrypted offline downloads and cross-device sync. See root
  `T4_Readme.md`. **This doc is entirely about CAP-7.**

Stack: Expo SDK 57 (**dev-client build, not Expo Go** — the app needs native crypto
modules Expo Go can't load), React Native 0.86.2, React 19.2.3, TypeScript 6 in
strict mode, React Navigation v7, Zustand, `expo-sqlite`, Jest + RNTL.

## 2. The CAP-7 team and who owns what

CAP-7 is split into feature folders under `src/features/`, one per owner:

| Folder | Capability | Owner | Branch | Status right now |
|---|---|---|---|---|
| `encryption/` | Content encryption at rest (D4) | Abhinav | `T4_Abhinav` | **Built, heavily tested** |
| `download/` | Download flow (D2) | Abhinav | `T4_Abhinav` | **Built, tested** (2026-08-13) |
| `reader/` | Reader UI, WebView + epub.js/pdf.js (D1) | Ahana | `T4_Ahana` | Empty on this branch |
| `sync/` | Offline-first sync, outbox pattern | Karthik | `T4_Karthik` | **Built, well tested**, folded into this branch |
| `personalization/` | Prefs store (theme/font/layout/zoom) | Vaishnavi | `T4_Vaishnavi` | Small real implementation (in-memory stub) |
| `search/` | Search index build/query | Vaishnavi | — | Design-only `README.md`, no code |
| `accessibility/` | A11y settings UI | Hruthik | `T4_Hruthik` | Empty — the actual a11y *types* live in `shared/contracts/accessibility.ts`, not here |

`shared/` (contracts, samples) is lead-owned by Ahana but every owner above
contributes the contract file for their own domain (see §5).

Each owner works on their own `T4_<name>` branch; branches get merged into
`dev_T4` and periodically up to `upstream:stage`. Because branches get merged
into each other, **git commit authorship on a shared branch doesn't reliably
tell you who wrote what** — if you need real per-file ownership, check the
header comment in the file itself (most contract/module files state their
owner explicitly) rather than `git blame`.

## 3. Terms you'll see everywhere

A few words get used without being spelled out elsewhere — worth knowing before
you read further:

- **BEK (Book Encryption Key)** — a random AES-256 key generated per book. It's
  what actually encrypts/decrypts the book's bytes. It gets "wrapped" (RSA-
  encrypted) to a specific device's public key so only that device's private
  key (in the keychain) can unwrap it.
- **Tier (`AccessTier`: `'OA' | 'Subscribed' | 'Elite'`)** — how a book is
  licensed, defined in `shared/contracts/tier.ts`. **OA** = open-access,
  unencrypted. **Subscribed** = encrypted, downloaded, persisted to disk for
  offline reading (the path described in §6's Encryption walkthrough).
  **Elite** = online-only, no download, no disk/keychain writes at all —
  access is gated by a concurrent-seat system (join/leave a "seat," like a
  limited-concurrent-reader licence) that's Sync's responsibility, not
  Encryption's. What actually assigns a tier to a given book/user is decided
  server-side and isn't implemented in this repo yet (it arrives as part of
  the licence).
- **Outbox (pattern, in Sync)** — every local database write also queues a
  "please sync this" record in an `outbox` table, inside the same transaction.
  A background/manual sync step drains that queue against the backend later.
  This is how writes stay instant and offline-safe: nothing waits on network.
- **LWW (Last-Write-Wins)** — the conflict rule Sync uses when the same record
  was edited both locally and on the server: whichever `updatedAt` timestamp is
  newer wins. Compared against a stored `server_updated_at`, not against the
  device's own clock, to avoid clock-skew bugs.

## 4. Why the app can't just run in Expo Go

`react-native-keychain`, `react-native-aes-gcm-crypto`, and `FLAG_SECURE` are
native modules — Expo Go doesn't bundle them. You need a dev-client build:

```bash
npm ci
npx expo prebuild        # generates android/ and ios/ (gitignored, CNG-managed — never hand-edit)
npm run android          # or: npm run ios
```

Known dependency risk, accepted deliberately (see `T4_Readme.md`):
`react-native-aes-gcm-crypto` is unmaintained (last published 2022) and
untested on the New Architecture — validated by hand on-device instead (see
`docs/build-status.md`), and whitelisted in `package.json`'s
`expo.doctor.reactNativeDirectoryCheck.exclude` so `expo-doctor` doesn't flag it
every time.

Everyday commands:

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint . --max-warnings=0
npm test             # jest
npm run test:ci      # what CI actually runs
```

CI (`.github/workflows/ci.yml`) runs `typecheck` as its own job (so a contract
freeze break is obviously the cause) plus `lint` + `test:ci` as a second job,
on every PR to `main`/`dev_T4`.

## 5. The one thing to understand before touching any feature folder: `shared/contracts/`

Modules don't import each other directly. They only import from
`src/shared/contracts/` — a set of TypeScript interfaces frozen in "Week 1" so
every owner could build against a stable shape without constant
cross-team sync-ups. Read `docs/contracts/contracts.md` first (plain-language
walkthrough of the Download+Encryption↔Reader seam) and skim
`src/shared/contracts/index.ts` (the barrel — it documents which exports are
real runtime values vs. type-only).

Rules that actually matter:

- **Code wins over docs.** Every contract-explainer doc (including this one)
  says so explicitly. If `docs/contracts/contracts.md` disagrees with
  `content-provider.ts`, the `.ts` file is correct.
- **`__typecheck__.ts` is a canary, not a bug.** It pins frozen shapes with
  `satisfies`/`@ts-expect-error`. If it fails to compile, a frozen contract
  changed underneath someone — go find out why before "fixing" the canary by
  loosening it.
- **Failures are typed and fail-closed.** `errors.ts` defines `ContentError`/
  `ContentFailure`; the whole design assumes a decryption/licence failure is a
  hard deny, never a silent fallback to plaintext or a stale copy.
- **Some contracts are explicitly draft, not frozen** — `device-key.ts` and
  `content-licence.ts` are marked "written against a mock backend, not a
  confirmed backend contract yet." Don't build hard assumptions on their exact
  field names.

## 6. What's actually built — module by module

### Encryption (`src/features/encryption/`) — the most complete module

A whole-book, at-rest encryption pipeline. Plain-English flow:

1. Each device generates one RSA-2048-OAEP-256 keypair once (`deviceKeypair.ts`);
   the private key lives in the OS keychain.
2. Each book gets its own random AES-256 key (the "BEK"), wrapped (RSA-encrypted)
   to the device's public key, shipped alongside the book.
3. `contentStore.store()` persists ciphertext + wrapped key + licence metadata
   to disk (Subscription tier) or keeps it in memory only (Elite tier, which
   never touches disk/keychain by design).
4. `contentProvider.getBook(bookId)` — **the one function Reader is meant to
   call** — opens a session, unwraps the BEK, AES-256-GCM-decrypts the whole
   file into a RAM buffer. `closeBook(bookId)` **must** be called on unmount;
   it zeroes the plaintext in memory. This is a lifecycle requirement, not a
   style preference.
5. Search indexes decrypt through the same seam (`getIndex`) but as an
   independent decrypt pass, so a corrupted index can never block reading the
   book itself.

Real and tested: AES-GCM encrypt/decrypt, RSA wrap/unwrap, keychain storage,
disk persistence, a hard 25MB RAM budget (checked before *and* after decrypt),
licence expiry checks, concurrency de-duplication, tamper detection. Confirmed
on real iOS Simulator and Android emulator (console-logged proof in
`docs/build-status.md`) — **never on a physical device**.

Explicitly NOT done: licence **signature (RS256) verification** — only expiry
is checked, so "decrypted successfully" does not mean "licence cryptographically
verified." The RSA private key is a **software** key (JS-reachable), not
hardware-backed (no Secure Enclave/StrongBox). Full list: `bugs.md`'s "Open /
known, not fixed" section.

### Download (`src/features/download/`) — built and tested, 2026-08-13

Phase 3/4 of `BuildPlan.md`, landed via subagent-driven-development.
`downloadManager.downloadBook(bookId)` is the single entry point: permission
check → storage check → the 5-book limit (tracked correctly across
*different* books via `downloadTable`, not `downloadRepository`'s
single-fixed-book-id convenience methods) → fetch content-licence → fetch the
encrypted asset → verify checksum → reject an oversized book BEFORE
persisting (so it never burns one of the 5 offline slots) → best-effort fetch
the search index if the licence has one (independent, non-fatal failure
domain) → hand off to `contentStore.store()` → record the download under a
write lock, re-checking the cap inside the lock with a rollback `destroy()` if
it lost the race to another concurrent download.

`contentStore.store()` now really is called in production, not just from
tests — though there's still no navigator to drive it from a real user
action yet; `devContentSeed.ts` remains a temporary dev-only stand-in for
that (see `CLAUDE.md`'s "Temporary scaffolding" section).

Two real bugs found and fixed the same day (full detail: `bugs.md` #22/#23):
a stale Keychain-cached BEK surviving a genuine re-download under a new key
(permanent `INTEGRITY_FAILED`), and `content-licence.ts` having no field to
ever deliver a search index URL at all. Also fixed: `base64.ts`'s decode path
was `O(n²)` (an `indexOf` scan per character) — measured 26–44% faster
on-device after switching to an `O(1)` lookup table.

**Real-backend contract review, 2026-08-13:** the actual flambeau OpenAPI
spec was read against our DRAFT `content-licence.ts` — see
`flambeau-contract-comparison.md`. Headline finding: the real backend
re-checks entitlement on **every book open** (not just at download time),
which nothing in this repo does yet. Not acted on — flagged for a scoping
decision, since building it crosses the Download/Reader boundary.

### Sync (`src/features/sync/`) — built, well tested, no live backend confirmed

Offline-first sync for progress/bookmarks/highlights/personalization/
accessibility/downloads. Every local write goes to SQLite first (via
`expo-sqlite`) and enqueues an outbox op in the same transaction — reading and
annotating never blocks on network. `syncManager.ts` drains the outbox against
a REST API one op at a time (POST→PUT fallback on 409, PUT→POST fallback on
404), using Last-Write-Wins conflict resolution based on `server_updated_at`
(not local timestamps — phone/server clock skew makes that meaningless).
`useConnectivity.ts` checks `isConnected` (device has *a* network), not
`isInternetReachable` (probes the public internet) — deliberate, because the
real backend is LAN-only and the stricter check would false-flag office
Wi-Fi as offline.

No live sync backend exists yet to confirm an actual push/pull round trip —
only "fails cleanly when nothing's listening" has been verified on-device.
Note: `mock-backend/` at the repo root is unrelated to Sync — it's a separate
Express mock for Download+Encryption's own backend calls (device-key
registration, licences, signed URLs, seat join/leave).

### Personalization (`src/features/personalization/`) — small, real, in-memory

`prefsStore.ts` implements a `PrefsStore` (get/save/reset) purely in memory,
by design — a header comment says it depends only on the frozen contract, not
on the DB, pending a SQLite swap-in. Recently fixed a real bug where reset
defaults for different users aliased the same nested objects (mutating one
user's accessibility prefs silently mutated everyone's) — see `bugs.md` #17.

### Search, Accessibility, Reader — stubs on this branch

- `search/` has a design-only `README.md` (owner: Vaishnavi, "Day-3... Day-4
  implementation"), no code. The actual encrypt/decrypt of a search index is
  done (Encryption side); the query/index-build logic is not.
- `accessibility/` folder is an empty stub — the real types
  (`AccessibilityPrefs`, `DEFAULT_ACCESSIBILITY_PREFS`) live in
  `shared/contracts/accessibility.ts` instead, composed into `SharedPrefs`.
- `reader/` is empty on this branch (it exists on `T4_Ahana`). `App.tsx` is a
  deliberate placeholder — a comment states it should stay near-empty until
  `RootNavigator` exists.

## 7. Done vs. not done, across the whole team

This section exists so a newcomer never has to ask "wait, is X actually
finished?" for ANY track, not just the one covered by `BuildPlan.md`. Two
parts: the phased plan (which only covers Reader/Download/Encryption), then
everything else, tracked by owner instead of phase number since no phase
document exists for them.

### 7a. Reader / Download / Encryption track (`BuildPlan.md`'s Phase 0–9)

| Phase | What it is | Status |
|---|---|---|
| 0 | Environment & contracts | **Done** |
| 0.5 | Mock backend | **Done** (`mock-backend/`) |
| 1 | Encryption round-trip spike | **Done** — confirmed on iOS Simulator + Android emulator, never physical hardware |
| 2 | Reader shell (plaintext) | **Not started** — `src/features/reader/` empty on this branch |
| 3 | Download skeleton (OA/unencrypted) | **Done** (2026-08-13) — see §6 below |
| 4 | Full download flow (Subscribed tier) | **Done** (2026-08-13) — Subscription (persisted) and Elite (memory-only) both exercised end-to-end in `downloadManager.test.ts`, including a real RSA-wrapped-BEK round trip |
| 5 | Content-provider decrypt module | **Done** (superseded design: whole-file decrypt, not the original RAM-windowed plan) |
| 6 | Offline licence validation | **Partial** — expiry is checked for real; RS256 signature verification and anti-rollback are **not implemented at all** |
| 7 | Reader ↔ Encryption integration | **Not started** (needs Phase 2 first) |
| 8 | Elite tier | **Partial** — the "no persistence" branching exists in `contentStore.ts`; the seat/WebSocket concurrent-access side is Sync's and is **not built** |
| 9 | Lock reactions & hardening | **Not started** — no code exists for offline-lock signal handling, `FLAG_SECURE`, or the exhaustive error-path testing this phase calls for |

### 7b. Sync, Personalization, Search, Accessibility — no phase document exists, so tracked here instead

**Sync (Karthik)**
- Done: local SQLite schema for all 6 record types, outbox/write-ahead queue
  pattern (atomic with every local write), retry backoff (PENDING → FAILED →
  DEAD), Last-Write-Wins conflict resolution, connectivity detection, ~1300
  lines of tests, on-device confirmation of the local engine on both iOS
  Simulator and Android emulator.
- Not done: **no live backend exists to sync against** — a real push/pull
  round trip has never been confirmed, only "fails cleanly when nothing's
  listening." The heartbeat/WebSocket seat lifecycle Elite tier depends on is
  **not built at all**. The server doesn't yet support conflict-aware writes
  or incremental pulls, so every sync pulls the *entire* remote collection.

**Personalization (Vaishnavi)**
- Done: a working `PrefsStore` (get/save/reset) covering theme/font/
  typography/layout/zoom/accessibility, Last-Write-Wins via `updatedAt`, a
  recently-fixed bug where reset defaults leaked across users.
- Not done: it's **in-memory only, by design, pending a SQLite swap-in** —
  nothing persists across an app restart yet. There's also no delete
  operation on the store.

**Search (Vaishnavi)**
- Done: the encrypt/decrypt half lives on the Encryption side and is
  finished — `contentStore.decryptSearchIndex` / `contentProvider.getIndex`.
- Not done: everything else. `src/features/search/` contains only a
  design-only `README.md` ("Day-3... Day-4 implementation") — no index-build
  logic, no query logic (`queryIndex`), no code at all yet.

**Accessibility (Hruthik)**
- Done: the shared contract types exist —
  `AccessibilityPrefs`/`DEFAULT_ACCESSIBILITY_PREFS` and resolver functions in
  `shared/contracts/accessibility.ts`.
- Not done: `src/features/accessibility/` itself is a completely empty
  stub — no UI, no feature code of any kind yet.

**Reader (Ahana)**
- Not done, on this branch: `src/features/reader/` is empty and `App.tsx` is
  a deliberate placeholder. (Real Reader work lives on `T4_Ahana` — see
  `ahana.md` for the integration contract it's expected to build against.)

## 8. Open items that aren't any one module's fault

These are project-level gaps — cutting across owners, not bugs in a specific
file — worth knowing so you don't assume they're solved or accidentally
re-discover them from scratch:

- **The Day-3 contract co-freeze between Reader (Ahana) and Encryption
  (Abhinav) hasn't happened as an actual conversation.** The current
  `EncryptionDescriptor`/`SignedLicence` field shapes are Encryption's
  reasoned first pass, not a confirmed two-sided agreement.
- **RSA key rotation is undecided.** `generateDeviceKeypair()` is
  deliberately idempotent (never silently regenerates, to avoid orphaning
  already-wrapped BEKs), but there's no "rotate" path, and no owner has been
  assigned to design one.
- **The 25MB RAM budget (`MAX_DECRYPTED_BYTES`) is a placeholder, not a
  measured number** — nobody has measured whole-file decrypt's real memory
  footprint against actual book/audiobook sizes yet.
- **Filesystem I/O failures (disk full, permission denied) during
  `store()`/`loadPersisted()` escape as raw Node/fs errors, not the
  contract-mandated typed `ContentFailure`.** Fixing this needs a new
  `ContentError` code, which is a shared-contract taxonomy decision blocked on
  Reader+Encryption agreement, not a one-line fix.
- **Nothing in the entire project has been confirmed on physical hardware** —
  every on-device confirmation so far (Encryption, Sync) is simulator/emulator
  only.
- **No per-open access re-verification exists anywhere in this codebase**,
  and the real flambeau backend's design (read 2026-08-13, see
  `flambeau-contract-comparison.md`) explicitly re-checks entitlement on
  *every* book open, not just at download/borrow time, because access can
  lapse in between. A revoked subscription today has zero effect on a book
  already sitting on disk. Building the real check crosses the
  Download/Reader boundary and hasn't been scoped yet.
- **`content-licence.ts`/`device-key.ts` (DRAFT contracts) diverge from the
  real, now-published backend spec in ways beyond field names** — no
  `sessionId`/loan concept, a `checksum` field with no backend counterpart,
  and a device-registration model (`deviceKeyRegistration.ts`, confirmed
  unused anywhere in the app) that doesn't match the real "send the key every
  time, register nothing" design. Full comparison and merge recommendation:
  `flambeau-contract-comparison.md`. Not acted on yet.

## 9. Current build health (superseded — re-check before trusting either snapshot)

**Verified 2026-08-13, whole repo, after the Download flow (Phase 3/4) landed:**

```
npm run typecheck   → PASS, 0 errors
npm run lint         → PASS, 0 errors/warnings (--max-warnings=0, full repo)
npx jest --ci        → PASS — 31 test suites, 282/282 tests
```

The 2026-08-12 snapshot below is kept for history but no longer reflects the
working tree — both issues it described (the lint warnings, the timing-out
concurrency test) were resolved before this 2026-08-13 run, which supersedes
it:

```
npm run typecheck   → PASS, 0 errors
npm run lint         → FAIL — 2 warnings in progressRepository.test.ts
                        (import/no-duplicates), tripped by --max-warnings=0
npx jest             → FAIL — 1 of 227 tests times out:
                        "createSyncableTable — applyServerRecord vs. a
                        genuinely concurrent local edit" (progressRepository.test.ts)
                        21 of 22 suites pass.
```

As of 2026-08-13, staged-but-uncommitted on `T4_Abhinav`:
`src/features/encryption/contentStore.ts`,
`src/features/encryption/contentStore.edgecases.test.ts`,
`src/shared/contracts/content-licence.ts`, `src/features/download/downloadManager.ts`,
`src/features/download/downloadManager.test.ts`, `src/features/encryption/base64.ts`, and
`src/features/encryption/base64.test.ts` (all from this session's work — bugs #22–#23 and the
base64 decode fix). Still unstaged: `__mocks__/expo-sqlite.js`, `eslint.config.js`,
`package.json`, and the Sync-touching test files noted in the 2026-08-12 snapshot above (run
`git status` to confirm current state — this list goes stale the moment someone commits).

## 10. Where to go deeper

| Doc | What it's for |
|---|---|
| `BuildPlan.md` | The canonical phased plan (Phase 0–9) for Download+Encryption+Reader. Read this for the *intended* design, including the "whole-file decrypt" amendment that superseded the original windowed/chunked plan. |
| `T4_Readme.md` | CAP-7 folder structure, ownership map, branch/PR workflow, the `react-native-aes-gcm-crypto` risk writeup. |
| `docs/build-status.md` | The living status doc — dated entries with actual on-device console output as evidence, not just claims. The most trustworthy source for "was X actually confirmed, and how." |
| `docs/contracts/contracts.md` | Plain-language explainer of the Encryption↔Reader contract. |
| `progress.md` | Abhinav's phase-by-phase snapshot against `BuildPlan.md`, most recently re-verified 2026-08-12. |
| `bugs.md` | Every bug found on the Encryption/Sync/Personalization side so far — fixed and still-open. Read this before you "discover" something that's already a known, deliberately-deferred gap. |
| `ahana.md` | A handoff note written for the Reader owner, showing exactly how to wire `contentProvider.getBook`/`closeBook` into a real reader screen — useful as a worked example of how two modules are meant to integrate through the contracts. |
| `NotMyWork.md` | A git-attribution reconciliation note — a reminder that on a shared, multi-owner branch, commit authorship isn't a reliable ownership signal. |
| `flambeau-contract-comparison.md` | 2026-08-13 comparison of our DRAFT `content-licence.ts` against team flambeau's actual published OpenAPI spec — field-by-field differences and a merge recommendation. Read this before touching `content-licence.ts`/`deviceKeyRegistration.ts` again. |
| `README.md` | Team1's CAP-2/3 doc — only relevant if you end up touching `main`, not CAP-7. |

## 11. If you're picking this up: suggested first steps

1. `npm ci && npm run typecheck && npm run lint && npm test` — see the real
   current state yourself (expect the lint/test failures noted in §9 until
   someone fixes them).
2. Read `src/shared/contracts/content-provider.ts` and `errors.ts` in full —
   short files, and they're the actual API surface you'll build against
   regardless of which feature you're assigned.
3. Pick your track:
   - **Continuing Download+Encryption**: `src/features/download/` is now
     built (Phase 3/4, `downloadManager.ts` + friends) — read
     `flambeau-contract-comparison.md` first if you're touching
     `content-licence.ts` or the licence-fetch client, since the real backend
     contract diverges from what's there today in ways bigger than field
     names (per-open re-verification, no device-registration endpoint, no
     `checksum` field). Otherwise, `bugs.md`'s "Open / known, not fixed"
     section has the current real gaps.
   - **Sync**: start with the failing test in §9, then `syncManager.ts` and
     `repositories/syncableTable.ts`.
   - **Reader**: read `ahana.md` — it's written directly against the real
     `getBook`/`closeBook` seam.
   - **Anything else (Search/Accessibility)**: those folders are currently
     just design docs/stubs — you're starting closer to zero than everyone
     else above.
4. Don't re-derive things that are already documented gaps — check `bugs.md`'s
   "Open / known, not fixed" section before spending time on something that
   was already found and deliberately deferred.
