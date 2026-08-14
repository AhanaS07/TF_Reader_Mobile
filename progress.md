# Progress vs BuildPlan.md — snapshot 2026-08-12

Reference snapshot of where Download + Encryption stands against `BuildPlan.md`'s phases.
Update this when phase status materially changes — it's a point-in-time snapshot, not a living
doc like `docs/build-status.md` (which has the detailed evidence/artifact-level tracking; this
file is the phase-level summary that points back to it).

**2026-08-12: independently re-verified.** A dedicated audit agent re-derived every phase status
below directly from the actual code (file existence, grep for real implementations vs stubs, a
real `tsc --noEmit` + `npx jest` run — not by trusting this file's or `docs/build-status.md`'s own
claims). Every status below matched; no corrections needed. The same verification pass (three
other agents, run in parallel) also found and fixed 2 real bugs in `contentStore.ts` — see
`docs/build-status.md`'s "Full-project verification sweep, 2026-08-12" entry and `bugs.md` for
the complete list. Full suite after the fixes: 12 test suites, 113/113 tests, typecheck/lint
clean, `npm run test:ci` clean.

## Phase status

| Phase | Status |
|---|---|
| 0 — Environment & Contracts | **Done** (Expo bootstrap, `src/shared/contracts/` frozen) |
| 0.5 — Mock backend | **Done** (`mock-backend/`, server-tested per `docs/build-status.md`) |
| 1 — Encryption round-trip spike | **Done.** AES-GCM encrypt/decrypt + tamper detection: confirmed on real iOS/Android simulators. Device keypair generation + BEK wrap/unwrap (RSA-OAEP-256): implemented via `react-native-quick-crypto`, confirmed on both real iOS Simulator AND Android emulator (`docs/build-status.md`, 2026-08-11/12). Physical-device confirmation still outstanding on both platforms; the private key is a software (JSI) key, not hardware-backed (Secure Enclave/StrongBox) — flagged, not hidden. |
| 2 — Reader shell (plaintext) | **Not started** — Ahana's side, `src/features/reader/` is empty, `App.tsx` is still a placeholder. |
| 3 — Download skeleton | **Done** (2026-08-13, via SDD). `src/features/download/` implements permission check, storage check, the 5-book limit (correctly tracked across *different* books, not just re-downloads), content-licence fetch, checksum verify, RAM-budget pre-check, and hand-off to `contentStore.store()`. See "Download flow landed" below. |
| 4 — Full download flow | **Done** — same landing as Phase 3; Subscription (persisted) and Elite (memory-only) both exercised end-to-end, including a real RSA-wrapped-BEK round trip in `downloadManager.test.ts`. |
| 5 — Content-provider (superseded by whole-file decrypt) | **Done**, against the amended (whole-file, not windowed) design. `contentStore.ts` (`store`/`openSession`/`decryptBook`/`close`/`destroy`/`decryptSearchIndex`) and `contentProvider.ts` (`getBook`/`closeBook`, the actual Reader-facing seam) both fully implemented and tested, plus multiple adversarial edge-case passes and a cross-file bug hunt (see `docs/build-status.md` for the full list of bugs found and fixed, and `bugs.md`). Search-index encrypt/decrypt (`mockSearchIndex.ts`, `decryptSearchIndex`) added 2026-08-12, per search.ts's own contract that the index rides the same BEK as the book — implemented as an independent decrypt pass, not bundled into `decryptBook`, so an index-integrity failure can never block reading the book itself. |
| 6 — Offline licence validation | **Partial.** Expiry is checked for real in `decryptBook`. Ed25519/RS256 signature verification and anti-rollback: not implemented. |
| 7 — Reader ↔ Encryption integration | **Not started** (needs Phase 2 to exist). |
| 8 — Elite tier | **Partial** — `canPersist: false` branching exists in `contentStore.ts` (no disk/keychain writes); the seat/WebSocket side is Sync's, not built. |
| 9 — Lock reactions & hardening | **Not started.** |

## The Reader-facing "get decrypted file" call

BuildPlan.md's whole-file-decrypt amendment calls it `openBook(bookId)`; the actual frozen
contract (`src/shared/contracts/content-provider.ts`) calls it `ContentProvider.getBook(bookId):
Promise<Bytes>` — code wins per the barrel's own drift rule.

Now implemented: `src/features/encryption/contentProvider.ts` exports `getBook(bookId)` and
`closeBook(bookId)` — a thin (~40-line) delegation to `contentStore.ts`, exactly the "nearly free
wrapper" this section used to describe as not-yet-written. 10 tests, no bugs found in an
edge-case pass focused on the wrapper's own wiring (not re-testing `contentStore.ts`). What
actually still blocks it from being USEFUL end-to-end, unchanged:

1. ~~RSA wrap/unwrap stub (`deviceKeypair.ts`)~~ — **done** (see Phase 1 above).
2. ~~No download flow (Phase 3/4)~~ — **done, 2026-08-13.** `downloadManager.downloadBook(bookId)` now calls `contentStore.store()` for real, fed by `contentLicenceClient.ts` against `mock-backend/`. `devContentSeed.ts` remains as a temporary stand-in ONLY because there's no navigator yet to supply a real `bookId` to `ReaderScreen` — see `CLAUDE.md`'s "Temporary scaffolding" section for the exact removal condition.
3. **No Reader screen** (Phase 2/7, Ahana's side) — nothing yet calls `getBook()`/`closeBook()`. This file exists now so that side has something real to import once it does.

## Current focus

Phase 1 is complete as of 2026-08-11/12: `deviceKeypair.ts` implements real RSA-OAEP-256 keypair
generation + BEK wrap/unwrap (`react-native-quick-crypto`), confirmed on-device on BOTH iOS
Simulator and Android emulator. `contentStore.ts`'s `decryptBook` works genuinely end-to-end for
Subscription books with no pre-seeded-key shortcut. `contentProvider.ts` (the actual
`ContentProvider.getBook` Reader-facing seam) is now implemented and tested as of 2026-08-12.
Encryption's own remaining Phase-1-adjacent gap (deferred, not blocking): licence signature
(RS256) verification is still not implemented.

A 2026-08-12 verification sweep (typecheck/lint/test + a cross-file adversarial review + a config/
build-file audit + an independent phase-status re-check, 4 agents in parallel) found and fixed 2
real bugs in `contentStore.ts` (both regression-tested, see `docs/build-status.md` and `bugs.md`)
and confirmed everything else — dependencies, `eslint.config.js`, `tsconfig.json`, `app.json`,
`.gitignore`, all `__mocks__/*.js` files, `package-lock.json` sync — is clean. No discrepancies
between this file's phase claims and the actual code.

Next candidate, per the list above: Phase 3/4 (Download flow) — the other half of Abhinav's own
scope, and the thing that would actually feed `contentStore`/`contentProvider` with real data
instead of test fixtures. Everything on the Encryption side that Reader needs to build against
now exists.

**Update 2026-08-13: Phase 3/4 landed.** See "Download flow landed, 2026-08-13" below. Next
candidate is now either (a) acting on the flambeau real-backend contract findings
(`flambeau-contract-comparison.md`) — the current `content-licence.ts` is a pre-spec guess and the
real backend re-verifies entitlement on every book *open*, which this codebase doesn't do at all
yet — or (b) Phase 6's remaining gap (RS256 licence signature verification, anti-rollback), or
(c) a physical-device confirmation pass (everything so far is simulator/emulator only).

## Download flow landed, 2026-08-13

`src/features/download/` went from empty (`.gitkeep` only) to a full, tested skeleton via
subagent-driven-development: `config.ts`, `errors.ts` (`DownloadFailure`/`DownloadError`),
`permissions.ts`, `storageCheck.ts`, `contentLicenceClient.ts`, `deviceKeyRegistration.ts`,
`downloadManager.ts`, plus matching test files. `downloadManager.downloadBook(bookId)` is the
single entry point: permission → storage → 5-book limit (tracked correctly across *different*
books via `downloadTable`, not `downloadRepository`'s single-fixed-book-id convenience methods) →
fetch content-licence → fetch encrypted asset → verify checksum → reject oversized books BEFORE
persisting → best-effort fetch the search index if the licence has one → `contentStore.store()` →
record the download under a write lock (re-checking the 5-book cap inside the lock, with a
rollback `destroy()` if it lost the race).

Two real bugs found and fixed by a 4-agent audit after the skeleton landed (full detail: `bugs.md`
#22/#23):
- `contentStore.ts`'s `store()` never invalidated the Keychain-cached raw BEK on a genuine
  re-download under a NEW `wrappedBek` (key rotation / re-licensing) — the stale cache would win
  forever, making the freshly-stored ciphertext permanently undecryptable
  (`ContentFailure(INTEGRITY_FAILED)`). Fixed: `store()` now compares the incoming `wrappedBek`
  against the previously-persisted one and invalidates the cached key on a mismatch.
- `content-licence.ts` had no field for delivering a search index URL at all, so
  `contentStore.ts`'s already-built `decryptSearchIndex`/`getIndex` path was unreachable outside
  test fixtures. Fixed against the REAL flambeau contract (not a guess) — added
  `ContentLicenceIndexInfo`/`index?` and wired `downloadManager.ts` to fetch it as an independent,
  non-fatal failure domain from the book itself.

Also fixed this same day: `base64.ts`'s decode path was an O(n²) `indexOf`-per-character scan —
real, measured 26–44% faster on-device after switching to an O(1) lookup table. The encode path
was deliberately left alone after on-device (Hermes) measurement showed a rewritten version was
SLOWER, not faster, on both iOS Simulator and Android emulator — see the file's header for exact
numbers before attempting to "optimize" it again without fresh on-device measurement.

**Verified 2026-08-13, whole repo:** `npx tsc --noEmit` clean, `npm run lint` (`--max-warnings=0`,
full repo) clean, `npx jest --ci` — **31 test suites, 282/282 tests pass**.

**Real-backend contract review, 2026-08-13:** read team flambeau's actual published OpenAPI spec
(`https://deepu1004.github.io/flambeau-api-contracts/`) against our DRAFT `content-licence.ts`.
Full comparison and merge recommendation in `flambeau-contract-comparison.md` (no code changed
for that review). Headline finding: the real backend re-checks entitlement on **every book open**
(`POST /api/v1/reading-sessions`, ~5 minute grant), not once at download time — a real gap in this
codebase today, not a hypothetical. Also: no separate device-registration endpoint exists on the
real backend (`device-key.ts`/`deviceKeyRegistration.ts` model an architecture that doesn't match
reality and `deviceKeyRegistration.ts` is confirmed unused anywhere in the app); no `checksum`
field exists in the real grant; a loan/borrow concept exists server-side that nothing in this repo
models at all. Not yet acted on — flagged for a scoping decision.

## Aside: Sync module folded into the app, 2026-08-12

Not a Download+Encryption phase — Sync is Karthik's capability — but done in this repo, so noted
here for continuity. `src/features/sync/frontend/` (a standalone nested Expo project) is now a
normal module at `src/features/sync/`, same structure as every other feature folder; the demo-only
UI was dropped. 50 new Jest tests, typecheck/lint clean, and a genuine on-device confirmation on
both iOS Simulator and the Android emulator (real `expo-sqlite`/`expo-crypto`, not the Jest mock —
see `docs/build-status.md`'s "Sync module integration" section for the full detail and console
output). No live Sync backend was available to confirm an actual push/pull round trip against.
