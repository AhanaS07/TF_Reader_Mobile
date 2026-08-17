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

### 1. `B1` 🔴 — there is no auth. At all.

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
token obtained through the real flow, and an expired token clears the keychain and re-authenticates
instead of surfacing as a generic download failure.

---

### 2. `B2` 🔴 — one base URL, and it should be `:8080`

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

### 3. `C7` 💬 — confirm the fingerprint recipe with wokay *before* integration week

`84f2476` closed `B3` properly: `downloadManager.ts:244` now sets `licence.keyFingerprint` from
`publicKeyFingerprint(publicKey)`, so `contentStore.ts:150`'s comparison finally compares two
independently derived values. Right fix.

The consequence nobody has closed: **that check fails closed, and the recipe is a guess.**
`publicKeyFingerprint()` chose SHA-256 over the **raw DER bytes**, a literal **`sha256:`** prefix,
and **full 64-char** hex. wokay's only example is `"sha256:d5e91261"` — eight hex characters, so a
truncated illustration that confirms none of the three. If any one differs,
`contentStore.store()` throws `LICENCE_INVALID` on **100% of encrypted downloads**, permanently.

Before `84f2476` a mismatch was structurally impossible, so this went from a documentation question
to a hard blocker in the same commit that fixed the security hole. Ask wokay: digest over the DER
bytes or over the base64 string? Is the prefix literally `sha256:`? What hex length?

**Cheap improvement while you're there:** the comparison currently happens inside
`contentStore.store()` — *after* `fetchEncryptedAsset` has pulled up to 25 MB.
`session.encryption.keyFingerprint` is available the instant `openReadingSession` returns.
Comparing there fails in milliseconds instead of after a full download, and gives you a
`DownloadError` at the right layer rather than a `ContentFailure` from Encryption.

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

### 7. `B15` 🟢 — a subscription audiobook would persist forever, unlicensed

Latent today (the reader is EPUB-only) but it follows directly from both contracts and is cheap to
guard. Both state audio is never encrypted — wokay: "A book is encrypted unless it is
`OPEN_ACCESS`, or unless it is audio", and `Encryption` is "null for open access and for all
audio."

`downloadManager.ts:257` keys persistence off encryption alone:

```ts
encryption: session.encryption ?? null,
licence: isEncrypted ? licence : null,   // isEncrypted === (session.encryption != null)
```

So a `SUBSCRIPTION`-tier **audio** title arrives with `encryption: null` → `licence: null` →
`contentStore` treats it as open access, persists it, and `isLicenceExpired()` short-circuits to
"not expired". It sits on the device permanently, outliving the subscription that entitled it.

**Fix:** derive persistence from `loan.canPersist` **and** `loan.licenceModel`, not from
`encryption != null`. `licenceModel === 'OPEN_ACCESS'` is the actual test for "no licence needed",
and you already have it on the `Loan`. Three lines now; a data-migration later.

Note that `84f2476` added an `AUDIO` row to `FORMAT_MIME_TYPES` (`downloadManager.ts:87`), which
makes the audio path *look* more supported than it is. Close this before anyone believes it.

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
| `C7` | wokay: fingerprint digest recipe | every encrypted download fails closed if we guessed wrong |
| `A10` | flambeau: `/loans/changes` vs `/changes` | `B6` gets built twice |
| `A9` | flambeau: does `OPEN_ACCESS` write a loan? | `downloadManager.ts` borrows unconditionally and reads `canPersist`/`dueAt` off the result — fine under the prose reading, broken under the table reading |
| `B11` | wokay: is there a maximum ingest size? | `MAX_DECRYPTED_BYTES` is 25 MB and no contract bounds book size, so an operator can publish a 40 MB book this client can never open, with no signal at either end |
| `C3` | nobody owns the catalogue client | `format` stays hardcoded `'EPUB'` (`B12`) |

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
