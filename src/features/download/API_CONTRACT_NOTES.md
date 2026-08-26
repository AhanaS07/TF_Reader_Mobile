# API_CONTRACT_NOTES.md — Download

**Owner: Abhinav. Status as of `83f4e2e` (2026-08-17).**

Everything in this directory that diverges from team **wokay**'s and team **flambeau**'s published
contracts, what breaks if it stays that way, and what to do instead. Nothing here has been changed
in your code — this is the list, not the fix.

**Read before** adding or changing any call in `readingSessionClient.ts` /
`contentLicenceClient.ts`, any `DownloadError` member, or anything in `downloadManager.ts`'s open
path. **Update in the same change** that closes an item, and strike it in
`src/shared/contracts/CONTRACT_ALIGNMENT.md` too.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence, every quote and mapping table: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`
- Finding IDs (`B1`, `C6`) are stable — quote them rather than restating the problem.

---

## What `84f2476` already fixed — do not redo these

| Thing | Where |
| --- | --- |
| `keyFingerprint` is now derived from the device key, not copied from the server (`B3`) | `downloadManager.ts:244` |
| ELITE/STREAM reads no longer write a downloads row or count against the 5-book limit | `downloadManager.ts:164`, `:272` |
| All four fetches have abort timeouts — 8s metadata, 60s asset body | `readingSessionClient.ts:33`, `contentLicenceClient.ts` |
| Absent `originalLength`/`mimeType` handled per the spec's "test for presence" convention | `downloadManager.ts:186-260` |
| `generateDeviceKeypair()` moved inside the fail-open try | `readingSessionClient.ts` |

---

## Ordered by what actually blocks you

### 1. `B1` 🟡 — narrowed 2026-08-23: real-backend calls now carry a bearer token, but this is not a sign-in flow

**Update 2026-08-23:** `readingSessionClient.ts` now attaches `Authorization: Bearer <token>` to
both flambeau calls when `AUTH_REQUIRED` (`config.ts`, i.e. `EXPO_PUBLIC_USE_REAL_BACKEND=true`).
The token comes from `devAuthToken.ts`, a thin cached client for the real backend's own dev-only
`POST /api/v1/auth/dev-token` (`tf_reader_backend_temp`'s `AuthController.java`) — confirmed live:
`POST /api/v1/reading-sessions` with this token returns `201`, not `401`.

**This closes the header-shaped half of `B1`, not the feature.** `devAuthToken.ts` is scaffolding
in the same spirit as `devContentSeed.ts` — it exists only because the real backend happens to ship
a dev shortcut, has no equivalent on the mock, and must be deleted once a real token source exists.
Steps 1–3 below (institution discovery, method selection, the actual SAML/OIDC round trip) are
still entirely unbuilt, and `C6` — how a native app receives the token after that round trip — is
still unanswered. Was, before this change:

`git grep -in "authorization\|bearer\|accessToken" -- src` returns **zero hits**. Both flambeau
calls send only `Content-Type`.

Every flambeau endpoint this app calls answers `401 UNAUTHENTICATED` without a `tf-app` bearer
token — `POST /api/v1/loans` and `POST /api/v1/reading-sessions` both document it explicitly. **The
entire download and read path returns 401 the moment it points at a real server.** It hasn't
surfaced only because `API_BASE_URL` points at an untracked mock that presumably requires no auth
(`B2`).

This is a whole feature, not a header:

1. Institution discovery — wokay `GET /api/v1/institutions` (+ `{id}` for branding / `catalogueUrl`).
2. Method selection — flambeau `GET /api/v1/auth/methods`.
3. `POST /api/v1/auth/saml/start` → open `authorizationUrl` in a system browser. The assertion is
   delivered to flambeau's ACS, **not** returned down the JSON call — flambeau is explicit that
   "no endpoint can both start SAML and hand back a token."
4. Secure token storage. `react-native-keychain` is already a dependency and already stores BEKs
   and the device private key, so the mechanism exists.
5. Session sliding — `GET /api/v1/auth/me` on resume, storing the returned fresh `token`. **One
   hour is an *idle* timeout**, so an app that never calls this signs the reader out mid-session.
6. `TOKEN_EXPIRED` handling — clear keychain, re-run sign-in. The code is already in
   `FlambeauErrorCode` and mapped to nothing (`B10`).

> **You cannot start step 3 yet.** `C6`: **neither contract documents how a native app receives
> the minted token after the browser round trip.** Deep link with a custom scheme? A one-time code
> exchanged at `/auth/me`? Polling on `authTxnId`? It can't be `authTxnId` — flambeau says that
> "is not a credential and proves nothing on its own." This is the single highest-value question
> in the whole review. **Ask flambeau before scheduling `B1`**, or you will build steps 1–2, hit a
> wall at 3, and have to redesign token storage around whatever answer arrives.

Also unresolved and blocking on the other side: `A5` — flambeau's app token **may not carry `aud`
at all** today, and wokay's filter chain rejects anything whose audience isn't `tf-app` on
`/api/v1/**` and `/opds/v1/**`. Until flambeau adds it, every token they mint is rejected on every
wokay feed.

**Boundary note:** this is CAP-6 territory. Who owns the app-side auth module needs a cross-team
decision before anyone writes code, not after.

**Done when:** a real `POST /api/v1/reading-sessions` succeeds against `:8080` with a `tf-app`
token obtained through the real flow (not `dev-token`), and an expired token clears the keychain
and re-authenticates instead of surfacing as a generic download failure.

---

### 2. `B2` 🟡 — one base URL, and it should be `:8080`

**Update 2026-08-23:** the app now points at the real backend by default in local dev —
`EXPO_PUBLIC_USE_REAL_BACKEND=true` is set in `.env` (gitignored). This flips `config.ts`'s
`API_BASE_URL` to `:8080`, but it is still a per-directory flag, not the cross-capability
unification this item actually asks for — Sync (`:9000`/`:8090`) is untouched. Narrower half
closed, not the item.

`config.ts:31` resolves to `http://<lan-host>:4000`, overridable by `EXPO_PUBLIC_MOCK_BACKEND_URL`.
Both contracts specify `http://localhost:8080` for everyone. Three coexist today:

| Consumer | Constant | Value |
| --- | --- | --- |
| Download / reading sessions | `download/config.ts:31` | `:4000` — mock backend |
| Sync CRUD | `sync/syncConfig.ts:40` | `:9000` — Mongo backend |
| Book file + pdf.js assets | `sync/syncConfig.ts:47` | `:8090` — "old Spring app" |
| **Both contracts** | — | **`:8080`** |

So "point the app at the real backend" is not a one-line change. Compounding it, the mock backend
itself (`mock-backend/server.js`, `routes/contentLicence.js`, `routes/deviceKey.js` — all cited in
tracked comments) is **not in the repo**, so nobody else can inspect or reproduce what this client
is currently shaped against.

**Fix:** one shared `EXPO_PUBLIC_API_BASE_URL` defaulting to `:8080`, and either commit the mock
backend or delete the references to it (`C8`).

**Pairs with `B13`** — do them together. `reachableAssetUrl()` (`contentLicenceClient.ts`) rewrites
a `localhost`/`127.0.0.1` asset URL's protocol, hostname **and port** to `API_BASE_URL`'s. Real
signed URLs (`https://storage.tf/...`) are correctly left alone, so the risk is narrow — but in a
fully-local stack, a content URL signed at `:8080` while `API_BASE_URL` is still `:4000` gets its
port silently rewritten and the fetch fails. Scope the rewrite to host only, or delete it once
there is one base URL.

**Done when:** `git grep -n "BASE_URL\s*=" -- src` shows one contract-facing constant, defaulting
to `:8080`, and `mock-backend/` is either tracked or unreferenced.

---

### 3. `C7` ✅ — CLOSED 2026-08-23, confirmed against the running real backend

See `encryption/API_CONTRACT_NOTES.md` §1 for the full evidence. Short version:
`publicKeyFingerprint()`'s guess (SHA-256 of raw DER bytes, literal `sha256:` prefix, full 64-char
hex) is exactly what the real backend computes, confirmed both by reading its source
(`ContentAccessGrantImpl.fingerprintOf()`) and by a live round trip. No code change needed here.

~~**The cheap improvement below is still open and still worth doing:** the comparison currently
happens inside `contentStore.store()` — *after* `fetchEncryptedAsset` has pulled up to 25 MB.~~
**Done 2026-08-25:** `licenseCheck.ts:166` compares `session.encryption.keyFingerprint` against the
device fingerprint the instant `openReadingSession` returns, before a single content byte is
requested, and raises a `DownloadError` at the right layer. Both Open and Download get it, since
they share that gate. `contentStore`'s own `assertLicenceMatchesPackage` still runs too — defence in
depth for direct `store()` callers such as `devContentSeed.ts`, which never pass through here.

---

### 3a. `B18` 🔴 — NEW 2026-08-23: the real backend has no `POST /api/v1/loans` at all

`licenseCheck.ts:91` calls `borrowLoan(bookId)` — `POST /api/v1/loans` — as step one of every real
download, per `B5` below. Against the running real backend this returns **`405`**, not a licence:
`tf_reader_backend_temp`'s `LoanController` (`loan/controller/`) implements only

```java
@GetMapping
public LoanPage list(@AuthenticationPrincipal CurrentUser caller, PageQuery page, ...)
```

with a comment saying, in full: *"No borrow/return endpoints: in the adopted design a licence is
created when a reading session opens (D-020), not by a call to this controller."* Confirmed live
with a valid bearer token — `POST /api/v1/reading-sessions` alone (no prior borrow call) succeeds
with `201` and returns a full `content`/`index`/`encryption` grant, including a `licenceId` field
(`loan_55c5cbc4` in the observed response) that the published `ReadingSessionResponse` schema does
not document at all (it documents `loanId`, not `licenceId`, and no `accessLevel`/`licenceModel`/
`canPersist` at the top level either — all four appeared in the live response).

**This is not this app's guess to fix.** `flambeau-api.yaml` still marks `POST /api/v1/loans`
**FROZEN**, so either the real backend has silently dropped a frozen endpoint (a bug, and the
published contract is now stale), or the design genuinely moved to "borrow happens implicitly at
session-open" (`D-020`) and the contract file just was never updated to match. Either way this
needs flambeau's ruling, not a client-side workaround — removing the `borrowLoan()` step here would
be reacting to one prototype's current behaviour, not to a decided contract.

**Ask:** is `POST /api/v1/loans` coming back, or is the borrow step gone for good? If gone, what
does `ReadingSessionResponse` actually look like now (`licenceId`/`accessLevel`/`licenceModel`/
`canPersist` need to be documented, and `B5`'s hold-queue/`NO_COPIES_AVAILABLE` handling needs to
know where copy-limit refusal now surfaces if not at borrow).

---

### 3b. `B19` 🟡 — NEW 2026-08-23: `GET /api/v1/auth/methods` doesn't exist on the real backend

Not this app's bug, and not blocking (the app doesn't call this endpoint yet — it's still on the
`B1` step-2 list). Recorded for whoever raises it with the backend team.

`flambeau-api.yaml` specifies `security: []` (public, no token) for `GET /api/v1/auth/methods`, but
`tf_reader_backend_temp`'s `AuthController.java` has no `/methods` mapping at all — only `/me`,
`/saml/start` and `/dev-token`. An unmapped path under `/api/v1/**` falls through Spring Security's
ordered filter chains to the final deny-all chain (`SecurityConfig.java`'s `@Order(100)`), which
returns `401 UNAUTHENTICATED`/`TOKEN_MISSING` instead of a `404`. Confirmed live — `saml/start` and
`oidc/start` (same controller, same "no token" contract requirement) both correctly return `200`
with no token, so this is specific to the missing `/methods` mapping, not a general auth
misconfiguration. Misleading error code aside, the practical effect is the same: sign-in method
discovery is unimplemented server-side.

---

### 4. `B5` / `B6` / `B7` 🟠 — the three that only make sense together

Do not close any one of these in isolation. Together they are "does this client have a correct
model of possession and revocation?" — and right now the answer is no in a way that leaks copies
and keeps revoked books readable.

#### `B5` — loans are borrowed and never returned

`downloadManager.ts` calls `borrowLoan(bookId)` as step one of every download, silently, with no
borrow UI anywhere in the app. That stand-in is documented and defensible. The missing half is not:

- `POST /api/v1/loans/{loanId}/return` is **typed** (`ReturnRequest`/`ReturnResponse` in
  `reading-session.ts`) and **never called**. `GET /api/v1/loans`, all four hold endpoints,
  `GET /api/v1/library` and `GET /api/v1/items/{id}/availability` are absent entirely.
- For ELITE (copy-limited) titles, every book this app opens takes a copy out of the institution's
  pool and never gives it back until the server's own sweep closes it at `dueAt`. flambeau's
  invariant isn't *violated* — the server still admits at most N — but **this is a copy-leaking
  client**. A reader who opens five Elite books holds five copies for two weeks.
- flambeau's return path is where **hold promotion** happens ("mark the loan RETURNED, release the
  lease, then promote the next waiter"). An app that never returns never promotes a queued reader.
- `NO_COPIES_AVAILABLE` (409) maps to nothing and falls through to a generic `LOAN_FAILED`, so
  "all copies are out, join the queue" surfaces as an unexplained download failure. flambeau
  designed that response to name the queue endpoint precisely so the app can offer it as a choice.

**Scope:** borrow/return/holds is **CAP-4**, not CAP-7. The right outcome is probably not "Download
builds a borrow UI." But borrow-with-no-return is worse than either owning it or not touching it.
**Minimum viable:** call `return` when the reader deletes a downloaded book, and surface
`NO_COPIES_AVAILABLE` distinctly. Flag the boundary at the Gate.

#### `B6` — the change feed is the designed revocation channel, and it's unimplemented

flambeau, twice, in its own words:

> A revocation is the reason this endpoint exists at all — it is the only way the app learns that a
> book it is showing has stopped being readable.

No change feed, no cursor, no `ChangeEntry` type anywhere. Note that **CAP-7 already has cursor
machinery** — `sync/syncEngine.ts`, `sync/stores/syncMetadataStore.ts` — pointed at a different
backend. The mechanism exists; the flambeau feed is unwired. This straddles your boundary with
Karthik; see `src/features/sync/API_CONTRACT_NOTES.md`.

**Resolve `A10` first** — flambeau has itself proposed moving this from `/api/v1/loans/changes` to
`/api/v1/changes`, because a hold event arriving on a loan-shaped path mislabels it. Decide before
implementing, or it gets built twice.

#### `B7` — fail-open is correct, and it is only safe once `B6` lands

`FAIL_CLOSED_CODES` covers five codes. Everything else — network failure, timeout, 500,
`NO_ACTIVE_LOAN`, `CONTENT_NOT_READY`, and since `84f2476` keychain failures too — logs a warning
and allows the read against already-persisted ciphertext.

**Both sides have a point, and the contract doesn't resolve it.** Failing closed on a network error
means a reader on a plane loses books already on their device — plainly wrong. Failing open means a
revoked institution's reader keeps reading offline indefinitely, which is exactly what flambeau
says the per-open check prevents:

> the second check is the only thing standing between a revoked institution and a decryption key.

**The resolution is `B6`.** Offline tolerance is safe *if* revocations arrive through the change
feed and are acted on — `ContentStore.destroy()` already exists and makes the ciphertext noise
instantly, offline, regardless of size. Fail-open **plus** no change feed is a hole. Fail-open
**plus** a change feed is a reasonable design. Ship them together.

`84f2476` widened the fail-open surface (correctly — a keychain hiccup turning into "I lost my
book" is the exact harm the policy exists to prevent), which makes pairing it with `B6` more
urgent, not less. **The accepted-risk record this needs still does not exist.** Write it at the
Gate.

**Open sub-item: `DEVICE_LIMIT_REACHED` is in `FAIL_CLOSED_CODES` but is not a revocation.** The
other four members mean "the server successfully told us this reader's access is gone." This one is
a **concurrency refusal** — the account is reading on too many devices right now. The function's own
doc comment still says it "REJECTS only for a genuine revocation", which is a shade generous.

The placement is defensible: it only fires when the server was actually reached and said no. But the
consequence is worth an explicit decision rather than inheriting it from a grouping — **a reader at
their device limit cannot open a book that is already downloaded and decryptable on this device.**
Nothing was revoked; they just have another session open elsewhere. Failing open here would be
equally defensible, and arguably better matches the policy's own stated purpose. Either way, say
which, and fix the doc comment to match.

Also worth knowing: `readerAssets.ts` calls `verifyReadingAccess` on **every book open**, and each
call runs `generateDeviceKeypair()` plus a full `POST /api/v1/reading-sessions`. On the contract's
terms that is correct — sessions are per-open by design — but each open costs a round trip and a
keychain read before any decrypt, and today it is a `STREAM`-intent session whose `content.url` is
signed, returned, and thrown away unused.

---

### 5. `B8` 🟠 — delete the device-registration path; flambeau rejects the concept

`shared/contracts/device-key.ts` defines `DeviceKeyRegistrationRequest`/`Response` for
`POST /device/register-key`, and `deviceKeyRegistration.ts` implements the call against the
port-4000 mock. flambeau closes the door on it explicitly:

> **No device registration.** The device key arrives on every reading session, so a device is
> **observed rather than enrolled**.

The endpoint does not exist and is not planned. Worse, its wire value is wrong on its own terms:
`deviceKeyRegistration.ts` base64-encodes the PEM's **ASCII text** — armour, newlines and all —
which is a different, non-interoperable value from the `publicKeyToRawBase64()` used on the real
path. That divergence is already noted in `deviceKeypair.ts`'s comments, so it is known dead code
shipping real crypto.

**Delete together:** `deviceKeyRegistration.ts`, `deviceKeyRegistration.test.ts`,
`shared/contracts/device-key.ts`, the `DownloadError.REGISTRATION_FAILED` member, and the
`device-key` export from the contracts barrel. Check nothing outside `download/` imports them
first. **Deleting a frozen-contract file needs the freeze conversation** — loop in Ahana;
`__typecheck__.ts` is the canary.

---

### 6. `B10` 🟡 — three error codes deserve promotion out of the generic fallback

The subset mapping is deliberate and mostly right: unmapped codes fall through to
`LOAN_FAILED`/`SESSION_FETCH_FAILED` with the real `FlambeauError` attached as `cause`, so nothing
is silently lost. Three are mapped as fallbacks where they should be actionable:

| Code | Why it needs its own member |
| --- | --- |
| `UNAUTHENTICATED` | the app must re-authenticate, not report "download failed" |
| `TOKEN_EXPIRED` | must clear the keychain — **this is the sole reason flambeau kept the code at all**, over wokay's objection (`A1`) |
| `NO_COPIES_AVAILABLE` | the user should be offered the hold queue (`B5`), not shown a generic error |

Separately, `INVALID_DEVICE_PUBLIC_KEY` (in `FlambeauErrorCode`) appears in **neither** contract —
wokay's prose says a short key "is rejected" but names no code. It is documented as unratified in
`reading-session.ts`; get it ratified or drop it. Do not branch on it meanwhile.

---

### 7. ~~`B15` 🟢 — a subscription audiobook would persist forever, unlicensed~~ ✅ CLOSED 2026-08-25

Both contracts state audio is never encrypted — wokay: "A book is encrypted unless it is
`OPEN_ACCESS`, or unless it is audio", and `Encryption` is "null for open access and for all
audio." (Still what the contracts SAY; the backend overrode it in practice on 2026-08-25 and audio
is now encrypted like every other format. That override does not resurrect this bug — the fix below
keys off the licence model, not off encryption — but it does mean the quoted rule can no longer be
relied on anywhere else.) `downloadManager.ts` used to key persistence off encryption alone
(`licence: isEncrypted ? licence : null`), so a `SUBSCRIPTION`-tier **audio** title arrived with
`encryption: null` → `licence: null` → `contentStore` treated it as open access and
`isLicenceExpired()` short-circuited to "not expired". It sat on the device permanently, outliving
the subscription that entitled it.

**Fixed** by deriving the licence from the licence model rather than from the encryption block:

```ts
const needsLicence = license.mode !== 'open-access';
...
licence: needsLicence ? licence : null,
```

`license.mode` comes from `checkLicense()`, which resolves it from the reading session's own
`licenceModel` — so "unencrypted" and "unlicensed" are now two different questions, which is the
distinction the entire audio tier turns on. The `needsLicence` line carries its own comment
explaining why it is deliberately **not** `isEncrypted`; leave it there, since the two tests look
interchangeable and are not.

The related worry logged here — that `84f2476`'s `AUDIO` row in `FORMAT_MIME_TYPES` made the audio
path look more supported than it was — goes with it. It now *is* that supported, on this axis. What
still bounds audio is size, not licensing: the 20 MB cap in `B11` is ~21 minutes of audio, which is
a deliberate prototype bound rather than a gap being worked on. See
`src/features/reader/audio/AUDIO_PLAYER_DECISION.md` Part 2 before assuming full-length audiobooks
are in scope.

---

### 8. `B16` 🟢 — two dangling citations left in this directory

`flambeau-contract-comparison.md` is cited with section numbers in `downloadManager.ts:37` and
`readingSessionClient.ts:157`. **It has never been committed to any branch of either repo.** The
two citations in `shared/contracts/` have been repointed at
`src/shared/contracts/CONTRACT_ALIGNMENT.md`; these two haven't, because they're your files.

Either commit the document or repoint them. Per `CLAUDE.md`'s comment rule — "do not let prose
describe a state the code has moved past" — a citation to a nonexistent file is exactly what
shouldn't survive review.

---

### 9. Highest-value single addition: a wire conformance test

No test in this repo asserts anything against wokay's or flambeau's published shapes.
`sync/contractConformance.test.ts` and `shared/contracts/__typecheck__.ts` guard the **internal**
freeze — what we believe, not what the server sends. `84f2476` grew the canary, which is good and
still isn't this.

A conformance test over flambeau's request/response shapes — built from the spec's own examples,
not from our types — would have caught `B4`, `B10` and `B14` before they shipped. Small, and the
best value-per-line on this list.

---

## Blocked on other teams — track, don't build

| # | Blocked on | Effect here |
| --- | --- | --- |
| `C6` | flambeau: how does the app get its token after SAML? | `B1` cannot be built |
| `A5` | flambeau: `aud: tf-app` on the app token | even a correct `B1` is rejected by wokay's filter chain |
| `B17` | wokay: fix the real backend's RSA-OAEP wrap (MGF1 defaults to SHA-1) | every encrypted download fails to unwrap its BEK, today |
| `B18` | flambeau: is `POST /api/v1/loans` coming back, or is borrow gone for good (`D-020`)? | `borrowLoan()` gets `405` on every real-backend call |
| `A10` | flambeau: `/loans/changes` vs `/changes` | `B6` gets built twice |
| `A9` | flambeau: does `OPEN_ACCESS` write a loan? | `downloadManager.ts` borrows unconditionally and reads `canPersist`/`dueAt` off the result — fine under the prose reading, broken under the table reading |
| `B11` | wokay: is there a maximum ingest size? | The client cap is per-format since 2026-08-25 — `maxDecryptedBytesFor()`: 25 MB EPUB/PDF, **20 MB AUDIO** (the OPDS team's agreed prototype storage limit). `downloadBook`/`openBook` size the chunked fetch from it and reject `BOOK_TOO_LARGE` before the body arrives. Neither number is in any contract, so an operator can still publish a 40 MB book this client can never open, with no signal at either end |
| `C3` | nobody owns the catalogue client | Reader now ROUTES `format` off the stored package (`B12`, Reader half closed), but nothing can tell it the true value — `downloadBook()`'s `format` parameter still defaults to `'EPUB'` with no caller supplying it |

---

## Do not "fix" these — they look wrong and are right

| # | Thing |
| --- | --- |
| `B_ok1` | `publicKeyToRawBase64()` — the 392-char output **is** base64 SPKI DER, matching wokay exactly. flambeau's "base64 of raw bytes" wording is the thing that's wrong (`A6`) |
| `B_ok2` | Offline licence expiry from `loan.dueAt`, never `ReadingSessionResponse.expiresAt`. Conflating them expires every offline book five minutes after download |
| `B_ok3` | `intent: loan.canPersist ? 'DOWNLOAD' : 'STREAM'`. Hardcoding `'DOWNLOAD'` fails every ELITE title with 403 |
| `B_ok4` | No checksum — the ciphertext-length cross-check is correct and better than a redundant SHA-256 |
| `B_ok5` | `SignedUrl`/`IndexUrl` mirror wokay field-for-field, including `termCount` that nothing reads yet |
| `B_ok6` | An index fetch failure does not fail the book |
| — | The separate 60s `ASSET_FETCH_TIMEOUT_MS`. Do not deduplicate it against the 8s metadata timeout — RN's `fetch` resolves only after the whole body arrives, so one shared value would cap a legitimate 25 MB download at >3 MB/s |
