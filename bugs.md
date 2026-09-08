# Bugs — Download + Encryption (CAP-7)

Full bug list accumulated on this branch, compiled 2026-08-12 from `docs/build-status.md`'s
changelog plus a dedicated 4-agent verification sweep (typecheck/lint/test, an adversarial
cross-file review, a config/build-file audit, and an independent phase-status re-check). Fixed
bugs are kept here for the history — see `docs/build-status.md` for full evidence/detail on each.

## Fixed

1. **Mock-backend fixture generator produced a 31-byte key instead of 32.** Hardcoded hex was
   decoded to the wrong length. Caught by an independent length check, not by re-running the
   generator and trusting its own output. (Phase 0.5)

2. **`keyStorage.ts` used Node's `Buffer`, which doesn't exist in the React Native JS runtime.**
   Failed on a real iOS Simulator with `"Property 'Buffer' doesn't exist"`. Fixed by switching to
   the shared portable base64 codec (`base64.ts`), used consistently by every file that needs it
   since. (Phase 1, on-device confirmation)

3. **`generateDeviceKeypair()` had a check-then-act race.** Two concurrent first-time calls both
   saw "nothing stored," each generated its own keypair, and the losing call's already-resolved
   promise handed back a public key that no longer matched what actually landed in the keychain
   (an orphaned public key — anything wrapped to it could never be unwrapped again). Fixed with an
   in-flight-promise guard (`generationInFlight`). Found via an adversarial edge-case pass, not
   the original test suite. (`deviceKeypair.ts`)

4. **`wrapBek`/`unwrapBek` had no BEK length validation.** RSA-OAEP-256 only enforces an upper
   size bound (~190 bytes under a 2048-bit key), so a 16- or 64-byte "BEK" would "wrap
   successfully" and only fail later, more confusingly, inside `aesGcm.ts`. Fixed with an explicit
   `BEK_BYTES = 32` check in both functions. (`deviceKeypair.ts`)

5. **Open-access `decryptBook()` aliased `pkg.content` instead of copying it.** `close()` zeroes
   `session.plaintext` in place; since `pkg` was the same object cached in `packageCache` (shared
   across all future sessions for that book), closing one session silently corrupted the cached
   package itself — every later `openSession`/`decryptBook` for that book returned all zeros.
   Fixed by copying into a fresh `Uint8Array` before caching it as session plaintext.
   (`contentStore.ts`)

6. **Two concurrent `decryptBook()` calls for the same session raced independently.** Both saw
   `session.plaintext === null` and each ran its own decrypt; only the buffer that won the
   last-write race got zeroed by `close()`, leaving the other caller holding a live, never-zeroed
   plaintext copy. Fixed by sharing one in-flight `pending` promise per session, so every caller
   holds the same buffer reference. (`contentStore.ts`)

7. **Re-`store()`-ing a book that dropped its search index left a stale `index.bin` on disk.**
   `store()` only wrote the index file when the new package had one, never deleted a previous one
   when it didn't — a disk-space leak and a landmine for any code that trusted the file's mere
   existence. Fixed: `store()` now deletes the stale index file when the new package has none.
   (`contentStore.ts`)

8. **`store()` silently accepted an encrypted package with `licence: null`.** Since
   `isLicenceExpired()` trivially returns "not expired" when `licence` is null, an encrypted book
   with no licence at all would never have expiry enforced — contradicting `SignedLicence`'s own
   "null ⇒ open access" contract. Fixed: `store()` now rejects `ContentFailure(LICENCE_INVALID)`
   when `encryption` is present but `licence` is null. (`contentStore.ts`)

9. **Open-access content wasn't re-validated against recorded lengths on a cold read.** Encrypted
   packages get their length invariant re-checked for free on every decrypt
   (`assertCipherLayout` inside `aesGcm.decrypt()`); open-access packages had no equivalent — a
   book truncated/corrupted on disk after a valid `store()` would decrypt "successfully" with
   silently wrong-length data on the next cold read (`loadPersisted()`, the normal "app reopened"
   path) instead of rejecting. Fixed: `decryptBook()` now calls `assertLengthInvariant(pkg)`
   unconditionally, covering both paths. Found by a cross-file adversarial review, not a
   single-file-scoped test pass. (`contentStore.ts`, 2026-08-12)

10. **`openSession()` read the entire file into RAM before the RAM budget was ever checked**,
    contradicting the file's own header claim ("checked before AND after decrypt"). The only
    check lived inside `decryptBook()`; the cold-read path called
    `contentFile(bookId).bytesSync()` unconditionally first, so an oversized file was fully loaded
    into JS memory during `openSession()` regardless of whether `decryptBook()` was ever called.
    Fixed: `loadPersisted()` now checks the recorded `originalLength` (from the small `meta.json`
    read) against the budget BEFORE reading the content file's bytes at all — `openSession()`
    itself now rejects immediately for an oversized book. (`contentStore.ts`, 2026-08-12)

11. **`.gitignore` had a bare `*.test.ts` rule silently excluding ALL TypeScript test files from
    git** — including this module's own `aesGcm.test.ts`/`cipherLayout.test.ts`, and blocking any
    new one (`contentStore.test.ts`, `deviceKeypair.test.ts`, etc.) from ever being tracked.
    Since `.github/workflows/ci.yml`'s test job uses `--passWithNoTests`, CI was silently running
    **zero** encryption tests on every PR without failing. Fixed by removing the rule.

12. **`eslint.config.js` linted `mock-backend/` and `__mocks__/` under the Expo/RN ruleset**,
    which doesn't know Node globals (`Buffer`, `__dirname`), producing false `no-undef` errors on
    real Node code. Fixed with a scoped `languageOptions.globals` block for those directories
    (real linting with correct globals, not a blanket ignore that would skip real bugs there too).

13. **Android native build failures for `react-native-aes-gcm-crypto`**: a dead `jcenter()`
    Maven repository reference in its `android/build.gradle` (JCenter shut down years ago), and a
    `minSdkVersion` mismatch (library requires 26, project defaulted to 24). The `minSdkVersion: 26`
    bump via `expo-build-properties` in `app.json` was always a real, permanent fix. The `jcenter()`
    fix was originally a direct `node_modules` edit — not persisted anywhere — and this bit a
    teammate for real on 2026-08-12 (a fresh `npm install` silently restored the broken
    `build.gradle`). **Now permanently fixed**: `npx patch-package react-native-aes-gcm-crypto`
    generated `patches/react-native-aes-gcm-crypto+0.2.2.patch` (the one-line `jcenter()` removal),
    wired to auto-apply via `"postinstall": "patch-package"` in `package.json`. Verified for real,
    not assumed: reinstalled the package from scratch (confirmed `jcenter()` was back), ran a plain
    `npm install` (confirmed the postinstall hook removed it again with no manual intervention),
    then ran a full `expo run:android` — `BUILD SUCCESSFUL in 7m 31s`, a real `app-debug.apk`
    produced.

14. **First implementation of search-index decryption bundled it into `decryptBook`'s own
    decrypt pass** (2026-08-12) — a literal reading of search.ts's "decrypts the whole book AND
    the whole index in one go." Caught before it reached a review pass: a tampered/corrupted
    search index would make the BOOK undecryptable too, since both were decrypted (and could
    both fail) inside the same call. Fixed by making `decryptSearchIndex` a fully independent
    decrypt pass — same resolved BEK, own session state (`indexPlaintext`/`indexPending`), own
    failure domain. An index-integrity failure should never block reading the book.

15. **`decryptSearchIndex` had no `MAX_DECRYPTED_BYTES` guard at all** (2026-08-12) — unlike
    `decryptBook`, which checks the RAM budget both before and after decrypt, a search index of
    any size (tested at 25MB+1KB) decrypted straight into RAM with zero rejection. Found by an
    adversarial edge-case pass, not the original implementation's own tests. Fixed with the same
    pre-/post-decrypt checks `decryptBook` already uses.

16. **A malformed or empty `licence.expiresAt` string made `isLicenceExpired()` silently treat the
    book as never-expiring.** `Date.now() >= new Date(pkg.licence.expiresAt).getTime()` — when
    `expiresAt` is unparseable (e.g. `'not-a-real-date'`) or empty (`''`), `new Date(...).getTime()`
    is `NaN`, and any comparison against `NaN` is always `false`, so the licence would never be
    treated as expired, for the lifetime of the app, on every future `decryptBook()` call. This
    violates `errors.ts`'s fail-closed rule ("every code is a hard DENY... must NEVER fall back to
    plaintext"). Found by a dedicated adversarial testing pass with a real failing test
    (`buildEncryptedPackage` with `expiresAt: 'not-a-real-date'` and `''` both decrypted
    successfully with no error before the fix). Fixed with a minimal addition to
    `assertLicenceMatchesPackage()` (already called from `store()`): reject
    `ContentFailure(LICENCE_INVALID)` when `Number.isNaN(new Date(pkg.licence.expiresAt).getTime())`,
    rejecting the malformed licence at ingestion time rather than silently granting unlimited
    access. (`contentStore.ts`, 2026-08-12)

17. **`InMemoryPrefsStore` seeded and reset records for different users (and across resets)
    aliased the same nested default objects instead of getting independent copies.** `getPrefs()`
    spread the module-level `DEFAULT_PREFS` constant with `...DEFAULT_PREFS`, which only
    shallow-copies the top level; the nested value objects (`font`, `typography`, `layout`, `zoom`,
    `accessibility`) were the literal singleton instances from `shared/contracts`
    (`accessibility.ts` even has a comment warning "Shared reference — do NOT mutate... Reset to
    defaults must deep-copy or every reset will hand out the same nested objects", and exports
    `createDefaultAccessibilityPrefs()` specifically for this, but `prefsStore` never called it).
    `resetPrefs()` had the identical bug via `savePrefs(userId, { ...DEFAULT_PREFS })`. Failure
    scenario: `store.getPrefs('userA').accessibility === store.getPrefs('userB').accessibility` was
    `true`, so mutating one user's "independent" per-user-singleton nested object silently changed
    every other user's record too. Found by a dedicated adversarial testing pass. Fixed by adding a
    `freshDefaultPrefs()` helper that shallow-clones each nested value object and uses
    `createDefaultAccessibilityPrefs()` for accessibility, used by both `getPrefs()` and
    `resetPrefs()`. (`prefsStore.ts`, 2026-08-12)

18. **`.gitignore` silently gitignored `docs/` and `samples/`, contradicting their documented
    purpose as shared, committed artifacts.** `docs/build-status.md` is the canonical,
    heavily cross-referenced status doc (linked from `contentStore.ts`, `mockSearchIndex.ts`,
    `crosscutting.edgecases.test.ts`, `scripts/proveStoreAndDecrypt.ts`, `bugs.md`, `progress.md`,
    `ahana.md`) — but a bare `docs` line in `.gitignore` (added in commit `15955d7` alongside a
    since-removed bare `*.test.ts` rule from the same commit — see bug #11) meant it, and
    `docs/contracts/contracts.md`, were never committed to git (confirmed: `git ls-files docs/`
    only returned `docs/.gitkeep`; `git check-ignore -v docs/build-status.md` matched
    `.gitignore:43`). In this shared, multi-session repo, any updates to that doc by any
    agent/session were invisible to git and at risk of being lost. Similarly, `samples` was
    gitignored despite `generateSampleBook.ts`'s own header explicitly stating its fixtures are
    "tracked in git instead of gitignored, since `samples/` is meant to be a shared, committed
    fixture per the repo README." Found by a dedicated adversarial testing pass. Fixed by removing
    both lines from `.gitignore` (with an explanatory comment); verified `git check-ignore -v
    docs/build-status.md samples/sample-book.epub.enc` now exits 1 (no match; previously matched).
    Deliberately did not run `git add` — left staging for the user. (`.gitignore`, 2026-08-12)

19. **The `expo-sqlite` mock (sql.js-backed) threw on an `undefined` bound param instead of
    silently coercing it to SQL NULL, diverging from the real native module.** Real
    `expo-sqlite`'s own `normalizeParams()` (`node_modules/expo-sqlite/build/paramUtils.js`) does
    `value ?? null`, so a bound `undefined` silently becomes SQL NULL on a real device. sql.js's
    own `bind()` has no case for `typeof undefined` in its param-type switch and throws `"Wrong
    API use : tried to bind a value of an unknown type (undefined)."` instead — a real fidelity
    gap, reachable because `db/mappers.ts`'s `toRow()` functions apply `?? null` by convention
    rather than by type (e.g. `downloadMapper.toRow`'s `format` has no fallback), so a missing
    server field or a future caller can hand `undefined` straight to
    `runAsync`/`getAllAsync`/`getFirstAsync`. On a real device this would silently succeed as
    NULL; in the old mock it threw an unrelated error immediately at bind time, meaning a
    mock-passing test could misrepresent real-device behavior. Found by a dedicated sql.js-mock-
    fidelity adversarial pass (failing test written first). Fixed by adding a `normalizeParams()`
    helper to the mock (mirroring the real one) applied at all three bind call sites.
    (`__mocks__/expo-sqlite.js`, 2026-08-12)

20. **The NaN-`expiresAt` fail-open (bug #16) was only closed at `store()`-time, and was still
    reachable on a cold read.** Bug #16 added a `NaN`-guard to `assertLicenceMatchesPackage()`,
    which `store()` calls before writing `meta.json` — but `isLicenceExpired()` (used by
    `decryptBook()`/`decryptSearchIndex()`) and `isAvailableOffline()`'s own separately-inlined
    copy of the same comparison were never touched. Both re-run `Date.now() >= new
    Date(expiresAt).getTime()` directly against persisted/cached package data, which is always
    `false` when `getTime()` is `NaN` — so any `meta.json` that reaches disk with a malformed
    `expiresAt` without going through the current `store()` gate (e.g. persisted by an app version
    that predates the store()-time validation, still on disk after an app update) is silently
    treated as "never expires," forever, on every future cold read. Found with tests that planted
    a `meta.json` directly on disk (bypassing `store()`), mirroring this file's existing precedent
    for bugs #9/#10: proved `decryptBook()` resolved with plaintext instead of rejecting
    `LICENCE_EXPIRED`, and `isAvailableOffline()` resolved `true` instead of `false`. Fixed by
    adding the same `Number.isNaN(expiresAtMs)` fail-closed check directly at both comparison
    sites, not just at the ingestion gate. (`contentStore.ts`, 2026-08-12)

21. **`applyServerRecord` and `adoptPushResult` (`syncableTable.ts`) read-then-decide-then-write
    against SQLite without holding `withWriteLock`, unlike `saveLocal` — a genuinely concurrent
    local edit landing in that gap was silently clobbered by the pull/push-echo write.** Failure
    scenario: a background `syncManager.run()` pull calls `applyServerRecord(serverRecord)` for a
    row, reads the current row, and decides to overwrite because the incoming `updatedAt` is
    later. Before it performs the write, a genuinely independent local edit (e.g. the reader
    turning a page) commits immediately since neither function touched the shared write-lock
    queue; `applyServerRecord` then completes its write using the stale `existing` it already
    read, unconditionally overwriting the row with the server's data — the local edit is silently
    lost with no error and no outbox entry recreated for it. `adoptPushResult` (the push-echo path)
    has the identical shape. Reproduced with a real, non-nested concurrency test (a controlled gate
    plus a flushed macrotask tick, not a dependent nested `await`, to avoid the already-known/
    deliberately-not-fixed "nested lock calls deadlock" gap) — deterministically showed the
    server's data overwriting the local edit before the fix. Fixed by wrapping both functions'
    read-then-write body in the same `withWriteLock` that already protects `saveLocal`.
    (`syncableTable.ts`, 2026-08-12)

22. **`contentStore.ts`'s `store()` never invalidated the Keychain-cached raw BEK on a genuine
    re-download under a NEW `wrappedBek`** (key rotation or re-licensing — a real backend
    behavior per flambeau's contract, not hypothetical). `resolveRawKey()` prefers the cached raw
    BEK over ever re-unwrapping, by design, for performance — but nothing evicted that cache when
    a re-`store()` arrived with a genuinely different `wrappedBek`, so the OLD raw BEK kept being
    used to decrypt the NEW ciphertext forever, permanently surfacing as
    `ContentFailure(INTEGRITY_FAILED)` with no recovery path. Previously only escaped via
    `devContentSeed.ts`'s dev-only `destroy()`-before-`store()` workaround, which the real
    production caller (`downloadManager.ts`'s re-download path) never does. Comparing
    `keyFingerprint` was considered first and rejected — the test fixtures proved it identifies
    the DEVICE key used to wrap, not the BEK itself, so two different BEKs wrapped to the same
    device produce the SAME fingerprint and would miss a genuine rotation. Fixed by comparing
    `wrappedBek` directly: a mismatch against the previously-persisted value evicts the cached key
    before the new package is cached. (RSA-OAEP's randomized padding means `wrappedBek` can also
    legitimately differ across two wraps of the SAME BEK — a false-positive "rotation" — which
    just costs one harmless extra unwrap on the next read; a safe trade-off against ever missing a
    real one.) Regression-tested: a real re-download under a new key, with NO `destroy()` call,
    now decrypts the NEW content correctly on the first try. (`contentStore.ts`, 2026-08-13)

23. **`content-licence.ts` had no field for delivering a search index URL at all**, so
    `contentStore.ts`'s already-built, already-tested `decryptSearchIndex`/`getIndex` path was
    unreachable end-to-end outside unit tests and hand-built fixtures — `downloadManager.ts` had
    nowhere to get an index URL from, so `EncryptedPackage.index` could never be populated by a
    real download. Fixed against the REAL flambeau contract (`ReadingSessionResponse.index`,
    forwarding wokay's `IndexUrl` unchanged), not a guess: added `ContentLicenceIndexInfo`
    (`{url, encrypted, termCount?}`) and an optional `index?` field to `ContentLicenceResponse`,
    then wired `downloadManager.ts` to fetch it via the existing `fetchEncryptedAsset` helper and
    attach it to `EncryptedPackage.index`. A failed index fetch does NOT fail the whole download —
    matches `contentStore.ts`'s existing "an index-only integrity failure has no business making
    the book unreadable too" philosophy, extended from decrypt-time to fetch-time. Three new
    regression tests cover: index present & fetched, index present but fetch fails (book still
    downloads, no index), and no index on the licence (no third request is ever made).
    (`content-licence.ts`, `downloadManager.ts`, 2026-08-13)

24. **Test-only: `downloadManager.test.ts`'s new search-index tests tripped `BOOK_LIMIT_REACHED`
    against each other**, not against any product code. The file uses a real, un-reset SQLite
    `downloadTable` across every test; three new tests each storing a different book pushed the
    running total to the 5-book cap by the third one, which then failed for the wrong reason
    (pollution, not the "no index URL" behavior it was meant to test). Fixed by soft-deleting each
    test's `downloadTable` row in the block's own `afterEach`, matching how every other describe
    block in the file stays under the cap by construction. (`downloadManager.test.ts`, 2026-08-13)

25. **`aesGcm.ts`'s own internal base64 round trip, not native AES-GCM itself, was the dominant
    cost of every book decrypt** — confirmed by real on-device measurement against the real
    `samples/20mb_EPUB.epub` fixture (20,951,889 bytes), not assumption. `decrypt`/`encrypt` call
    the native `react-native-aes-gcm-crypto` module's string-only API, which means encoding the
    input and decoding the output through base64 on EVERY call. The plaintext-side decode already
    got the O(1)-lookup-table fix (bug list, base64.ts), but the ciphertext-side ENCODE — feeding
    the native module its input — still ran the original per-3-byte JS loop
    (`src/features/encryption/base64.ts`'s `bytesToBase64`), for the full ~20MB payload, on every
    single decrypt. `readerAssets.ts`'s own header already diagnosed this exactly: "~93% [of a warm
    open] is inside getBook, which base64-ENCODES the ciphertext and DECODES the plaintext around a
    string-only native module... it belongs to Encryption, not here" — Ahana had already fixed her
    OWN half of an identical problem (the WebView-transport encode) by swapping to
    `react-native-quick-base64` (native C++/JSI), measuring ~100x there. This bug is the same fix
    applied to the other half of that same round trip, inside `aesGcm.ts` itself: both `encrypt()`
    and `decryptBook()` now call `fromByteArray`/`toByteArray` from `react-native-quick-base64`
    instead of `./base64.ts`, for plaintext, ciphertext, AND the key (this file already requires a
    native module, so a second native dependency costs nothing architecturally; `./base64.ts`
    remains the correct portable fallback for callers that must not depend on one — unchanged,
    still used elsewhere).

    **Real, measured on-device impact** (warm open — decrypt/encode/render only, the cost paid on
    EVERY open of an already-downloaded book, not just the first):

    | | Android (Pixel 8 Pro emulator) | iOS (iPhone 17 Pro simulator) |
    |---|---|---|
    | `decrypt`, before | 4853ms | 3961ms |
    | `decrypt`, after | **382ms** | **134ms** |
    | Change | **−92.1%** (~12.7x faster) | **−96.6%** (~29.6x faster) |

    Total warm-open time (decrypt+encode+render) dropped from ~6.6s → ~1.5s (Android) and ~4.4s →
    ~0.5s (iOS). Correctness confirmed unchanged: `npx tsc --noEmit` clean, `npm run lint` clean,
    `npx jest --ci` — 34 suites, 305/305 tests including `aesGcm.test.ts`'s full round-trip/
    tamper-detection suite. Both platforms screenshot-confirmed rendering the real 20MB book
    correctly before and after. (`aesGcm.ts`, 2026-08-14)

### Investigated during the 2026-08-12 sweep, confirmed NOT bugs

Worth a brief note for a future reader so the same ground isn't re-covered from scratch:

- **`withWriteLock` (`syncableTable.ts`) genuinely deadlocks if a lock-guarded call is nested
  inside another lock-guarded callback** (confirmed with a standalone repro) — but no current call
  site in the app actually nests them, and the file's own doc comment already flags this exact
  risk. Not fixed; nothing to fix without a real call path.
- `base64.ts`'s codec round-trips exactly against Node's real `Buffer('base64')` for every length
  0–300 and a 5MB buffer, and throws correctly on genuinely invalid input.
- `config.ts`'s `resolveBackendHost()` correctly falls back to `'localhost'` for every
  empty/malformed `hostUri` shape tried (7 new scenarios).
- All six root `__mocks__/*.js` files were cross-checked against their real installed packages'
  current type-defs/source and still match faithfully — no drift.
- `app.json`'s omission of `expo-file-system`/`expo-system-ui` from the `plugins` array is
  confirmed harmless: Expo's CNG pipeline auto-applies autolinked native modules' config plugins
  regardless of the `plugins` array.

### Investigated during the second 2026-08-12 sweep (sql.js mock fidelity, encryption concurrency, sync concurrency, personalization deep-dive), confirmed NOT bugs

- The `expo-sqlite` mock's INTEGER columns are returned as plain numbers, `withTransactionAsync`
  genuinely rolls back every row of a multi-row write on a mid-callback throw (not just the last
  one), `getFirstAsync` returns `null` (not `undefined`) on no match, and `closeAsync` fails
  loudly (not silently) on subsequent calls — all already match real `expo-sqlite` behavior.
- Closing one book's session cannot corrupt a different, concurrently-decrypting book's in-flight
  buffer — `packageCache`/`sessions` are plain Maps keyed by `bookId` with no shared,
  non-bookId-keyed mutable state.
- No decrypted buffer or key material is cached/retained in an object that outlives `close()`
  beyond the already-documented, deliberately-deferred gaps (open-access `pkg.content` retention
  by design; the software RSA private key is re-read fresh from the keychain on every call, never
  cached).
- `sessions`/`packageCache` are never mutated across an `await` boundary outside the already-fixed
  bug #6 pattern, so there's no unguarded concurrent-Map-write window; a concurrent
  `decryptBook`+`decryptSearchIndex` pair for the same book merely redundantly re-unwraps the same
  BEK (wasted work, not a correctness or security bug).
- Rapid CREATE→UPDATE→UPDATE→DELETE on the same entity, all before ever syncing, coalesces
  correctly into a single DELETE outbox entry carrying the latest local snapshot.
- `adoptPushResult`'s equality check on the pushed timestamp is edit-count-agnostic — a row edited
  three times while its push is genuinely in flight is handled the same as a row edited once.
- No `withWriteLock` call site anywhere in `syncableTable.ts`/the singleton-row repositories awaits
  a network call inside its locked callback, so a hung request can never hold the local write lock
  forever.
- `InMemoryPrefsStore.freshDefaultPrefs()` deep-clones every nested `DEFAULT_PREFS` field correctly
  (bug #17's fix is complete and field-complete against the contract); `personalizationRepository`/
  `accessibilityRepository`'s own `defaults()` functions return only flat/primitive fields and
  structurally cannot alias state the same way.

## Open / known, not fixed

These are stated gaps, not oversights — each was found, evaluated, and deliberately deferred
rather than patched blind. Listed here so they're not lost, not because they're urgent.

- **No per-open access re-verification exists anywhere in this codebase.** Read team flambeau's
  real, published OpenAPI spec (2026-08-13 — see `flambeau-contract-comparison.md` for the full
  writeup) and confirmed the real backend re-checks entitlement on **every** `POST
  /api/v1/reading-sessions` call (~5 minute grant), specifically because "a subscription can
  lapse between [borrow and read]." We fetch a licence exactly once, at download time, and never
  ask again — a revoked subscription or expired institution licence has zero effect on a book
  already sitting on disk. Not fixed: the natural call site (re-verify when a *persisted* book is
  opened for reading) doesn't exist yet and crosses the Download/Reader ownership boundary — needs
  Ahana looped in before it's built, not a unilateral Download-side fix.
- **`content-licence.ts`'s shape doesn't match the real backend's `ReadingSessionResponse`** in
  several ways beyond the index field fixed in #23: no `sessionId`/`loanId`/`expiresAt`/
  `serverTime`, a flat `encryptedFileUrl` string instead of a structured signed-URL object with
  its own expiry, and a `checksum` field that has no real-backend counterpart at all (GCM's own
  tag already covers ciphertext integrity). See `flambeau-contract-comparison.md` for the full
  field-by-field comparison and merge recommendation — not acted on yet, pending a scope decision.
- **`device-key.ts`/`deviceKeyRegistration.ts` model an architecture the real backend doesn't
  have.** flambeau's spec is explicit: "No device registration. The device key arrives on every
  reading session, so a device is observed rather than enrolled." Our design assumes
  register-once-then-reference. `deviceKeyRegistration.ts` is confirmed unused anywhere in the app
  today, so this is a low-risk deletion once/if a reading-session-shaped client replaces
  `fetchContentLicence`.
- **No loan/borrow concept exists anywhere in this repo.** The real backend requires an active
  loan before a reading session succeeds (except open access); we have no object anywhere that
  models "this reader currently holds this title." Whether that belongs in CAP-7's scope at all,
  or in whichever capability owns CAP-4 (Borrow), is an open question this doesn't answer.

- **`close()` racing an in-flight `decryptBook()` (or `decryptSearchIndex()`).** Two calls to the
  SAME function racing each other is fixed (bug #6 above — shared `pending`/`indexPending`
  promise). `close()` itself racing that same pending promise is not: if `close()` runs while a
  decrypt for the same book is still awaiting the native decrypt, the pending call's buffer can
  resolve and get assigned to the buffer after the session is already torn down — unzeroed. Needs
  a liveness check on the session object
  post-await.
- **`contentStore.ts`'s persisted-metadata JSON is not itself integrity-checked.** A corrupted
  `*.meta.json` (disk error, manual tampering) throws a raw `JSON.parse`/type error out of
  `loadPersisted`/`isAvailableOffline`, not a clean `ContentFailure`. Ciphertext tampering IS
  caught (GCM tag, tested); metadata-file corruption is not.
- **`licence.signature` (RS256) is never verified anywhere.** Only `expiresAt` is checked. A
  `getBook`/`decryptBook` call that succeeds today does not mean the licence was
  cryptographically verified. Needs an RS256-verify library (same blocked-on-a-library-choice
  shape RSA-OAEP-256 was in, before `react-native-quick-crypto` resolved that one).
  Anti-rollback and online-rollover (the rest of Phase 6) are entirely unimplemented — no code
  exists, not even a stub.
- **`deviceKeypair.ts`'s RSA key is a software (JSI/C++) implementation, not hardware-backed**
  (no Secure Enclave/StrongBox). The private key PEM is JS-reachable during generation/unwrap and
  stored as a plain string in the OS keychain — same trust model already accepted for symmetric
  BEKs, but not a true non-exportable hardware key. Nothing has asked for that threat model yet.
- **Key rotation is undecided.** `generateDeviceKeypair()` is deliberately idempotent (never
  silently regenerates, to avoid orphaning already-wrapped BEKs) but there's no "rotate" path at
  all, and no owner decided for triggering one or re-wrapping existing BEKs to a new key.
- **Nothing confirmed on a physical device** — both `aesGcm`/`keyStorage` and `deviceKeypair`
  on-device confirmations are simulator/emulator only (iOS Simulator + Android emulator), never
  real hardware.
- **Heartbeat/WebSocket seat lifecycle (Phase 0.5, Phase 8) is deliberately deferred, not built.**
  `mock-backend/`'s `seat.js` has real join/leave logic but no heartbeat channel — the
  `heartbeat_timeout` scenario is unexercisable until Sync builds it.
- **Day-3 co-freeze with Ahana on `EncryptionDescriptor`/`SignedLicence` hasn't happened as an
  actual conversation** — the current field reconciliation is a reasoned first pass on Abhinav's
  side, not a confirmed agreement between both owners.
- **Phase 9.3's 25MB RAM budget is a placeholder, not a measured number** — needs a real figure
  once whole-file decrypt's actual memory footprint is measured against real book/audiobook
  sizes; already flagged in `BuildPlan.md`'s own amendment as possibly unrealistic long-term.
- **`decryptFile` vs `decrypt`+base64 for large files is an undecided tradeoff** (disk-write risk
  vs. bridge/memory cost) — every round trip confirmed so far has used small test payloads, not a
  realistic whole-book-sized one.
- **Filesystem write failures during `store()` (disk full, permission denied, a failed mid-write)
  escape as raw Node/fs `Error`s instead of the contract-mandated `ContentFailure`.**
  `content-provider.ts`'s header states the failure shape is frozen: "every method below rejects
  with `ContentFailure` (`errors.ts`), NOT a bare `ContentError` enum." Confirmed with a live
  exploratory test: mocking `File.prototype.write` to throw an ENOSPC-style error and calling
  `contentStore.store(pkg)` rejects with a raw `Error` (`code: 'ENOSPC'`, not instanceof
  `ContentFailure`) — reachable via disk-full/permission-denied during `writeFile()`'s
  create()/write()/delete() calls in `store()`, and equally reachable via
  `contentFile(bookId).bytesSync()`/meta-file read failures in `loadPersisted()`. Not fixed: none
  of the five frozen `ContentError` codes (`INTEGRITY_FAILED`, `DECRYPTION_FAILED`,
  `LICENCE_INVALID`, `LICENCE_EXPIRED`, `KEYSTORE_UNAVAILABLE`) cleanly describes a generic
  filesystem I/O failure, and `errors.ts` is co-owned/frozen with Reader (Ahana) — inventing a new
  code (e.g. `STORAGE_FAILED`) is a contract-taxonomy decision, not a minimal code fix. This is the
  same root cause as the metadata-integrity gap above, extended from the read side to the write
  path (`store()`) and to non-JSON-parse read failures (`bytesSync()` on a permission-denied or
  missing content file). Found by a dedicated adversarial testing pass, 2026-08-12; no test was
  added since asserting "rejects with SOME error" isn't a meaningful regression test and a specific
  code would require picking an unauthorized one.
- **Architecture question, not a bug: two independently-built, non-composing personalization
  stores exist with diverging default values for the same fields.** `prefsStore.ts` (in-memory,
  keyed to the frozen `SharedPrefs` contract) and `sync/repositories/personalizationRepository.ts`
  (SQLite, from a separately-merged `sync/frontend` prototype) never import each other or
  `shared/contracts`, and neither is wired into `App.tsx` — this reads as accidental duplication,
  not a designed layering. Their "first seed" defaults genuinely disagree (e.g. contract
  `DEFAULT_PREFS.typography = {size:16, lineHeight:1.5, margins:16}` vs. repository
  `defaults() = {typography_size:1.0, typography_line_height:1.0, typography_margins:0.0}`), so a
  device seeded through one path vs. the other starts with a different default text size,
  line-height, and margin. A bridge (`personalizationRow.ts`, mapping `SharedPrefs` <-> the SQLite
  columns) exists but is only ever called from its own test file — never wired to either store, so
  the "compose" story implied by the code comments is half-built and currently connects nothing.
  Flagging for a human to reconcile ownership and pick a source of truth (or finish wiring the
  existing adapter) rather than unilaterally refactoring/deleting either implementation. Found by a
  cross-module integration audit, 2026-08-12.
- **Architecture question, not a bug: the only accessibility-settings implementation that exists
  directly contradicts the frozen contract's explicit "no separate accessibility table/sync
  record" decision, and silently drops the contract's `screenReaderHints` field.**
  `src/features/accessibility/` is confirmed empty (only `.gitkeep`); `sync/repositories/
  accessibilityRepository.ts` (+ its own `accessibility` SQLite table, from the same
  separately-merged `sync/frontend` prototype) is the only accessibility storage anywhere in the
  repo, and it creates exactly the shape `shared/contracts/accessibility.ts`'s header and
  `prefs.ts`'s decision log say was SETTLED against ("No second accessibility store, no second
  endpoint... one prefs record per user carries all of this") — a fully independent syncable
  record with its own `id`/`updated_at`/`is_deleted`/`synced`, never embedded in a
  `SharedPrefs`-shaped record, never cross-referencing `shared/contracts` at all. Separately, its
  `AccessibilityRow` is missing the contract's 19th field, `screenReaderHints` (present nowhere in
  `schema.ts`, `types.ts`, `mappers.ts`, or `accessibilityRepository.ts`), which `prefs.ts`'s
  decision log explicitly calls out as an addition. This is a decision for the Sync and
  Accessibility owners to reconcile, not a unilateral code fix — reported as open rather than
  merged/deleted/refactored. Not previously documented anywhere in `BuildPlan.md`/`bugs.md`/
  `docs/build-status.md`/`progress.md`. Found by a cross-module integration audit, 2026-08-12.

- **`FLAG_SECURE` was never actually implemented, despite being documented as done.**
  `T4_Readme.md` lists it as a dependency and a comment in `src/features/reader/ReaderScreen.tsx`
  reads as though it's wired up ("Android has FLAG_SECURE (already a T4 dependency)") — but a
  dedicated security audit (2026-08-13) confirmed there is no `expo-screen-capture` or equivalent
  package in `package.json`, no config plugin, no `eas.json`, and no native call setting it
  anywhere in `src/`. What IS real: a JS-level `AppState` listener in `ReaderScreen.tsx` that
  renders an opaque cover on `inactive`/`background` — a working mitigation for the app-switcher
  snapshot case, but a DIFFERENT threat from what `FLAG_SECURE` covers (OS-level screen
  recording/screenshot APIs). Net: decrypted, licensed book content can currently be
  screen-recorded on Android with no OS-level block. This is Reader-owned territory
  (`ReaderScreen.tsx`) — flagging for Ahana, not fixing unilaterally.
- **No host/scheme allowlist on server-supplied asset URLs.** `contentLicenceClient.ts`'s
  `reachableAssetUrl()`/`fetchEncryptedAsset()` fetch whatever `encryptedFileUrl`/`index.url` a
  `ContentLicenceResponse` contains, completely unconditionally — the only logic present is a
  cosmetic `localhost`→LAN-host rewrite for the dev mock. There is no validation that these URLs
  point at an expected host (a CDN allowlist, same-origin-as-`API_BASE_URL`, or even an https-only
  restriction). Found by a dedicated security audit, 2026-08-13: a compromised backend, or a
  network MITM (dev traffic is plain HTTP by default — see `config.ts`), could point the device at
  an arbitrary host, and since `checksum` comes from the SAME response, a matching checksum+bad-URL
  pair isn't caught by the existing integrity check either. Bounded impact today (no reflection
  channel back to the attacker), but a real, previously-unflagged gap distinct from the
  already-documented "checksum is corruption-only, not tamper/MITM protection" finding.
- **The WebView's content-exfiltration defenses cover navigation, not subresource loads, and
  there is no CSP anywhere in `reader.template.html`.** `ReaderWebView.tsx`'s `originWhitelist`/
  `onShouldStartLoadWithRequest` intercept top-level navigation only — a chapter's
  `<img src="https://attacker.example/beacon">` or a CSS beacon would fire an unblocked outbound
  request today, found by a dedicated security audit, 2026-08-13. Script-driven exfiltration
  (dynamically reading page content and phoning it out) is currently blocked, but ONLY as an
  incidental side effect of epub.js's own default iframe sandbox (`sandbox="allow-same-origin"`,
  no `allow-scripts` unless `allowScriptedContent` is explicitly set — confirmed never set
  anywhere in this repo) — not a control this codebase deliberately added or documents. If
  `allowScriptedContent` is ever turned on (interactive EPUBs, annotations), full script-driven
  exfiltration becomes possible with zero compensating control. Worth an explicit tripwire, the
  same way `WEBVIEW_BRIDGE.md` treats its own triggers: add a CSP BEFORE ever setting
  `allowScriptedContent: true`, not after.
- **epubjs bundles a vulnerable `@xmldom/xmldom` (≤0.8.12, 5 CVEs — XML injection, uncontrolled
  recursion DoS) into the shipped `assets/reader/reader.html`, confirmed dead code in the current
  architecture.** Found via `npm audit` + follow-up code reading, 2026-08-13: `epubjs/lib/
  section.js` only falls back to this xmldom serializer `if (typeof XMLSerializer === "undefined"
  || isIE)` — both WKWebView and Android WebView provide a native `XMLSerializer`, so the
  vulnerable path never executes today. Real code sitting in a shipped asset regardless; would
  become live risk only if a future change forces the xmldom branch. Fix requires epubjs 0.4.2
  (semver-major). The rest of `npm audit`'s 21 reported entries are either the same 2 other root
  advisories (`image-size` via Metro, `uuid` via `expo prebuild`'s `xcode` dependency — both
  build-tooling-only, never shipped) or transitive listings of packages that merely depend on one
  of these three; none are independent findings.

## Future enhancement (not urgent, deliberately deferred), 2026-08-14

**Swap `aesGcm.ts`'s native AES-256-GCM library from `react-native-aes-gcm-crypto` to
`react-native-quick-crypto`.** Considered right after bug #25's base64-codec fix, as the next
possible lever on decrypt performance — evaluated and explicitly deferred, not forgotten.

Why it came up: bug #25 fixed the JS-side base64 codec, but `react-native-aes-gcm-crypto`'s API is
still string-only (`encrypt(plainText: string, ...)`), so every decrypt still round-trips a ~27MB
string through the native bridge, including a base64 decode/encode INSIDE the native module itself
that we can't see or optimize while staying on it. `react-native-quick-crypto` — already a
dependency in this app (RSA-OAEP-256 wrap/unwrap, CSPRNG `randomBytes`) — is JSI-based and can take/
return raw `ArrayBuffer`/`TypedArray` directly, eliminating that layer entirely. Also independently
relevant: `T4_Readme.md`'s own "OPEN RISK" section already flags `react-native-aes-gcm-crypto` as
unmaintained since 2022-07-20 with unverified New Architecture support — switching would retire
that standing risk too, not just chase speed.

**Why deferred:** decrypt is already down to 130–430ms after bug #25 (from ~4–5s), and WebView
render (380–1050ms, untouched by any of this) is now the dominant cost — so the realistic
additional win here is modest, not another order-of-magnitude jump. Against that limited upside,
the risk is real: this changes the actual crypto engine for whole-book content, not a codec around
it. It would need exact validation against `cipherLayout.ts`'s byte layout, confirmed backward
compatibility with already-persisted ciphertext (`samples/*.epub.enc` and anything already stored
on a tester's device — a mismatched output format could make existing offline books
undecryptable), and the same genuine on-device confirmation this whole project has required for
every crypto change so far, not just a green Jest run.

**Pros if ever done:** retires the unmaintained/New-Arch-unverified dependency; removes the
remaining hidden string round-trip (likely faster, unmeasured magnitude); consolidates onto one
crypto library already used elsewhere in this app instead of two; eventually lets
`react-native-aes-gcm-crypto` be dropped from `package.json` entirely (net dependency reduction, not
just a swap).

**Cons:** correctness-critical change to the whole-book decrypt path, not a slow-function fix;
quick-crypto integrations in this repo have already surfaced subtle bugs before (a keypair
generation race, missing BEK-length validation — see the Fixed list above) — not assumed bug-free
just because it's already in use elsewhere; real implementation + validation effort for a payoff
that's real but no longer the dominant cost.

**Verdict, as of this writing: not worth it right now.** Revisit if/when render time itself comes
down enough that decrypt becomes the dominant cost again, or if the New Architecture risk on
`react-native-aes-gcm-crypto` materializes for real (a broken build on some future RN/Expo upgrade,
forcing the migration under worse conditions than a planned one).

## Minor / environment notes (not app bugs), 2026-08-13

Found while running the merged `T4_Abhinav` (post-`dev_T4`) build on a real Android emulator and
iOS Simulator to confirm the app actually works, not just that static checks pass. Neither blocks
anything — both platforms fully rendered the reader with real decrypted content (screenshots
confirmed), no crashes, no regressions. Logged here as minor/environment, not as defects in the
app itself.

- **`expo run:ios`'s own CLI crashes on window activation in this sandboxed dev environment**,
  distinct from the previously-documented "Open in TF Reader?" trust-dialog landmine (same root
  cause — blocked AppleScript/System Events automation — but a different call site):
  ```
  Error: osascript -e tell app "System Events" to count processes whose name is "Simulator" or
  name is "DeviceHub" exited with non-zero code: 1
      at AppleDeviceManager.activateWindowAsync (@expo/cli/.../AppleDeviceManager.js:271:77)
  ```
  The native build itself succeeds (0 errors); only the CLI's post-launch window-focus step fails,
  and it takes Metro down with it since they're the same process. Workaround, confirmed working:
  restart Metro standalone (`npx expo start --dev-client --port <port>`) and launch the
  already-installed app directly with `xcrun simctl launch booted <bundle-id>`, bypassing the
  CLI's AppleScript step entirely. Purely a limitation of this sandboxed CLI environment — doesn't
  reproduce on a normal (non-sandboxed) Mac terminal, doesn't affect CI, doesn't affect the app.

- **`src/features/reader/readerTiming.ts`'s logged spans (`seed`/`decrypt`/`encode`/etc.) never
  appeared in device logs on either platform**, despite the pipeline they measure visibly
  completing (confirmed via screenshots on both). On iOS, even explicitly setting the
  `EXPO_PUBLIC_READER_TIMING` flag the instrumentation is gated behind and clearing the Metro
  cache produced nothing. Most likely an artifact of this sandbox's Metro↔device log-forwarding,
  not a real defect in the instrumentation — Ahana's own commit messages already cite exact
  numbers measured from this same instrumentation on her side (e.g. "~330ms... iPhone 17 Pro
  simulator" in `readerAssets.ts`'s header), so it clearly does work when run outside this
  particular constrained environment. Not chasing further without a non-sandboxed repro.

## Current verification status (2026-08-12)

After fixing bugs #9 and #10 above: **12 test suites, 113/113 tests pass**, `npm run typecheck`
clean, `npm run lint` (`--max-warnings=0`) clean, `npm run test:ci` (the exact command CI runs)
clean. No dependency resolution issues, no config-file inconsistencies found in a dedicated audit
of `package.json`, `eslint.config.js`, `tsconfig.json`, `app.json`, `.gitignore`,
`.github/workflows/ci.yml`, and all four `__mocks__/*.js` files.

After fixing bug #13 (the `jcenter()` patch) the same day: a real Android build from a clean
`npm install` — no manual `node_modules` edits — succeeds end-to-end (`BUILD SUCCESSFUL in 7m
31s`, real `app-debug.apk` produced). This was the last non-persisted fix in the project; every
fix in the "Fixed" list above now survives a fresh clone + `npm install` with no manual steps.

**Later the same day**, after a 4-agent adversarial testing sweep across encryption, sync,
personalization, and config/cross-cutting (fixing bugs #16–#18 above and surfacing the new open
item) was independently re-verified by a separate ground-truth check: `npx tsc --noEmit` clean
(exit 0, zero type errors), `npm run lint` (`--max-warnings=0`) clean (exit 0, zero
errors/warnings), and `npx jest` — **22 test suites, 215/215 tests pass** (exit 0). Jest emitted
one non-fatal informational message (`jest-haste-map: Watchman crawl failed. Retrying once with
node crawler.`) before falling back to the node crawler automatically; this did not affect any
test suite or test result. No regressions found relative to the pre-sweep state.

**Later still the same day**, a second sweep of 5 parallel adversarial testing agents (sql.js mock
fidelity, encryption concurrency/security, sync concurrency/security, a personalization
deep-dive, and a cross-module integration audit — fixing bugs #19–#21 above and surfacing the two
open architecture questions) was independently re-verified by a separate ground-truth check:
`npx tsc --noEmit` clean (exit 0, zero type errors), `npm run lint` (`--max-warnings=0`) clean
(exit 0, zero errors/warnings), and `npx jest` — **22 test suites, 227/227 tests pass** (exit 0).
Jest again emitted the same non-fatal Watchman-crawl-fallback informational message before
retrying with the node crawler automatically; this did not affect any suite or test result. No
regressions found relative to the pre-sweep state.

**2026-08-13, after the Download flow (Phase 3/4) landed and bugs #22–#24 above were fixed:**
`npx tsc --noEmit` clean (exit 0), `npm run lint` (`--max-warnings=0`, full repo) clean (exit 0),
`npx jest --ci` — **31 test suites, 282/282 tests pass** (exit 0). No regressions relative to the
pre-Download-flow state. This is the count to trust going forward; every earlier count in this
file predates `src/features/download/`'s tests entirely.
