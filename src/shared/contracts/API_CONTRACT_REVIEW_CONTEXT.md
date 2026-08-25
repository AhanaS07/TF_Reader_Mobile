# API contract review context — wokay + flambeau vs. `dev_T4`

**Purpose.** This is a briefing document for whoever reviews team **wokay**'s and team **flambeau**'s
published API contracts against what team **t4targaryen** (CAP-7 Reader & Offline) has actually
built. It exists so that review starts from evidence rather than from re-reading 196 pages of
Swagger output and 30-odd TypeScript files.

It is **not** a decision document. Every conflict below is stated with what each side says, where
the evidence is, what breaks if it is left alone, and whose call it is. Nothing here has been
changed in either repo.

---

## 0. How to use this document

| Section | What it gives you |
| --- | --- |
| §1 | Provenance — exactly which artefacts were compared, at which revision |
| §2 | The system as the two contracts describe it (needed to read anything else) |
| §3 | What `dev_T4` actually contains, and the structural mismatch with §2 |
| §4 | Surface coverage matrix — contract-defined vs. implemented |
| §5 | **Conflict register A** — the two contracts contradicting *each other* |
| §6 | **Conflict register B** — contracts vs. mobile implementation |
| §7 | **Conflict register C** — gaps: defined-not-built, built-not-defined |
| §8 | Field-level mapping tables (the reading-session / grant path in detail) |
| §9 | Verification checklist — what to actually run/read to confirm each item |
| §10 | Questions that need a cohort answer, grouped by owner |

Conflict IDs (`A1`, `B4`, …) are stable — quote them in review comments rather than restating.

---

## 1. Provenance

**Contract documents compared** (both are rendered Swagger-UI pages exported to PDF):

| Doc | Teams / caps | Source URL printed in the PDF | Version | Exported | Pages |
| --- | --- | --- | --- | --- | --- |
| `API Documentation.pdf` | **wokay** — Onboarding & Admin (CAP-1), OPDS Catalogue (CAP-5) | `abhishek-tf.github.io/tf_reader_backend_temp/api-docs/wokay-api.html` | 0.1.0, OAS 3.1 | 2026-08-14 07:57 | 154 |
| `flambeau_API Documentation.pdf` | **flambeau** — Authentication (CAP-6), Borrow & personal library (CAP-4), read broker | `deepu1004.github.io/flambeau-api-contracts/` | 0.1.0, OAS 3.1 | 2026-08-14 10:27 | 42 |

**Code compared:**

| Repo | Branch | HEAD at time of writing |
| --- | --- | --- |
| `TF_Reader_Mobile` | `origin/dev_T4` | `2bcb539` — *Merge PR #38 from /T4_Ahana* |
| `TF_Reader_Backend` | `origin/dev_T4` | `0455348` — *Merge pull request #2 from AhanaS07/karthik-features* |

**Caveat on the PDFs, which matters for two findings.** These are *rendered* Swagger pages, so
schema nodes that were collapsed in the browser (`Expand all`) exported without their field lists,
and long JSON examples are cut off at page boundaries. Where a finding below depends on a field
being genuinely absent rather than merely un-rendered, it is marked **[verify against YAML]** —
check `flambeau-api.yaml` / `wokay-api.yaml` directly before acting on it. Everything else is
sourced from prose or from an expanded schema and is safe to quote.

**Two things worth knowing before reading further:**

1. Per flambeau's own Stability section, only **`POST /api/v1/auth/saml/start`** and
   **`GET /api/v1/auth/me`** are implemented today. Every loan, reading-session, hold, library and
   ops endpoint is *"declared here and not yet implemented, which is deliberate — the contract is
   agreed before the code, not after."* The mobile code in §6 therefore cannot be
   integration-tested against flambeau at all right now; every conflict below is a
   read-the-contract finding, not a failing-request finding.
2. A document named **`flambeau-contract-comparison.md`** is cited four times in the mobile source
   (in `reading-session.ts`, `readingSessionClient.ts`, `downloadManager.ts`) as the place where
   several of these divergences were already recorded. **It has never been committed to any branch
   of either repo** (verified across `git rev-list --all`). If a reviewer has a local copy, it
   should be committed; if it does not exist, those comment references are dead and this document
   supersedes them. See `C8`.

---

## 2. The system as the two contracts describe it

Both documents describe **one Spring Boot application** containing every team's modules. This is
the single most important premise, because it means the wokay ⇄ flambeau boundary is **not HTTP**.

### 2.1 The Java seams (no HTTP, no token, no wire)

flambeau calls into wokay through two in-process interfaces:

| Interface | Question it answers |
| --- | --- |
| `catalogue.api.EntitlementQuery` | May this institution access this book, and on what terms |
| `content.api.ContentAccessGrant` | Give me the file link and the key for this book |

wokay documents the *data shapes* those calls pass (`ContentGrantRequest`, `SubjectRef`,
`LoanProof`, `ContentGrant`, `SignedUrl`, `IndexUrl`, `Encryption`) while stating they *"belong to
no path in this file and never will."*

flambeau publishes five interfaces of its own, so loan / reading / hold / library reach each other
without a package cycle:

| Interface | Package | Called by |
| --- | --- | --- |
| `ActiveLoanQuery` | `loan/api` | reading, library |
| `CopyLease` | `reading/api` | loan, hold |
| `HoldSnapshotQuery` | `hold/api` | library |
| `HoldPromotion` | `hold/api` | loan |
| `AvailabilityQuery` | `hold/api` | catalogue team |

### 2.2 Namespace split under one prefix

`/api/v1/**` is shared and split **by subtree, not by prefix**:

```
flambeau: /api/v1/auth/**   /api/v1/loans/**   /api/v1/reading-sessions
          /api/v1/holds/**  /api/v1/library    /api/v1/items/{id}/availability
          /api/v1/ops/**    (admin audience)
wokay:    /api/v1/institutions/**   /api/v1/catalogue/**
          /opds/v1/**               /api/admin/v1/**
```

Server for everyone, per both docs: **`http://localhost:8080`**.

### 2.3 Tokens

| | App token | Admin token |
| --- | --- | --- |
| Issued by | flambeau, at the end of the SAML/OIDC flow | wokay, `POST /api/admin/v1/auth/login` |
| `aud` | `tf-app` | `tf-admin` |
| Accepted on | `/api/v1/**`, `/opds/v1/**` | `/api/admin/v1/**` |
| Lifetime | 1 hour, **idle** timeout — slid by `GET /api/v1/auth/me` returning a fresh `token` | access 900 s + opaque refresh token, 43200 s |

There is no app-token refresh endpoint: an active reader slides its session by calling
`GET /api/v1/auth/me` on resume; an idle one is signed out. wokay's admin path is the only one with
a refresh token, and that token is **opaque, not a JWT**.

### 2.4 Tier vocabularies — there are three, not one

This is the root of several findings, so it is worth tabulating precisely.

| Layer | Enum name | Values |
| --- | --- | --- |
| wokay's own surface (feeds, book records, `?accessTier=`) | `AccessTier` | `OPEN_ACCESS`, `SUBSCRIPTION`, `ELITE` |
| The Java seam flambeau consumes | `catalogue.api.AccessLevel` | `OPEN_ACCESS`, `ENTITLED_UNLIMITED`, `ENTITLED_CONCURRENT` |
| Mobile, `src/shared/contracts/tier.ts` | `AccessTier` | `OA`, `Subscribed`, `Elite` |

wokay's doc asserts *"One vocabulary for the three tiers… There is nothing to translate."*
flambeau's doc answers directly: *"wokay's file says there is nothing to translate, which is true
inside their surface and false across the Java seam."* The mapping flambeau publishes:

| `EntitlementQuery` returns | wokay calls it | Loan written | Copy limit | Downloadable |
| --- | --- | --- | --- | --- |
| `OPEN_ACCESS` | `OPEN_ACCESS` | No | No | Yes |
| `ENTITLED_UNLIMITED` | `SUBSCRIPTION` | Yes | No | Yes |
| `ENTITLED_CONCURRENT` | `ELITE` | Yes | Yes, per institution | **No, online only** |

### 2.5 The loan / session distinction

Quoted because both documents call confusing it the most common mistake in the system:

> A loan is possession, and lasts about two weeks. A reading session is permission to fetch bytes
> right now, and lasts about five minutes. One loan produces many reading sessions.

Consequences the contracts draw from it: `POST /api/v1/reading-sessions` takes **no lease** (the
copy was consumed at borrow); it re-checks entitlement on **every** call; and the device cap is
applied there rather than at borrow, because the device key only arrives with a session request.

### 2.6 The invariant every write defends

> For a copy-limited title, the number of active loans never exceeds the number of licensed copies.

flambeau states this is enforced by a gating CI check (100 parallel borrowers on a 5-copy title
admit exactly 5) and that the ordering inside `POST /api/v1/loans` is non-negotiable: check
entitlement → check for existing loan → acquire lease atomically (copy-limited only) → write loan →
extend lease to due date.

---

## 3. What `dev_T4` actually contains

### 3.1 The mobile app

`TF_Reader_Mobile` on `dev_T4` is an Expo / React Native client organised by capability:

```
src/features/reader/          Ahana      — WebView + epub.js reader, in-book search UI, TTS seam
src/features/download/        Abhinav    — download pass, loan + reading-session clients
src/features/encryption/      Abhinav    — AES-GCM, RSA-OAEP device keypair, content store
src/features/search/          Vaishnavi  — in-BOOK index build + query (not catalogue search)
src/features/personalization/ Vaishnavi  — prefs
src/features/sync/            Karthik    — SQLite, outbox, sync engine, its own backend client
src/features/accessibility/   Hruthik    — (empty except .gitkeep)
src/shared/contracts/         Ahana      — the Week-1 frozen inter-capability contracts
```

The two contract documents touch **`download/`, `encryption/`, and `shared/contracts/`** only. The
reader, search, personalization and sync features consume the frozen internal contracts, not HTTP.

### 3.2 The backend repo does **not** contain the app the contracts describe

`TF_Reader_Backend` on `dev_T4` contains exactly one runnable application, and it is not wokay's or
flambeau's:

```
src/main/java/com/tfreader/modules/sync/backend/   ← Karthik's CAP-7 sync service
    controller/  Accessibility, Book, Bookmark, Download, Highlight,
                 Outbox, Personalization, Progress, Sync, SyncMetadata, ViewerAsset
src/main/java/com/tfreader/modules/{reader,search,download,encryption,personalization,accessibility}/
    → .gitkeep only, no code
src/main/java/com/tfreader/shared/contracts/  → .gitkeep only
```

**This is a structural mismatch with §2, and it is the first thing to establish in review.** Both
contract documents are premised on "one Spring Boot application with every team's modules inside
it." CAP-7's sync service is a *separate* Spring Boot application, on its own ports, with its own
route vocabulary (`/api/{entity}` CRUD plus `POST /api/sync/push`, `GET /api/sync/pull`,
`GET /api/sync/entity-types`), and it is not mentioned in either contract. Concretely:

- **The mobile sync client and the tracked backend do not agree on their own prefix**, and one of the
  two collides with §2.2. The tracked service maps `@RequestMapping("/api/progress")`,
  `/api/bookmarks`, `/api/highlights`, `/api/personalization`, `/api/accessibility`,
  `/api/downloads`, `/api/outbox`, `/api/sync`, `/api/sync-metadata` — i.e. **`/api/*`, outside the
  contested `/api/v1/**` space.** But `src/features/sync/syncApi.ts:180` builds every URL as
  `` `${API_V1}/${entityPath}` `` → **`/api/v1/{entity}`**, against a *different, untracked* "Mongo
  backend" on port 9000 (`syncConfig.ts:43`). So the client claims `/api/v1/progress` and friends,
  which **are** unallocated subtree claims under §2.2, while the backend in this repo does not.
  See `C1`.
- **Neither contract defines any sync, progress, annotation or personalization surface at all.** The
  entire CAP-7 sync wire format is uncontracted. That is not a conflict; it is a hole in the cohort's
  contract coverage, and it belongs on the Contracts Gate agenda — see `C2`.

### 3.3 Three different base URLs, none of them `:8080`

| Consumer | Constant | Value |
| --- | --- | --- |
| Download / reading sessions | `src/features/download/config.ts:31` | `http://<lan-host>:4000` — "mock backend" |
| Sync CRUD | `src/features/sync/syncConfig.ts:40` | `http://<lan-host>:9000` — Mongo backend |
| Book file + pdf.js assets | `src/features/sync/syncConfig.ts:47` | `http://<lan-host>:8090` — "old Spring app" |
| **Both contracts** | — | **`http://localhost:8080`** |

The mock backend that `config.ts` points at (`mock-backend/server.js`,
`mock-backend/routes/contentLicence.js`, `mock-backend/routes/deviceKey.js`, all referenced in code
comments) is **not tracked in the repo**. A reviewer cannot inspect what the client is currently
being shaped against.

---

## 4. Surface coverage matrix

Legend: ✅ implemented · 🟡 typed but not called · ❌ not present · n/a not the app's concern

### 4.1 flambeau surfaces

| Endpoint | Stability | Mobile status | Where |
| --- | --- | --- | --- |
| `GET /api/v1/auth/methods` | declared | ❌ | — |
| `POST /api/v1/auth/saml/start` | **built** | ❌ | — |
| `POST /api/v1/auth/oidc/start` | declared | ❌ | — |
| `GET /api/v1/auth/me` | **built** | ❌ | — |
| `POST /api/v1/loans` | declared | ✅ | `readingSessionClient.ts:67` |
| `GET /api/v1/loans` | declared | ❌ (`LoanPage` typed) | `reading-session.ts:135` |
| `POST /api/v1/loans/{id}/return` | declared | ❌ (`ReturnRequest`/`ReturnResponse` typed) | `reading-session.ts:143,149` |
| `POST /api/v1/reading-sessions` | declared | ✅ | `readingSessionClient.ts:104` |
| `POST /api/v1/holds` | declared | ❌ | — |
| `GET /api/v1/holds` | declared | ❌ | — |
| `DELETE /api/v1/holds/{id}` | declared | ❌ | — |
| `POST /api/v1/holds/{id}/accept` | declared | ❌ | — |
| `GET /api/v1/items/{id}/availability` | declared | ❌ | — |
| `GET /api/v1/loans/changes` | declared | ❌ | — **see `B10`, this one matters** |
| `GET /api/v1/library` | declared | ❌ | — |
| `POST /api/v1/ops/reconcile` | declared | n/a (admin audience) | — |

### 4.2 wokay surfaces

| Endpoint | Mobile status |
| --- | --- |
| `GET /api/v1/institutions` | ❌ |
| `GET /api/v1/institutions/{id}` | ❌ |
| `GET /opds/v1/institutions/{id}/catalogue` | ❌ |
| `GET /opds/v1/institutions/{id}/groups/{groupId}` | ❌ |
| `GET /opds/v1/institutions/{id}/search` | ❌ |
| `GET /opds/v1/institutions/{id}/publications/{itemId}` | ❌ |
| `GET /opds/v1/public/catalogue` | ❌ |
| `GET /opds/v1/public/search` | ❌ |
| `GET /opds/v1/public/publications/{itemId}` | ❌ |
| `POST /api/v1/catalogue/items:batch` | ❌ |
| `/api/admin/v1/**` (36 endpoints) | n/a — admin console, not the app |

**There is no OPDS or catalogue client anywhere in the mobile app.** No feed parser, no institution
picker, no `items:batch` call. `src/features/search/` is *in-book* full-text search over a decrypted
per-book index — it is not catalogue search and does not touch either contract. The reader gets its
`bookId` from `devContentSeed.ts`'s `DEV_SAMPLE_BOOK_ID` constant, mounted directly in `App.tsx`.

### 4.3 The Java seam shapes, as mirrored in mobile TypeScript

| wokay schema | Mobile mirror | Fidelity |
| --- | --- | --- |
| `SignedUrl` | `reading-session.ts:68` `SignedUrl` | field-for-field ✅ |
| `IndexUrl` | `reading-session.ts:80` `IndexUrl` | field-for-field ✅ |
| `Encryption` | `content-provider.ts:25` `EncryptionDescriptor` | ⚠️ `keyId` optionality differs — `A7` |
| `ContentGrantRequest` | `reading-session.ts:53` `ReadingSessionRequest` | ⚠️ see `A6`, `A8` |
| `ContentGrant` | `reading-session.ts:86` `ReadingSessionResponse` | ✅ plus flambeau's session fields |
| `Error` / `ErrorCode` | `reading-session.ts:170,192` | ⚠️ enum diverges from **both** — `A4`, `B6` |
| — (**no counterpart**) | `content-provider.ts:37` `SignedLicence` | ❌ invented — `B5` |

---

## 5. Conflict register A — the two contracts contradicting each other

These are for the cohort / Contracts Gate, not for CAP-7 to fix. They are listed first because
several `B` findings cannot be resolved until these are.

---

### A1 — `ErrorCode` is claimed to be one shared Java enum, and the two documents give it different members

**Severity: high.** This is the cleanest hard contradiction in the two documents.

Both docs claim the same single enum. wokay: *"Every error in the system uses this shape."*
flambeau: *"One `ErrorCode` enum, in `common/error`, shared by every module. We add no second error
shape."*

wokay's published enum has exactly 11 members:

```
UNAUTHENTICATED · FORBIDDEN_SCOPE · FORBIDDEN_INSTITUTION_MISMATCH · NO_ENTITLEMENT
CONTENT_NOT_READY · DOWNLOAD_NOT_PERMITTED · NOT_FOUND · CODE_TAKEN · TOO_MANY_IDS
VALIDATION_FAILED · STALE_VERSION
```

…and goes out of its way to exclude two of the values flambeau requires:

> There is no `TOKEN_EXPIRED`: an expired token and a forged one both answer `UNAUTHENTICATED`…
> There is no `INSTITUTION_INACTIVE` either, because an inactive institution answers `NOT_FOUND` so
> its existence is not disclosed.

flambeau needs both. It lists `INSTITUTION_INACTIVE` as one of six codes arriving straight from
`DenyReason` on the entitlement check, and it keeps `TOKEN_EXPIRED` deliberately:

> `TOKEN_EXPIRED` survives that argument only because the app must know to clear its keychain.

flambeau additionally declares five members absent from wokay's enum and flags them as needing
ratification: `NO_COPIES_AVAILABLE`, `NO_ACTIVE_LOAN`, `LOAN_NOT_ACTIVE`, `DEVICE_LIMIT_REACHED`,
`OFFER_EXPIRED` — plus `ENTITLEMENT_EXPIRED` and `ENTITLEMENT_SUSPENDED` from `DenyReason`.

**Net:** the shared enum needs **at least 8 members wokay's published version does not have**, and
wokay's stated security rationale for excluding two of them directly opposes flambeau's stated
product rationale for needing them.

**Impact.** One enum cannot satisfy both documents. Whichever way it resolves, a client's exhaustive
`switch` is wrong on one side. Mobile has already picked a side — see `B6`.

**Owner:** wokay + flambeau jointly, at the Contracts Gate. **Recommendation:** the union, with
wokay's non-disclosure concern handled at the *raise site* (an inactive institution answers
`NOT_FOUND` on wokay's paths; `INSTITUTION_INACTIVE` remains available to flambeau's entitlement
path) rather than by deleting members from a shared enum.

---

### A2 — wokay says institutional sign-in is SAML-only; flambeau ships an OIDC path

**Severity: high.**

wokay's `SignIn` schema:

> `method*` — Always `SAML`. Institutional sign in has no other mode. `Enum: #0="SAML"`

and on `GET /api/v1/institutions/{institutionId}`:

> `signIn.method` is always `SAML`. It stays in the payload so the client needs no special case, but
> there is no field on the institution record to configure.

flambeau contradicts this on three separate surfaces:

- `GET /api/v1/auth/methods` returns a `methods` array whose example contains **both** `SAML` and
  `OIDC`, *"so the app renders one button or two rather than guessing"*;
- `POST /api/v1/auth/oidc/start` exists as a first-class endpoint with its own `state`/RelayState
  equivalence note;
- flambeau's `SignInMethod` schema is a multi-value enum.

**Impact.** wokay owns the institution record and says there is no field to store a method on;
flambeau's `/auth/methods` must read that decision from somewhere. Today the two answers to "how
does this institution sign in?" can disagree, and the app has two mutually exclusive
sources of truth for whether to render one button or two.

**Owner:** wokay (institution record) + flambeau (auth). **Needs:** either a real
`signIn.methods[]` field on wokay's institution record, or flambeau's `/auth/methods` documented as
returning a constant.

---

### A3 — `idpHint`: wokay expects it to be honoured, flambeau declares it deliberately ignored

**Severity: medium.**

wokay defines it, twice, as an instruction to flambeau:

> `idpHint` — Which mock identity provider **flambeau should use** for this institution.

flambeau declines:

> `idpHint` is accepted because the contract defines it, and is **deliberately unused**: we run one
> SAML integration for every institution, so nothing about the request selects an identity provider.

**Impact.** An operator can set `signIn.idpHint` in the admin console (wokay's
`PUT /api/admin/v1/institutions/{id}` accepts `SignInWrite.idpHint`), see it saved, and have it
change nothing. That is a silent no-op configuration field — the exact failure mode wokay's own
`SignInWrite` comment warns about ("the kind of mismatch that makes an operator think their save
failed").

**Owner:** flambeau to honour it, or wokay to remove it from the write shape and mark it read-only /
informational.

---

### A4 — `DOWNLOAD_NOT_PERMITTED`: 403 in both PDFs, 422 in a third flambeau document

**Severity: low-medium** (already flagged by flambeau, listed here so it is not lost).

flambeau raises this itself:

> One is a live disagreement. `DOWNLOAD_NOT_PERMITTED` is 403 here because wokay's file has it
> frozen at 403; our own reference says 422. Same rule, two status codes, and it is raised on our
> endpoint using their code. It needs one answer.

**Both PDFs supplied here say 403.** The 422 lives in flambeau's "API Reference", which was not
provided. **Mobile is unaffected** — `readingSessionClient.ts` branches on the `code` in the error
envelope, never on the HTTP status, so either answer works client-side today. Resolve it, but it is
not blocking.

---

### A5 — Two token audiences, or three? And does flambeau's app token carry `aud` at all?

**Severity: high** — this one breaks integration on day one of real auth.

wokay states the rule as absolute:

> **Two token audiences and no third.** … Checked on every request. An admin token cannot read a
> catalogue feed and an app token cannot reach the admin API.

flambeau raises two open items against exactly that sentence:

> wokay's file says "two token audiences and no third", but a third, **`tf-refresh`, exists on the
> admin authentication branch**. And **our own token does not yet carry `aud` at all**, so the
> separation above is currently documentation rather than enforcement.

**Impact, spelled out.** wokay's filter chain rejects a token whose audience is not `tf-app` on
`/opds/v1/**` and `/api/v1/**`. flambeau mints the app token and says it currently has no `aud`
claim. So the moment wokay's audience check is enforced, **every app token flambeau issues is
rejected on every wokay feed** — the whole catalogue becomes unreachable to the app.

Note also that a `tf-refresh` **JWT audience** is hard to reconcile with wokay's own published
admin refresh design, which says the refresh token is *"Opaque, not a JWT. Nothing is encoded in it,
so there is nothing to read out of it"* and lives hashed in `adminSessions`. An opaque random string
has no `aud`. So either the branch flambeau is describing diverges from wokay's published
`TokenPair`, or "audience" is being used loosely there.

**Owner:** flambeau (add `aud: tf-app` when minting) + wokay (confirm what the admin branch actually
issues). **Verify:** decode a token from the SAML flow and check for `aud`; grep the admin auth
branch for `tf-refresh`.

---

### A6 — `devicePublicKey` encoding: "Base64 SPKI DER" vs "base64 of raw bytes"

**Severity: medium** — under-specification rather than outright contradiction, but it is the field
that silently breaks decryption if the two sides read it differently.

wokay is precise:

> `devicePublicKey` — **Base64 SPKI DER, 392 characters for RSA-2048.** RSA-2048 is the minimum and
> a shorter key is rejected.

flambeau is looser, and says what it is *not* rather than what it is:

> `devicePublicKey` is **base64 of raw bytes**, not a PEM and not a JSON web key. It is passed to
> `ContentAccessGrant` as bytes…

"Raw bytes" and "SPKI DER" are not the same statement — SPKI DER is a structured `AlgorithmIdentifier
+ BIT STRING` wrapper, not the bare modulus/exponent that "raw" suggests. flambeau's own example
value (`"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A"`) *begins* with the standard base64 prefix of an RSA-2048
SPKI DER, so the intent is almost certainly wokay's reading — but the example is 32 characters, not
392, so it is a truncated placeholder and cannot be used to settle the question.

**Mobile happens to be correct here** — see `B_ok1` in §6.6. Resolve the wording anyway, because
flambeau is the surface app developers read and "raw bytes" invites a wrong implementation.

**Owner:** flambeau, to restate as "Base64 SPKI DER (the body of a PEM public key, armour and
newlines stripped), 392 characters for RSA-2048."

---

### A7 — `Encryption.keyId` and `keyFingerprint`: required, optional, or forwarded-and-truncated?

**Severity: medium. [verify against YAML]**

wokay's `Encryption` schema marks:

| Field | wokay |
| --- | --- |
| `algorithm` | required, enum `AES-256-GCM` |
| `layout` | required, enum `nonce(12) \|\| ciphertext \|\| tag(16)` |
| `wrappedBek` | required |
| `wrapAlgorithm` | required, enum `RSA-OAEP-256` |
| `keyId` | **optional** — *"Which master key wrapped it. Exists so a second one can be added later."* |
| `keyFingerprint` | **required**, with a mandate quoted in `B4` below |

flambeau states it forwards this block *"field for field. No renaming, no re-serialising through a
naming strategy, no logging, no caching"* — so wokay's schema should be authoritative. But
flambeau's rendered `201` example for `POST /api/v1/reading-sessions` shows only four of the six
fields, cut off at the page break immediately after `"wrapAlgorithm":"RSA-OAEP-256"`.

**This is very likely a page-boundary truncation, not a real omission** — but it needs confirming,
because if flambeau's example is what an app developer copies, they will build a client that never
sees `keyFingerprint`, and `keyFingerprint` is the field carrying wokay's only anti-key-substitution
guarantee. Mobile has this wrong in a different way — see `A7`'s partner finding `B3`.

**Owner:** flambeau, to publish the full example. **Action for the reviewer:** open
`flambeau-api.yaml`, expand `ReadingSessionResponse.encryption`, confirm all six fields.

---

### A8 — `wantSearchIndex` default: `true` (wokay) vs unstated (flambeau) vs "false" (mobile comment)

**Severity: low.**

wokay's `ContentGrantRequest.wantSearchIndex` carries an explicit **`Default=true`**, with the
rationale *"Set false to skip signing an index URL. Saves a signature when the caller only wants to
stream."*

flambeau's `ReadingSessionRequest.wantSearchIndex` is optional with no default stated in the
rendered schema. Mobile's `reading-session.ts:63` asserts *"Default false on the real backend"* — a
comment that contradicts wokay's published default and has no source in flambeau's document either.

**Impact: none functionally**, because mobile always sends the field explicitly (`true` for
downloads, `false` for the per-open re-check). The comment is simply wrong and will mislead the next
reader. Fix the comment (`B14`) and have flambeau state the default (`A8`).

---

### A9 — Does borrowing an `OPEN_ACCESS` title write a loan? flambeau says both

**Severity: low** (internal to flambeau, but it changes the mobile download path).

flambeau's tier table says `OPEN_ACCESS` → **Loan written: No**. Its `POST /api/v1/loans` prose says:

> `OPEN_ACCESS` needs no loan. Borrowing one is not an error and not a no-op — it returns **201 with
> a loan** carrying `licenceModel: OPEN_ACCESS` and no due date, so the app has one shelf rather
> than two.

A 201 with a `Loan` body that has a `loanId` is hard to square with "no loan written" unless the
object is synthesised per-request. wokay's side of the seam expects `ContentGrantRequest.loan` to be
**null** for open access (*"loan and devicePublicKey are both null for open access, and both required
for anything else"*), so a synthesised loan must not be forwarded across the seam.

**Impact on mobile:** `downloadManager.ts:146` borrows unconditionally before every download,
including for open-access titles, and then reads `loan.canPersist` and `loan.dueAt` off the result.
That works under the prose reading and breaks under the table reading. Clarify which is normative.

---

### A10 — `/api/v1/loans/changes` is on a loan-shaped path but carries hold and entitlement events

**Severity: low** (flambeau raises it itself; recorded so the app's sync design doesn't get built
twice).

> **Proposed:** move this to `GET /api/v1/changes`. It sits under `/loans` in both our API Reference
> and wokay's file, which mislabels it and means a hold event arrives on a loan-shaped path. Kept
> here for now because their reference to `/api/v1/loans/changes` is already written down.

Decide before the app implements it (`B10`), not after.

---

## 6. Conflict register B — contracts vs. mobile implementation

Ownership note per `CLAUDE.md`: everything in this section lives in `src/features/download/`,
`src/features/encryption/` or `src/shared/contracts/` and is **Abhinav's** to change, except
`B12`/`B13` (`readerAssets.ts`, Ahana) and `B15`/`B16` (`shared/contracts/`, Ahana as lead).

---

### B1 — 🔴 No `Authorization` header is sent on any call. No token is ever obtained.

**Severity: critical — nothing works against the real backend.**

Both flambeau calls send only a content type:

```ts
// src/features/download/readingSessionClient.ts:72
response = await fetch(`${API_BASE_URL}/api/v1/loans`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },   // ← no Authorization
  body: JSON.stringify(body),
});

// src/features/download/readingSessionClient.ts:112 — same, for /api/v1/reading-sessions
```

`git grep -in "authorization\|bearer\|accessToken"` across `origin/dev_T4 -- src` returns **only
comments and enum members** — no header construction, no token store, no keychain entry for a
session token, no `auth/saml/start`, no `auth/me`.

**Against the contracts:** every flambeau endpoint the app calls answers `401 UNAUTHENTICATED`
without a `tf-app` bearer token. `POST /api/v1/loans` and `POST /api/v1/reading-sessions` both
document 401 explicitly. So the entire download + read path returns 401 the moment it points at a
real server.

**Why it hasn't surfaced:** `API_BASE_URL` points at an untracked mock on port 4000 that presumably
requires no auth (`B2`).

**What is missing, in full** — this is a whole feature, not a header:

1. Institution discovery — wokay `GET /api/v1/institutions` (+ `{id}` for branding/`catalogueUrl`).
2. Method selection — flambeau `GET /api/v1/auth/methods`.
3. `POST /api/v1/auth/saml/start` → open `authorizationUrl` in a browser → the assertion is
   delivered to flambeau's ACS, **not** returned down the JSON call. flambeau is explicit:
   *"no endpoint can both start SAML and hand back a token."* The token is minted at
   `POST /login/saml2/sso/tf-reader`. **The app therefore needs a deep-link / redirect capture
   step that does not exist anywhere in this repo, and neither contract documents how the token
   reaches the app after the browser round trip.** That is a genuine gap in flambeau's contract, not
   just in our client — raise it (`C6`).
4. Secure token storage — `react-native-keychain` is already a dependency and is used for BEKs and
   the device private key, so the mechanism exists.
5. Session sliding — `GET /api/v1/auth/me` on resume, storing the returned fresh `token`. One hour
   is an **idle** timeout, so an app that never calls this signs the reader out mid-session.
6. `TOKEN_EXPIRED` handling — clear keychain, re-run sign-in. Already in mobile's
   `FlambeauErrorCode` (`reading-session.ts:174`) but mapped to nothing.

**Owner:** Abhinav (client wiring) — but this is CAP-6 territory, so it needs a cross-team decision
about who owns the app-side auth module. It is the single largest gap in this document.

---

### B2 — 🔴 Base URL points at an untracked mock on port 4000, not `:8080`

**Severity: critical (trivial fix, large blast radius).**

`src/features/download/config.ts:31` resolves to `http://<lan-host>:4000`, overridable by
`EXPO_PUBLIC_MOCK_BACKEND_URL`. The file's own header is candid about it: *"Mock-backend's own base
URL — port 4000, NOT sync/config.ts's port-9000 Mongo backend."*

Both contracts specify `http://localhost:8080` for everyone.

Compounding problems:

- The mock backend itself (`mock-backend/server.js` and its routes) is **not in the repo**, so its
  behaviour is unverifiable and unreproducible by another developer.
- Three base URLs coexist (§3.3), one per capability, so "point the app at the real backend" is not
  a one-line change.
- `reachableAssetUrl()` (`contentLicenceClient.ts`, `fetchEncryptedAsset`'s helper) rewrites any
  `localhost`/`127.0.0.1` asset URL's **host *and* port** to `API_BASE_URL`'s. Once the base URL is
  correctly `:8080`, that logic is a no-op for real object-storage URLs (`https://storage.tf/...`,
  correctly left alone) — but if a local dev stack signs a `http://localhost:8080/...` content URL
  while `API_BASE_URL` is still `:4000`, this silently rewrites the port and the fetch fails. See
  `B13`.

**Owner:** Abhinav. **Fix:** one shared `EXPO_PUBLIC_API_BASE_URL` defaulting to `:8080`, plus
either commit the mock backend or delete the references to it.

---

### B3 — 🔴 `keyFingerprint` is never compared against the device's own key

**Severity: high — this is a security control the contract mandates and the client skips.**

wokay's mandate is unusually emphatic, and explains exactly why it is not optional:

> `keyFingerprint*` — SHA-256 of the device public key this key was wrapped for. **Required, and the
> reader must compare it against its own key and refuse if it differs. That comparison is what
> proves nobody in the chain substituted a key, so it cannot be optional.**

What mobile does instead:

```ts
// src/features/download/downloadManager.ts:212 — copied, not checked
keyFingerprint: session.encryption?.keyFingerprint ?? '',
```

```ts
// src/features/encryption/contentStore.ts:150 — compares the synthesized licence to its own source
if (pkg.encryption && pkg.licence.keyFingerprint !== pkg.encryption.keyFingerprint) { … }
```

The `contentStore` check looks like verification but is **vacuous for every real download**: the
licence's `keyFingerprint` was assigned from `session.encryption.keyFingerprint` two lines earlier,
so the comparison is a value against itself. It is a meaningful check only for a hand-built
`EncryptedPackage` in a test.

**Nowhere in the repo is `keyFingerprint` compared against `SHA-256(devicePublicKey)`.**
`git grep -n keyFingerprint` returns only test fixtures, the copy above and the self-comparison.

Note the `?? ''` fallback: if the server omits `keyFingerprint` (the shape flambeau's truncated
example suggests — `A7`), mobile substitutes an empty string and proceeds to decrypt.

**Fix:** in `deviceKeypair.ts`, expose `publicKeyFingerprint()` returning
`'sha256:' + hex(SHA256(spkiDerBytes))`; assert equality in `downloadManager.ts` before
`contentStore.store()`, and reject with `ContentError.LICENCE_INVALID` (or a new
`KEY_SUBSTITUTION`) on mismatch. Confirm the digest **input** with wokay — SHA-256 over the raw DER
bytes vs. over the base64 string are different values, and the contract's example
(`"sha256:d5e91261"`) is truncated to 8 hex characters, so the encoding and length both need
pinning. **Add that question to `C7`.**

**Owner:** Abhinav, but the digest-input question is wokay's to answer.

---

### B4 — 🔴 `SignedLicence` does not exist in either contract; mobile requires one and fabricates it

**Severity: high — this is the deepest structural divergence in the codebase.**

`src/shared/contracts/content-provider.ts:37` defines `SignedLicence` and its own header claims
provenance:

> Field names for the encryption/licence blocks are **taken verbatim from the wokay
> source-of-truth** (§10, §11 Seam 2 `Encryption`, Flow B licence.json).

For the `Encryption` block that is true and accurate (§4.3). For the licence it is not:

- **wokay's published contract contains no `licence` object, no `SignedLicence`, no `licence.json`,
  and no signature block anywhere.** `ContentGrant` has exactly three members: `content`, `index`,
  `encryption`. Searched the full schema section — nothing licence-shaped exists.
- **flambeau's `ReadingSessionResponse` has no `licence` field either.** Its members are
  `sessionId`, `itemId`, `loanId`, `expiresAt`, `serverTime`, `content`, `index`, `encryption`.

So `SignedLicence` — `licenceId`, `keyFingerprint`, `expiresAt`, `canPersist`, `rights: {print}`,
`signature: {alg: 'RS256', kid, value}` — describes a wire object no documented endpoint returns.
The "§10 / §11 / Flow B" citation points at an internal wokay design document that either predates
the published contract or was never carried into it.

Because `content-provider.ts`'s frozen `EncryptedPackage` makes `licence` structurally required for
encrypted books (and `contentStore.ts:124` rejects `encryption && !licence` loudly),
`downloadManager.ts:209` **synthesizes** one:

```ts
const licence: SignedLicence = {
  licenceId: session.sessionId,                                  // a log-correlation id, not a licence id
  itemId: bookId,
  keyFingerprint: session.encryption?.keyFingerprint ?? '',      // see B3
  expiresAt: loan.dueAt ?? OPEN_ACCESS_LICENCE_EXPIRES_AT,       // '9999-12-31T23:59:59.000Z'
  canPersist: loan.canPersist,
  rights: { print: false },                                      // invented — no contract source
  signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },  // unverifiable by construction
};
```

**Consequences, each independently worth raising:**

1. **The entire RS256 trust path is decorative.** `contentStore.ts:24` and `:406` both state the
   signature is not verified. Even if it were, the value is `''`. So `ContentError.LICENCE_INVALID`
   (`shared/contracts/errors.ts`) can never fire for a real download, and the frozen contract's
   comment *"Signature is REQUIRED and verified before expiry is trusted"* is false in practice.
   Since the server sends nothing to verify, **this cannot be fixed client-side** — it needs the
   contract to either add a signed licence or drop the pretence.
2. **`rights: { print: false }` is fabricated.** Neither contract carries print rights in any shape.
   Anything the app gates on it is gating on a client-side constant.
3. **`expiresAt` is doing real work and is sourced correctly** — see `B_ok2`. Keep that.
4. **Open-access sentinel.** `'9999-12-31T23:59:59.000Z'` stands in for "never expires". Defensible
   (`isLicenceExpired` only compares to `Date.now()`), but it means a bug that mis-tags a
   subscription book as open access grants a perpetual offline licence. A nullable `expiresAt` would
   fail closed instead.

**Decision needed (cohort, not CAP-7):** does a signed licence exist in this system or not?
- If **yes** → flambeau/wokay must add it to `ContentGrant`/`ReadingSessionResponse` and publish the
  signing key distribution, and mobile wires up RS256 verification.
- If **no** → `SignedLicence` should be renamed to something honest (`LocalLicenceRecord`), moved out
  of `shared/contracts/` (it is a device-side record, not an inter-team wire contract), and its
  `signature` field deleted rather than filled with a placeholder.

**Recommendation: no.** The contracts have converged on GCM's authentication tag plus a short-lived
signed URL as the integrity/authorisation mechanism; a second RS256 licence layer is not in either
document and nobody is building the signer. Say so explicitly rather than leaving a frozen contract
asserting a guarantee that does not exist.

**Owner:** Ahana (owns `shared/contracts/`) + Abhinav (owns the store), with a Contracts Gate note.
Touching `content-provider.ts` breaks the Week-1 freeze, so this needs the freeze conversation, not
a quiet edit.

---

### B5 — 🟠 Loans are borrowed and never returned; no hold, library or availability path exists

**Severity: high (functional + rights).**

`downloadManager.ts:146` calls `borrowLoan(bookId)` as step one of every download — silently, with
no borrow UI anywhere in the app. `reading-session.ts`'s header is honest that this is a stand-in:

> No capability in this repo owns "borrow" UI yet… `downloadManager.ts` calls `borrowLoan()` itself,
> silently, as the first step of a download. That is a pragmatic stand-in, not a claim that Download
> now owns the borrow UX.

But the other half of possession is missing entirely. `POST /api/v1/loans/{loanId}/return` is
**typed** (`ReturnRequest`/`ReturnResponse`, `reading-session.ts:143,149`) and **never called**.
`GET /api/v1/loans`, all four hold endpoints, `GET /api/v1/library` and
`GET /api/v1/items/{id}/availability` are absent.

**Against the contracts:**

- For `ELITE` (copy-limited) titles, every book the app opens takes a copy out of the institution's
  pool and **never gives it back** until the server's own sweep closes it at `dueAt`. flambeau's
  central invariant is not *violated* (the server still admits at most N), but the app is a
  copy-leaking client: a reader who opens five Elite books holds five copies for two weeks.
- flambeau's return path is where **hold promotion** happens (*"mark the loan RETURNED, release the
  lease, then promote the next waiter"*). An app that never returns means queued readers are never
  promoted by this client's activity.
- `NO_COPIES_AVAILABLE` (409) is mapped to nothing (`errors.ts` — it falls through to the generic
  `LOAN_FAILED`), so "all copies are out, join the queue at `/api/v1/holds`" surfaces to the user as
  a generic download failure. flambeau designed that response to name the queue endpoint precisely
  so the app can offer it as a choice.

**Scope note.** Borrow/return/holds is **CAP-4**, not CAP-7. The right outcome is probably not "CAP-7
builds a borrow UI", but the current state — borrow with no return — is worse than either owning it
or not touching it. At minimum: call `return` when the reader deletes a downloaded book, and surface
`NO_COPIES_AVAILABLE` distinctly.

**Owner:** needs a CAP-4 ⇄ CAP-7 boundary decision. Flag at the Gate.

---

### B6 — 🟠 `GET /api/v1/loans/changes` is not implemented, and it is the mechanism that closes `B7`'s hole

**Severity: high.**

flambeau states plainly why this endpoint exists:

> It carries more than loans, despite the path: hold promotions, offers lapsing, and entitlement
> revocations are all here. **A revocation is the reason this endpoint exists at all — it is the only
> way the app learns that a book it is showing has stopped being readable.**

and on `ChangeReason`:

> `ENTITLEMENT_REVOKED` is why this feed exists: it is the only way the app learns that a book it is
> currently showing has stopped being readable.

Mobile implements no change feed, stores no cursor, and has no `ChangeEntry` type. Note that
CAP-7 **already has a sync engine with cursor handling** (`src/features/sync/syncEngine.ts`,
`syncMetadataStore.ts`) pointed at a different backend — so the machinery exists; it is the flambeau
feed that is unwired.

Read this together with `B7`: the app's revocation story is currently *"re-check on every open, and
fail open if the network is down."* The contract's revocation story is *"consume the change feed."*
The app has implemented the weaker half and skipped the authoritative one.

**Owner:** Abhinav / Karthik boundary (it is a sync-shaped concern about loan state). Resolve `A10`
(path) first so it is not built twice.

---

### B7 — 🟠 Per-open re-verification fails **open**, which inverts the contract's stated purpose

**Severity: medium-high — a deliberate, documented decision that needs sign-off, not a bug.**

`readingSessionClient.ts:144` fails closed for only five codes:

```ts
const FAIL_CLOSED_CODES: ReadonlySet<DownloadError> = new Set([
  DownloadError.NO_ENTITLEMENT,
  DownloadError.ENTITLEMENT_EXPIRED,
  DownloadError.ENTITLEMENT_SUSPENDED,
  DownloadError.INSTITUTION_INACTIVE,
  DownloadError.DEVICE_LIMIT_REACHED,
]);
```

Everything else — network failure, timeout, 500, `NO_ACTIVE_LOAN`, `CONTENT_NOT_READY` — logs a
warning and **allows the read** against already-persisted ciphertext
(`readingSessionClient.ts:165-183`, called from `readerAssets.ts`'s `getBookBase64`).

flambeau's rationale for the check being on every open:

> Entitlement is re-checked rather than trusted from borrow time because a subscription can lapse
> between the two, and **the second check is the only thing standing between a revoked institution
> and a decryption key.**

**The tension is real and both sides have a point.** Failing closed on a network error would mean a
reader on a plane loses books already on their device — plainly wrong. Failing open means a revoked
institution's reader keeps reading offline indefinitely, which is what the contract says the check
prevents. The code's own comment acknowledges the contract does not resolve it:

> The real contract's own design conversation doesn't resolve what a per-open call should do with NO
> network — flagged as an open question in `flambeau-contract-comparison.md` §1.

**This is the correct resolution, and it is `B6`:** offline tolerance is safe *if* revocations arrive
through the change feed and are acted on (destroy the BEK, per `ContentStore.destroy()` — which
already exists and makes the ciphertext noise instantly, offline, size-independently). Fail-open plus
no change feed is a hole; fail-open plus a change feed is a reasonable design. Ship them together.

**Also note:** `readerAssets.ts` calls `verifyReadingAccess` on **every book open**, and each call
runs `generateDeviceKeypair()` and a full `POST /api/v1/reading-sessions`. On the contract's terms
that is correct (sessions are per-open by design). Just be aware each open costs a server round trip
plus a keychain read before any decrypt — and that today it is a `STREAM`-intent session whose
`content.url` is signed, returned, and thrown away unused.

**Owner:** Abhinav, with a Gate note recording the accepted risk.

---

### B8 — 🟠 `POST /device/register-key` does not exist in either contract; flambeau explicitly rejects the concept

**Severity: medium (dead code shipping real crypto).**

`src/shared/contracts/device-key.ts` defines `DeviceKeyRegistrationRequest`/`Response` for
`POST /device/register-key`, and `src/features/download/deviceKeyRegistration.ts` implements the
call against the port-4000 mock.

flambeau closes the door on it, in its "What is not here" section:

> **No device registration.** The device key arrives on every reading session, so a device is
> **observed rather than enrolled**.

and in the reading-session prose:

> …the fingerprint of it is what the device cap counts, so the same device presenting the same key is
> one device without anything being enrolled.

So the endpoint does not exist and is not planned. `device-key.ts`'s own header already flags itself
`DRAFT — written against a mock backend`, which is accurate.

Worse, its wire value is wrong even on its own terms: `deviceKeyRegistration.ts` base64-encodes the
PEM's **ASCII text** (`asciiToBytes` + `bytesToBase64` — armour, newlines and all), which is a
different, non-interoperable value from the `publicKeyToRawBase64()` used on the real path. That
divergence is documented in `deviceKeypair.ts:136`'s comment, so it is known.

**Fix:** delete `deviceKeyRegistration.ts`, `deviceKeyRegistration.test.ts`,
`shared/contracts/device-key.ts`, the `DownloadError.REGISTRATION_FAILED` member and the
`device-key` export from the contracts barrel. Check nothing outside `download/` imports them first.
Deleting a frozen-contract file needs the freeze conversation (`__typecheck__.ts` is the canary).

**Owner:** Abhinav (implementation) + Ahana (contracts barrel).

---

### B9 — 🟡 `AccessTier` is a third tier vocabulary, and it is dead code

**Severity: low, trivial to fix, worth fixing before something starts using it.**

```ts
// src/shared/contracts/tier.ts:12
export type AccessTier = 'OA' | 'Subscribed' | 'Elite';
```

Neither value set matches wokay's `AccessTier` (`OPEN_ACCESS` / `SUBSCRIPTION` / `ELITE`) or
flambeau's `AccessLevel` (§2.4). wokay's whole point is *"Same three values in all three places, so
a client never translates"* — and mobile introduces a fourth spelling.

**It is currently unused.** `git grep -n AccessTier -- src` returns only its own definition and a
mention in the barrel's header comment. Meanwhile `reading-session.ts:106` already defines the
correct one:

```ts
export type LicenceModel = 'OPEN_ACCESS' | 'SUBSCRIPTION' | 'ELITE';
```

**Fix:** delete `tier.ts`, keep `LicenceModel`. If a name like `AccessTier` is wanted, alias it to
`LicenceModel`. Doing this now costs nothing; doing it after a catalogue screen starts branching on
`'Elite'` costs a migration. (Frozen-contract file → freeze conversation again.)

**Owner:** Ahana (lead, `shared/contracts/`) with Abhinav (nominal owner of `tier.ts`).

---

### B10 — 🟡 `FlambeauErrorCode` contains a member neither contract defines, and picks a side on `A1`

**Severity: low-medium (documentation accuracy).**

`reading-session.ts:170` declares 18 members. Compared against the two documents:

| Member | wokay enum | flambeau doc | Note |
| --- | --- | --- | --- |
| `INVALID_DEVICE_PUBLIC_KEY` | ❌ absent | ❌ absent | **In neither contract.** wokay's prose says a short key *"is rejected"* but names no code |
| `TOKEN_EXPIRED` | ❌ explicitly excluded | ✅ explicitly kept | mobile sides with flambeau — see `A1` |
| `INSTITUTION_INACTIVE` | ❌ explicitly excluded | ✅ required | ditto |
| `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_SUSPENDED` | ❌ absent | ✅ from `DenyReason` | ditto |
| `NO_COPIES_AVAILABLE`, `NO_ACTIVE_LOAN`, `LOAN_NOT_ACTIVE`, `DEVICE_LIMIT_REACHED`, `OFFER_EXPIRED` | ❌ absent | ✅ "new, needs ratifying" | unratified |
| `CODE_TAKEN`, `TOO_MANY_IDS`, `STALE_VERSION` | ✅ | ❌ | absent from mobile — correct, they are admin/batch codes the reader cannot hit |

Mobile's enum is a **reasonable** reading of flambeau's document. Two actions: drop
`INVALID_DEVICE_PUBLIC_KEY` (or get it ratified), and add a comment recording that this type takes
flambeau's side of `A1` so it gets revisited when the Gate rules.

Separately, `errors.ts`'s mapping is a deliberate subset: `VALIDATION_FAILED`, `UNAUTHENTICATED`,
`TOKEN_EXPIRED`, `FORBIDDEN_*`, `NOT_FOUND`, `NO_COPIES_AVAILABLE`, `LOAN_NOT_ACTIVE`,
`OFFER_EXPIRED` all collapse into generic `LOAN_FAILED`/`SESSION_FETCH_FAILED` with the real
envelope attached as `cause`. Nothing is lost, but two of those deserve promotion:
**`UNAUTHENTICATED`/`TOKEN_EXPIRED`** (the app must clear the keychain and re-authenticate — the sole
reason flambeau kept `TOKEN_EXPIRED` at all) and **`NO_COPIES_AVAILABLE`** (`B5`).

---

### B11 — 🟡 A 25 MB client-side ceiling no contract knows about

`contentStore.ts:41` sets `MAX_DECRYPTED_BYTES = 25 * 1024 * 1024`, and
`downloadManager.ts:181` rejects any book whose `content.originalLength` exceeds it with
`BOOK_TOO_LARGE`, **before** storing.

Rejecting early is right (a stored oversized book would burn one of the five offline slots and throw
on every open). But nothing in either contract bounds book size: `SignedUrl.originalLength` is just
`integer ≥ 1`, and there is no max-ingest-size validation on wokay's
`POST /api/admin/v1/catalogue-items/{itemId}/content`. So an operator can publish a 40 MB book that
this client can never open, with no signal at either end.

Cross-reference: `CLAUDE.md` records a measured 20 MB EPUB producing a 609 MB app RSS peak, and
notes the simulator has no jetsam — so 25 MB is not arbitrary, it is close to the real ceiling.

**Ask wokay** to document a maximum ingest size, or accept that large titles are stream-only and give
the client a way to know that before download (`hasSearchIndex` has a precedent for exactly this kind
of capability hint).

> **Update 2026-08-25 (this section is the evidence as reviewed; the ledger has the current status).**
> The client cap is now **per-format** — `maxDecryptedBytesFor()`: 25 MB for EPUB/PDF,
> **20 MB for AUDIO**, the latter being the OPDS team's agreed prototype storage limit rather than a
> RAM figure. It is enforced on the write side too (`store()`), not only on read. The finding itself
> is unchanged: *neither* number appears in any contract, so the ask above stands for both, and the
> 40 MB-book scenario is still reachable. See `CONTRACT_ALIGNMENT.md` `B11` and
> `encryption/API_CONTRACT_NOTES.md` §4.

---

### B12 — 🟡 `format` is hardcoded `'EPUB'` at the read path, and there is no source for the real value

> **RESOLVED IN PART, 2026-08-17 (PDF support).** The READ PATH no longer hardcodes it:
> `readerAssets.ts` resolves the format from `SessionHandle.format` through Encryption's new
> `getFormat(bookId)` and passes it to `verifyReadingAccess`, and Reader routes it to one of two
> renderers. The SOURCE half is untouched and still `C3`: `downloadBook(bookId, format = 'EPUB')`
> still defaults, no caller supplies a real value, and there is no catalogue client to ask. So the
> evidence below still describes the producing side accurately — only the consuming side changed.

`readerAssets.ts`'s `getBookBase64` calls `verifyReadingAccess(bookId, 'EPUB')`, and
`downloadManager.downloadBook(bookId, format = 'EPUB')` defaults the same way. Both are honestly
commented as EPUB-only-today limitations.

The contract's intended source is wokay's book metadata — `contentType` (`PDF`/`EPUB`/`AUDIO`) on
`BatchItemsResponse.items[]` and on every OPDS publication. With no catalogue client (`C3`), there is
nowhere to read it from, so the constant is currently the only option. Note it as blocked-on-catalogue
rather than as a defect.

Related: wokay distinguishes `ContentType` (what the book *is*) from `AssetFormat` (what an uploaded
*file* is), noting *"one book can carry more than one asset, so a `contentType` of PDF may sit beside
an EPUB asset."* Mobile has a single `ContentFormat` (`primitives.ts:24`) used for both. That is fine
today, but if the app ever offers format choice, `ReadingSessionRequest.format` is an `AssetFormat`
selection, not a book property.

---

### B13 — 🟢 `reachableAssetUrl` port-rewrite becomes a hazard once `B2` is fixed

Detailed under `B2`. Real signed URLs (`https://storage.tf/...`) are correctly untouched; the risk is
narrow and only bites in a fully-local stack. Fix alongside `B2` by scoping the rewrite to host only,
or by removing it once there is one base URL.

---

### B14 — 🟢 Wrong comment: `wantSearchIndex` "Default false on the real backend"

`reading-session.ts:63`. wokay's schema says `Default=true` (`A8`). Behaviour is unaffected (mobile
always sends the field). One-line comment fix.

---

### B15 — 🟢 A subscription **audio** book would persist with no licence and no expiry

**Latent** — the reader is EPUB-only today — but it follows directly from the contracts and is cheap
to guard.

Both contracts state audio is never encrypted: wokay, *"A book is encrypted unless it is
`OPEN_ACCESS`, or unless it is audio"*, and `Encryption` is *"Null for open access and for all
audio."*

`downloadManager.ts` keys persistence off encryption alone:

```ts
encryption: session.encryption ?? null,
licence: isEncrypted ? licence : null,   // isEncrypted === (session.encryption != null)
```

So a `SUBSCRIPTION`-tier **audio** title arrives with `encryption: null` → `licence: null` →
`contentStore` treats it as open access, persists it, and `isLicenceExpired()` short-circuits to
"not expired". A subscription audiobook would sit on the device permanently with no expiry enforced,
surviving the subscription that entitled it.

**Fix:** derive persistence from `loan.canPersist` **and** `loan.licenceModel`, not from
`encryption != null`. `licenceModel === 'OPEN_ACCESS'` is the actual test for "no licence needed" —
and the app already has it on the `Loan`. Worth doing now, while it is three lines.

---

### B16 — 🟢 Dangling reference: `flambeau-contract-comparison.md`

Cited in `reading-session.ts` (header, ×2), `readingSessionClient.ts` (fail-open policy comment) and
`downloadManager.ts` (checksum note), with section numbers (`§1`, `§3`). Never committed to any
branch. Either commit it or repoint those comments at this document. Per `CLAUDE.md`'s comment-style
rule ("do not let prose describe a state the code has moved past"), a citation to a nonexistent file
is exactly the kind of comment that should not survive review.

---

### 6.6 Things the implementation gets *right* — do not "fix" these

Recorded because they look like divergences until you check the contract, and a reviewer sweeping for
conflicts will trip over them.

- **`B_ok1` — `devicePublicKey` encoding is correct.** `publicKeyToRawBase64()`
  (`deviceKeypair.ts:136`) strips PEM armour and whitespace, leaving the base64 body — which *is*
  base64 SPKI DER, and for RSA-2048 (`MODULUS_LENGTH = 2048`, `deviceKeypair.ts:37`) is exactly the
  **392 characters** wokay specifies. Mobile matches wokay's precise reading, not flambeau's loose
  "raw bytes" prose (`A6`). Do not change this to satisfy flambeau's wording; change flambeau's
  wording.
- **`B_ok2` — the two `expiresAt`s are correctly distinguished.** `downloadManager.ts:213` seeds the
  offline licence from `loan.dueAt` (multi-week possession), never from
  `ReadingSessionResponse.expiresAt` (~5 min, the grant's own life). Conflating them would expire
  every offline book five minutes after download. This is the subtlest thing in the two contracts and
  the code has it right.
- **`B_ok3` — `intent` is derived from the loan, not hardcoded.** `downloadManager.ts:153` sends
  `loan.canPersist ? 'DOWNLOAD' : 'STREAM'`. Hardcoding `'DOWNLOAD'` would make every ELITE title
  fail `403 DOWNLOAD_NOT_PERMITTED`, per both contracts. Matches wokay's guidance to *"use
  [`canPersist`] for the download button, not the tier."*
- **`B_ok4` — no checksum expected.** `ReadingSessionResponse` carries none; GCM's tag is the
  integrity mechanism. `verifyChecksum`/`bytesToHex` remain exported but uncalled, and
  `downloadManager.ts:160-175` substitutes a real cross-check (ciphertext length vs.
  `content.originalLength ± 28`, matching wokay's *"exactly 12 + plaintext + 16"*). Correct and
  better than a redundant SHA-256.
- **`B_ok5` — `SignedUrl` and `IndexUrl` mirror wokay field-for-field**, including carrying
  `termCount` that nothing reads yet. That is the right call: dropping a field silently diverges from
  the contract.
- **`B_ok6` — index fetch failure does not fail the book.** Matches `contentStore`'s own separation of
  failure domains, and nothing in either contract requires an index for a book to be readable
  (`hasSearchIndex` is explicitly `false` for audio and for un-extractable text).

---

## 7. Conflict register C — gaps

### C1 — The sync client claims unallocated `/api/v1/**` subtrees; the tracked backend doesn't

§2.2 allocates `/api/v1/**` between wokay and flambeau exhaustively. Two separate issues here, and
they should not be conflated:

1. **Client vs. contract.** `syncApi.ts:180` builds `/api/v1/{entity}` for `progress`, `bookmarks`,
   `highlights`, `personalization`, `accessibility`, `downloads`, `outbox`, `sync-metadata`. None of
   those subtrees is allocated to anyone in §2.2. If the services ever merge into the single
   application both contracts describe, these need allocating — and flambeau's note that *"One filter
   chain covers the whole app surface"* with a **public-path allowlist** means they would be
   authenticated by flambeau's chain, which knows nothing about them (so they would 401, not 404).
2. **Client vs. its own backend.** The tracked service in `TF_Reader_Backend` maps `/api/{entity}`,
   **not** `/api/v1/{entity}`. The client's `API_V1` prefix targets a different, untracked "Mongo
   backend" on port 9000. So the tracked backend and the client cannot currently be talking to each
   other, and a reviewer comparing them will find every path off by `/v1`. Worth confirming with
   Karthik which service is canonical before reading anything into the mismatch.

The cheapest fix for (1) is to move CAP-7's sync surface under a clearly-owned subtree
(`/api/v1/sync/**`) and register it in §2.2, rather than scattering seven top-level claims.

### C2 — No contract covers the CAP-7 sync surface at all

Neither document defines progress, bookmarks, highlights, personalization, accessibility prefs,
outbox or sync push/pull. That is the majority of what CAP-7 actually ships. It is nobody's conflict
and therefore nobody's action item unless raised. **Recommend: CAP-7 publishes its own contract file
in the same style, so the cohort has three, not two.** `src/features/sync/localDb/schema.ts` and the
controllers in `modules/sync/backend/` are the material.

### C3 — No catalogue / discovery / institution client (blocks `B12`, and `B1` step 1)

Nine wokay app-facing endpoints, zero implemented (§4.2). Downstream consequences already noted:
no `contentType` (`B12`), no `accessTier`, no `hasSearchIndex`, no `totalCopies`, no cover art,
no institution list to sign in against (`B1`), no `items:batch` to turn loan `itemId`s into titles.
The app's only book identity is `DEV_SAMPLE_BOOK_ID` from `devContentSeed.ts`.

Note the ownership subtlety per `CLAUDE.md`: catalogue *search* is Vaishnavi's
`src/features/search/`, but that directory is **in-book** search. Consuming wokay's OPDS feeds is
unassigned in CAP-7's ownership table.

### C4 — `POST /api/v1/catalogue/items:batch` is the designed answer to a problem the app will hit

wokay caps it at 100 ids (`400 TOO_MANY_IDS`), and flambeau's `GET /api/v1/library` deliberately does
not paginate *because* of that cap. When a library screen is built, both constraints apply together —
a shelf longer than 100 must use the paged `GET /api/v1/loans` instead. Worth designing once rather
than discovering.

### C5 — `GET /api/v1/items/{id}/availability` has a consumer waiting and no implementation

wokay's feeds carry `copies.total` only and tell clients to *"Fetch `available` from flambeau on the
detail screen."* flambeau declares the endpoint (with a 50 ms budget and "absence means unknown,
never zero" semantics) but has not built it. Nothing in mobile calls it. Sequencing item, not a
conflict.

### C6 — 🔴 Neither contract says how the app receives its token after the SAML browser round trip

Surfaced by `B1` step 3 and worth its own entry because it is a **contract gap, not a client gap**.
flambeau is explicit that the token is minted at `POST /login/saml2/sso/tf-reader` (the ACS), and
equally explicit that no JSON endpoint can both start SAML and return a token. What is *not*
documented anywhere in the 42 pages is the final hop: how a native app, having opened
`authorizationUrl` in a system browser, gets the minted token back. A deep link with a custom
scheme? A one-time code exchanged at `/auth/me`? Polling on `authTxnId`?

`authTxnId` cannot be it — flambeau says *"`authTxnId` is not a credential and proves nothing on its
own."* Until this is answered, `B1` cannot be implemented even with unlimited time. **This is the
highest-value question in this document.**

### C7 — `keyFingerprint`'s digest input and length are unspecified

From `B3`. wokay's example is `"sha256:d5e91261"` — 8 hex characters, so a truncated illustration
rather than a full 64-char digest. Undocumented: whether the digest covers the **raw DER bytes** or
the **base64 string**, whether the prefix is literally `sha256:`, and the expected hex length. All
three must match exactly or every comparison fails. Ask wokay.

### C8 — Untracked artefacts referenced by tracked code

Consolidated: `mock-backend/` (`B2`), `flambeau-contract-comparison.md` (`B16`), and — noted for
completeness against `CLAUDE.md`'s scaffolding table — `devContentSeed.ts` still stands in for the
real download pass at `App.tsx`'s mount point even though `downloadManager.ts` has landed. That last
one is internal CAP-7 sequencing, not a contract matter.

---

## 8. Field-level mapping: the reading-session path

The one path where mobile and the contracts genuinely meet. Read `A7` before trusting the
`encryption` rows.

### 8.1 Request — `POST /api/v1/reading-sessions`

| Field | wokay `ContentGrantRequest` | flambeau `ReadingSessionRequest` | Mobile | Verdict |
| --- | --- | --- | --- | --- |
| `itemId` | required | required | `BookId` (`= string`) | ✅ |
| `format` | required, `PDF\|EPUB\|AUDIO` (`AssetFormat`) | required | `ContentFormat`, from `SessionHandle.format` on the read path; still defaulted `'EPUB'` when downloading | ⚠️ `B12` |
| `intent` | required, `STREAM\|DOWNLOAD` | required | derived from `loan.canPersist` | ✅ `B_ok3` |
| `subject` | required (`userId` + nullable `institutionId`) | **not on the HTTP surface** — flambeau supplies it from the token | absent | ✅ correct: it comes from the token, which mobile does not yet have (`B1`) |
| `devicePublicKey` | nullable; Base64 SPKI DER, 392 chars, RSA-2048 min | required; "base64 of raw bytes" | `publicKeyToRawBase64()`, 392 chars | ✅ `B_ok1`; wording conflict `A6` |
| `loan` | nullable `LoanProof` `{loanId, dueAt}` | **not on the HTTP surface** — from `ActiveLoanQuery` | absent | ✅ correct |
| `wantSearchIndex` | optional, **`Default=true`** | optional | always explicit (`true`/`false`) | ✅ behaviour; ⚠️ comment `B14`, default `A8` |

### 8.2 Response

| Field | wokay `ContentGrant` | flambeau `ReadingSessionResponse` | Mobile `reading-session.ts:86` | Verdict |
| --- | --- | --- | --- | --- |
| `sessionId` | — | required | ✅ | ✅ (reused as `licence.licenceId` — see `B4`) |
| `itemId` | — | required | ✅ | ✅ |
| `loanId` | — | optional (absent for OA) | `loanId?` | ✅ |
| `expiresAt` | — | required, ~5 min | ✅ | ✅ correctly **not** used as licence expiry (`B_ok2`) |
| `serverTime` | — | required | ✅ | ✅ |
| `content` | `SignedUrl` | forwarded | `SignedUrl` | ✅ all 5 fields |
| `content.cipherLength` | `12 + plaintext + 16` | forwarded | cross-checked at `downloadManager.ts:160` | ✅ `B_ok4` |
| `index` | nullable `IndexUrl` | optional | `IndexUrl?` incl. `termCount` | ✅ `B_ok5` |
| `encryption` | nullable `Encryption`, 6 fields | forwarded "field for field" | `EncryptionDescriptor`, 6 fields | ⚠️ `keyId` optionality (`A7`); `keyFingerprint` unverified (`B3`) |
| `encryption.keyId` | **optional** | forwarded | **required** (`content-provider.ts:30`) | ⚠️ mobile is stricter than the contract — a grant without `keyId` violates mobile's type |
| — | *no licence anywhere* | *no licence anywhere* | `SignedLicence` **required** for encrypted books | 🔴 `B4` |
| — | — | — | `checksum` (old `ContentLicenceResponse` only) | ✅ correctly unused (`B_ok4`) |

### 8.3 Tier → behaviour, reconciled across all three vocabularies

| wokay `AccessTier` | seam `AccessLevel` | flambeau `licenceModel` | mobile `LicenceModel` | `canPersist` | Loan | Copies | Encrypted | Mobile persists? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN_ACCESS` | `OPEN_ACCESS` | `OPEN_ACCESS` | `OPEN_ACCESS` | true | no¹ | no | no | yes, sentinel expiry (`B4`) |
| `SUBSCRIPTION` | `ENTITLED_UNLIMITED` | `SUBSCRIPTION` | `SUBSCRIPTION` | true | yes | no | yes² | yes, expires at `dueAt` |
| `ELITE` | `ENTITLED_CONCURRENT` | `ELITE` | `ELITE` | **false** | yes | **yes** | yes | no — in-memory only |
| — | — | — | mobile `AccessTier` = `OA`/`Subscribed`/`Elite` | — | — | — | — | 🔴 `B9`, unused |

¹ Disputed within flambeau's own document — `A9`.
² Except audio, which is never encrypted — and that is the `B15` hole. **Both halves of that
footnote are now out of date** (it is the evidence as reviewed, so it is annotated rather than
rewritten): `B15` was closed 2026-08-25, and audio is no longer unencrypted — the backend
overrode its own "never encrypted" rule the same day, so audio takes the same AES-256-GCM path
as EPUB/PDF. See `CONTRACT_ALIGNMENT.md` and `reader/AUDIO_ENCRYPTION_RECON.md`.

---

## 9. Verification checklist

Each item is a concrete thing to run or read. Findings marked **[verify against YAML]** in §5 must
clear step 1 before being raised.

**Against the contract sources (not the PDFs):**

1. Open `flambeau-api.yaml` and `wokay-api.yaml`. Expand `ReadingSessionResponse.encryption` and
   `Encryption`. Confirm the six fields and `keyId`'s optionality → settles `A7`, `8.2`.
2. Diff wokay's `ErrorCode` enum against flambeau's raisable set → confirms the scale of `A1`.
3. Find `catalogue.api.AccessLevel` and `DenyReason` in the Java source. Neither is documented in
   either PDF, and both are load-bearing for `A1` and §2.4.
4. Search flambeau's admin auth branch for `tf-refresh` → settles `A5`.
5. Decode a real token from the SAML flow; check for `aud` → settles the second half of `A5`.
6. Search both specs for any licence/signature object → confirms `B4`. Expect nothing.
7. Search for a documented app-side token-return mechanism after the ACS → confirms `C6`. Expect
   nothing; this is the question to escalate.

**Against `dev_T4` (each is one command):**

```bash
cd TF_Reader_Mobile && git fetch && git checkout origin/dev_T4

git grep -in "authorization\|bearer\|accessToken" -- src   # B1 — expect comments only
git grep -n  "API_BASE_URL\s*=" -- src                     # B2 — expect 3 different ports
git grep -n  "keyFingerprint" -- src                       # B3 — expect fixtures + 1 copy + 1 self-compare
git grep -n  "SignedLicence\|licenceId\|RS256" -- src      # B4
git grep -n  "AccessTier" -- src                           # B9 — expect definition + 1 comment, no users
git grep -rn "loans/.*return\|/api/v1/holds\|/api/v1/library\|loans/changes" -- src   # B5, B6 — expect nothing
git grep -n  "flambeau-contract-comparison" -- src         # B16 — expect 4 hits, file absent
ls mock-backend 2>/dev/null || echo "untracked — C8"       # B2

# C1 — client prefix vs tracked-backend prefix
git grep -n "API_V1" -- src/features/sync                  # expect /api/v1
cd ../TF_Reader_Backend && git grep -h '@RequestMapping('   # expect /api/*, no /v1
```

**Confirm nothing is already broken** (all three must pass; per `CLAUDE.md` these gate every change):

```bash
npm test && npm run typecheck && npm run lint
```

Note that all of §6 is currently **green** on these — the conflicts are with the contracts, not with
the test suite. `src/features/sync/contractConformance.test.ts` and
`src/shared/contracts/__typecheck__.ts` guard the *internal* freeze, and no test in the repo asserts
anything against wokay's or flambeau's published shapes. **A conformance test over the flambeau
request/response shapes would have caught `B4`, `B10` and `B14`, and is probably the highest-value
single addition here.**

---

## 10. What needs a decision, by owner

**flambeau + wokay jointly, at the Contracts Gate — blocking:**

| # | Question |
| --- | --- |
| `A1` | One `ErrorCode` enum: whose members? wokay's exclusion of `TOKEN_EXPIRED`/`INSTITUTION_INACTIVE` vs flambeau's need for both, plus five unratified codes |
| `A5` | Does flambeau's app token carry `aud: tf-app`? Does a `tf-refresh` audience exist? Until the first is yes, no app token passes wokay's filter chain |
| `C6` | **How does the app receive its token after the SAML browser round trip?** Undocumented in both contracts; blocks all app auth |
| `B4` | Does a signed licence exist in this system? If not, mobile's frozen `SignedLicence` must be renamed and de-signed |

**wokay:**

| # | Question |
| --- | --- |
| `A2` | Is institutional sign-in SAML-only, or does the institution record need a `signIn.methods[]`? |
| `A3` | Should `idpHint` remain writable if flambeau ignores it? |
| `C7` | `keyFingerprint`: digest over DER bytes or base64? Prefix? Full hex length? |
| `B11` | Is there a maximum ingest size, and can a client learn it before download? |

**flambeau:**

| # | Question |
| --- | --- |
| `A4` | `DOWNLOAD_NOT_PERMITTED`: 403 or 422 (its own reference disagrees with both PDFs) |
| `A6` | Restate `devicePublicKey` as Base64 SPKI DER, 392 chars |
| `A7` | Publish the untruncated `encryption` example, including `keyFingerprint` |
| `A8` | State `wantSearchIndex`'s default (wokay says `true`) |
| `A9` | Does borrowing `OPEN_ACCESS` write a loan? Table and prose disagree |
| `A10` | `/api/v1/loans/changes` or `/api/v1/changes`? Decide before it is implemented |

**Abhinav (Download + Encryption):**

| # | Item | Size |
| --- | --- | --- |
| `B1` | App auth: token acquisition, storage, `Authorization` header, `/auth/me` sliding, `TOKEN_EXPIRED` handling | large — needs a CAP-6 boundary decision first |
| `B2` | One base URL, defaulting to `:8080`; commit or delete the mock backend | small |
| `B3` | Compare `keyFingerprint` against the device key; reject on mismatch (needs `C7`) | small |
| `B6` | Consume `GET /api/v1/loans/changes`; act on `ENTITLEMENT_REVOKED` via `destroy()` | medium — pairs with `B7` |
| `B7` | Keep fail-open, but record the accepted risk; it is only safe once `B6` lands | note |
| `B8` | Delete `deviceKeyRegistration.ts` + `device-key.ts` + `REGISTRATION_FAILED` | small (freeze conversation) |
| `B10` | Drop `INVALID_DEVICE_PUBLIC_KEY`; promote `UNAUTHENTICATED`/`TOKEN_EXPIRED`/`NO_COPIES_AVAILABLE` | small |
| `B14` | Fix the `wantSearchIndex` comment | trivial |
| `B15` | Gate persistence on `licenceModel`/`canPersist`, not `encryption != null` | small |
| `B16` | Commit `flambeau-contract-comparison.md` or repoint the four citations here | trivial |
| — | Add a conformance test over flambeau's request/response shapes | small, high value |

**Ahana (lead, `shared/contracts/`):**

| # | Item |
| --- | --- |
| `B9` | Delete `tier.ts`; standardise on `LicenceModel` (freeze conversation) |
| `B4` | Co-own the `SignedLicence` decision — it is `content-provider.ts`, a Week-1 frozen file |
| `C2` | Propose CAP-7 publishing its own contract file, so the cohort has three |

**Cohort / needs an owner assigned:**

| # | Item |
| --- | --- |
| `B5` | Borrow/return/holds is CAP-4. Current state (borrow, never return) leaks Elite copies. At minimum: return on delete, and surface `NO_COPIES_AVAILABLE` |
| `C3` | Nobody owns the OPDS/catalogue client. It blocks `B12` and step 1 of `B1` |
| `C1` | `/api/v1/**` subtree allocation for CAP-7's sync routes, if the services ever merge — plus a Karthik question: which sync backend is canonical, given the client/backend prefix mismatch |

---

## Appendix — one-line summary of every finding

| ID | Severity | Summary |
| --- | --- | --- |
| `A1` | 🔴 | One shared `ErrorCode` enum, two incompatible member lists |
| `A2` | 🔴 | wokay: SAML-only. flambeau: SAML **and** OIDC |
| `A3` | 🟠 | `idpHint` — wokay expects it honoured, flambeau ignores it |
| `A4` | 🟡 | `DOWNLOAD_NOT_PERMITTED` 403 vs 422 (flambeau's own two docs) |
| `A5` | 🔴 | App token may carry no `aud`; a third `tf-refresh` audience may exist |
| `A6` | 🟠 | `devicePublicKey`: "Base64 SPKI DER" vs "base64 of raw bytes" |
| `A7` | 🟠 | `Encryption.keyId` optionality; truncated example hides `keyFingerprint` |
| `A8` | 🟡 | `wantSearchIndex` default stated by wokay, not by flambeau |
| `A9` | 🟡 | Does `OPEN_ACCESS` write a loan? flambeau says both |
| `A10` | 🟡 | Change feed on a loan-shaped path |
| `B1` | 🔴 | No `Authorization` header, no token, no auth flow at all |
| `B2` | 🔴 | Base URL is an untracked mock on `:4000`, not `:8080` |
| `B3` | 🔴 | `keyFingerprint` never compared to the device key |
| `B4` | 🔴 | `SignedLicence` exists in no contract; synthesized with an empty signature |
| `B5` | 🟠 | Loans borrowed, never returned; no holds/library/availability |
| `B6` | 🟠 | Change feed unimplemented — the designed revocation channel |
| `B7` | 🟠 | Per-open check fails open; safe only once `B6` lands |
| `B8` | 🟠 | `POST /device/register-key` doesn't exist; flambeau rejects the concept |
| `B9` | 🟡 | `AccessTier` is a fourth tier spelling, and dead code |
| `B10` | 🟡 | `INVALID_DEVICE_PUBLIC_KEY` in no contract; auth codes unmapped |
| `B11` | 🟡 | 25 MB client ceiling, no contract bound |
| `B12` | 🟡 | `format` hardcoded `'EPUB'` — read path fixed 2026-08-17, source still blocked on `C3` |
| `B13` | 🟢 | `reachableAssetUrl` port rewrite, hazardous after `B2` |
| `B14` | 🟢 | Wrong `wantSearchIndex` default in a comment |
| `B15` | 🟢 | Subscription audio would persist with no licence or expiry |
| `B16` | 🟢 | Dangling `flambeau-contract-comparison.md` citations ×4 |
| `C1` | 🟡 | Sync client claims unallocated `/api/v1/**` subtrees; tracked backend serves `/api/*` |
| `C2` | 🟠 | No contract covers CAP-7's sync surface at all |
| `C3` | 🟠 | No catalogue/discovery/institution client; unowned |
| `C4` | 🟢 | `items:batch` 100-id cap interacts with `GET /library`'s non-pagination |
| `C5` | 🟢 | `availability` endpoint has a documented consumer, no implementation |
| `C6` | 🔴 | **No contract says how the app receives its token after SAML** |
| `C7` | 🟠 | `keyFingerprint` digest input/length unspecified |
| `C8` | 🟡 | Untracked artefacts referenced by tracked code |

**Also verified as correct, do not change:** `B_ok1` `devicePublicKey` encoding (392-char SPKI DER) ·
`B_ok2` loan `dueAt` vs session `expiresAt` kept distinct · `B_ok3` `intent` derived from
`canPersist` · `B_ok4` no checksum, length cross-check instead · `B_ok5` `SignedUrl`/`IndexUrl`
mirrored field-for-field · `B_ok6` index failure doesn't fail the book.
