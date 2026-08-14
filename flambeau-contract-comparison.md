# Our content-licence contract vs. flambeau's real API — comparison

Source for "real": https://deepu1004.github.io/flambeau-api-contracts/ (`flambeau-api.yaml`,
`POST /api/v1/reading-sessions`, marked `x-stability: FROZEN`). Source for "ours": the DRAFT
contract at `src/shared/contracts/content-licence.ts` + `src/features/download/contentLicenceClient.ts`
+ `src/features/download/downloadManager.ts`, all written against `mock-backend/`.

No code changed for this document. It's a decision aid, not a plan.

---

## 1. What each one actually is

The last two columns split the work: **We need to change** is on us regardless. **They need to
change** is a proposed ask for flambeau's team — worth raising now, while their contract still has
room to move, rather than after it locks.

| | Ours | flambeau's real one | We need to change | They need to change |
|---|---|---|---|---|
| Verb + path | `GET /books/:id/content-licence` | `POST /api/v1/reading-sessions` | Switch our client to call `POST /api/v1/reading-sessions` | No — endpoint already exists as specified |
| Called | once, at **download** time | once per **book open** (download OR read) | Add a call at **open** time, not just download time | Define what an open-time call should do with **no network** — "call on every open" doesn't say what happens reopening an already-downloaded book offline |
| Validity | none modeled — no expiry on the grant itself | ~5 minutes (`expiresAt` on the session) | Model `expiresAt`/`serverTime`; refresh before it lapses | Consider a longer-lived (or offline-tolerant) validity window for **reopening already-downloaded, already-verified** content — 5 minutes reads as tuned for a live streaming session, not "reopen a book I downloaded 3 days ago on a flight" |
| Re-checks entitlement? | No — fetched once, never re-verified | Yes, every single call, by design | Implement the missing re-check call (today: zero re-verification, ever) | None further — the mechanism already exists; contingent on the offline-reopen policy above getting resolved |

This last row is the real headline. flambeau's own doc comment says why:

> "Entitlement is re-checked rather than trusted from borrow time because a subscription can
> lapse between the two, and the second check is the only thing standing between a revoked
> institution and a decryption key."

We currently have **no equivalent of this at all**. Once `downloadBook()` succeeds, nothing in
this codebase ever asks the backend again "does this reader still have access?" — not on
re-open, not on a timer, not anywhere. A revoked subscription or an expired institution licence
would have zero effect on a book already sitting on disk. flambeau's design closes exactly that
gap, but only if something calls the endpoint at open-time, not just at download-time.

## 2. Request shape

**Ours** (`fetchContentLicence(bookId)`): no body, no query params beyond the path.

**Real** (`ReadingSessionRequest`):
```
itemId: string
format: Format
intent: Intent          // STREAM | DOWNLOAD
devicePublicKey: string // base64 of RAW bytes, not PEM/JWK
wantSearchIndex: boolean // default false — index is opt-in per call
```

Two things we're missing that matter:
- **`intent`**: the server enforces `canPersist` itself. `intent: DOWNLOAD` on an Elite
  (copy-limited) title is refused with `403 DOWNLOAD_NOT_PERMITTED`, *regardless of what the UI
  offered*. Today we only enforce `canPersist` client-side (`contentStore.ts` checks
  `licence.canPersist` before writing to disk) — the server never gets a chance to refuse the
  attempt itself, because we never tell it what we're about to do with the bytes.
- **`wantSearchIndex`**: real backend defaults this to `false` and omits `index` if not asked.
  Our client always wants it implicitly (per the comment I wrote in `content-licence.ts`:
  *"This client always asks"*) — functionally fine since we always want it, but there's no
  request-side field standing behind that assumption; it's just always-on from the mock.

## 3. Response shape

**Ours** (`ContentLicenceResponse`):
```
bookId, format, mimeType
encryptedFileUrl: string
checksum: string             // sha256 of the encrypted file — WE invented this
encryption: EncryptionDescriptor | null
licence: SignedLicence | null
index?: ContentLicenceIndexInfo
```

**Real** (`ReadingSessionResponse`):
```
sessionId, itemId, loanId?, expiresAt, serverTime
content: { url, expiresAt, cipherLength, originalLength, mimeType }   // SignedUrl, forwarded
index?: { url, encrypted, termCount }                                  // IndexUrl, forwarded
encryption?: EncryptionDescriptor-shaped                               // forwarded, absent for OA/audio
```

Differences that matter:

- **No `checksum` field exists anywhere in the real contract.** We added it ourselves and
  `downloadManager.ts` verifies it client-side before calling `store()`. The real design's
  integrity guarantee is the AES-GCM tag (checked at decrypt time) plus TLS in transit — not a
  separate SHA256. Our checksum step isn't *wrong*, but it's pure invention with no backend
  counterpart, and it protects against a threat (corrupted-in-transit ciphertext) that GCM's own
  tag already catches at decrypt time anyway.
- **`content` is a structured object, not a flat URL string.** The real one bundles
  `cipherLength`/`originalLength` directly on the grant. We currently *compute*
  `originalLength` ourselves from `cipherLength` (`computeOriginalLength()` in
  `downloadManager.ts`) — same numbers, but the real backend hands them to us instead of making
  us derive them. Low-risk either way; our derivation is correct today, just redundant with what
  the real response would already contain.
- **`sessionId` / `loanId` / `expiresAt` / `serverTime` have no equivalent in our shape at all.**
  These are the fields that make "verify access on every open" possible — `expiresAt` is what
  tells the client the grant (and by extension, the pre-fetched asset URL) has gone stale and
  needs a fresh call. We can't express "this grant is 5 minutes old, get a new one" today because
  nothing carries that timestamp.
- **`encryptedFileUrl` vs `content.url`+`content.expiresAt`**: ours is a bare string assumed
  durable; theirs is a signed URL with its own separate expiry (see the spec's example:
  `content.expiresAt` at `10:15:00Z` vs the *session's* `expiresAt` at `10:05:00Z` — two
  different clocks, the asset URL slightly outliving the session). We don't model asset-URL
  expiry distinctly from session expiry at all.

## 4. Device registration

**Ours**: `device-key.ts` (`DeviceKeyRegistrationRequest`/`Response`) models a one-time
`POST /device/register-key` call. `deviceKeyRegistration.ts` exists to make that call — and per
earlier findings in this session, is never actually invoked from anywhere in the app yet.

**Real**: flambeau's spec is explicit — *"No device registration. The device key arrives on
every reading session, so a device is observed rather than enrolled."* `devicePublicKey` rides
inside every `ReadingSessionRequest`; the device cap is enforced by fingerprinting whatever key
shows up, not by a prior enrollment call.

These are two different architectures, not a field-naming mismatch. Ours assumes
register-once-then-reference; theirs assumes present-every-time. `device-key.ts` and
`deviceKeyRegistration.ts` have no real-backend counterpart to converge toward — they'd need to
go away in favor of attaching `devicePublicKey` to whatever replaces `fetchContentLicence`.

## 5. Loans — a layer we don't have at all

Real reading-sessions require an *active loan* except for open access (`409 NO_ACTIVE_LOAN` if
missing) — borrowing (`POST /api/v1/loans`) is a separate, prerequisite step with its own
lifecycle (~2 weeks), entirely outside anything in `src/features/download/` today. We have no
loan concept anywhere in this codebase — `SignedLicence` (`content-provider.ts`, frozen) has
`expiresAt`/`canPersist`/`rights` but nothing that models "this reader currently holds this
title" as its own object with its own id. Whether that's in scope for CAP-7 at all, or belongs to
whichever capability owns CAP-4 (Borrow), is a real open question this comparison surfaces but
can't answer — it's outside `src/features/download/`'s current responsibilities as scoped in
`T4_Readme.md`.

## 6. Error taxonomy

**Ours** (`DownloadError`): `PERMISSION_DENIED`, `INSUFFICIENT_STORAGE`, `BOOK_LIMIT_REACHED`,
`LICENCE_FETCH_FAILED`, `ASSET_FETCH_FAILED`, `CHECKSUM_MISMATCH`, `BOOK_TOO_LARGE`,
`REGISTRATION_FAILED` — all device/client-side conditions, nothing about *why the server said no*.

**Real**: `NO_ENTITLEMENT`, `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_SUSPENDED`,
`INSTITUTION_INACTIVE`, `DEVICE_LIMIT_REACHED`, `DOWNLOAD_NOT_PERMITTED`, `NO_ACTIVE_LOAN`,
`CONTENT_NOT_READY`, plus generic 401 (`TOKEN_EXPIRED`) and 400 handling.

Ours and theirs are complementary, not overlapping — `LICENCE_FETCH_FAILED` today collapses every
possible server refusal into one generic code. A UI that wants to tell "your subscription
lapsed" apart from "storage is full" needs the real codes surfaced, not swallowed into one.

## 7. Where the two designs actually agree

Worth naming so it doesn't look like everything is wrong:

- `EncryptionDescriptor` (algorithm, layout, wrappedBek, wrapAlgorithm, keyId, keyFingerprint) —
  **already** taken verbatim from the real wire format per `content-provider.ts`'s own header
  ("Field names for the encryption/licence blocks are taken verbatim from the wokay
  source-of-truth"). This part needs no change.
- `devicePublicKey` as base64-of-raw-bytes (not PEM/JWK) — already how `deviceKeypair.ts` /
  `contentStore.ts` work.
- Carrying both `cipherLength` and `originalLength` redundantly, with an assert on store — our
  `EncryptedPackage` design (frozen, `content-provider.ts`) already does this defensively; the
  real grant just happens to hand both numbers over instead of requiring the client to compute
  one from the other.
- The whole-file (non-chunked) AES-256-GCM decrypt model, and Elite-never-persists — unaffected
  by any of the above; that's `ContentStore`/`contentStore.ts`, which this comparison doesn't
  touch.

## 8. Verdict

**Neither wins outright — they're solving different-shaped problems, and the fix is a merge, not
a replacement:**

1. **Adopt the real request/response shape**, since `content-licence.ts` is explicitly DRAFT and
   ours was a guess written before this spec existed. Concretely: model `intent`,
   `wantSearchIndex`, `sessionId`/`loanId`/`expiresAt`/`serverTime`, and `content` as a structured
   `SignedUrl`-shaped object instead of a flat `encryptedFileUrl` string. Drop `checksum` as a
   *required* field (GCM's tag already covers ciphertext integrity) — it can stay as an optional,
   defense-in-depth extra if the real backend ever adds one, but shouldn't be treated as load-bearing.

2. **Do adopt the per-open re-verification model**, but recognize it needs a call site that
   doesn't exist yet: something invoked when a *persisted* book is opened for reading, not only
   at download time. That's naturally either (a) a new function Download exposes
   (`verifyAccess(bookId, intent)` or similar) that Reader calls before `getBook()`, or (b) logic
   inside `contentStore.decryptBook()` itself. Either way it's a new integration point across the
   Download/Reader boundary, not a same-file fix — needs Ahana looped in before it's built, per
   the ownership rule in `CLAUDE.md`.

3. **Retire the device-registration model in favor of send-every-time.** `device-key.ts` and
   `deviceKeyRegistration.ts` model an architecture (register once, reference later) the real
   backend doesn't have. Since `deviceKeyRegistration.ts` is confirmed unused anywhere in the app
   today, this is a low-risk deletion once the reading-session-shaped client exists to carry
   `devicePublicKey` inline instead.

4. **Surface the real error codes** instead of collapsing every non-2xx into
   `LICENCE_FETCH_FAILED` — `DownloadError` needs the entitlement/loan/device-cap codes added so
   the UI can eventually tell them apart.

5. **Loans are the one piece with no current home.** Not a Download decision — flag it up rather
   than silently deciding CAP-7 does or doesn't need a loan concept.

Net: the real contract is the better long-term model (it's FROZEN, ours was a guess), but the
migration is bigger than a field rename — it changes when a network call happens (per-open, not
per-download), what happens if that call fails after a book is already offline (today: nothing;
should be: something), and removes a whole file (`deviceKeyRegistration.ts`) that has no
real-world counterpart.
