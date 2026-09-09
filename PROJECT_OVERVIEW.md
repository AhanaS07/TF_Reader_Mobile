# TF Reader — Project Overview

Basic project reference: problem statement, requirements, solution, data model, security level,
and project structure (frontend + backend). Team **t4targaryen** owns CAP-7 (Reader & Offline) of
this mobile app; the backend is split across two other teams (**flambeau** and **wokay**) whose
published contracts this app builds against.

## Problem Statement

Taylor & Francis needs a mobile reading app that lets students, researchers, and institutional
subscribers read academic PDFs, EPUBs, and audiobooks on iOS and Android — online or offline —
while respecting three different licensing models a publisher actually sells under:

- **Open access** — free to read, no limits.
- **Subscription** — included in an institution's or individual's plan, unlimited concurrent
  readers, downloadable for offline reading.
- **Elite (copy-limited)** — a fixed number of licensed copies, borrowed like a physical library
  book (one reader per copy at a time), online-only — the file must never be downloaded outright.

The hard constraint underneath all three: a downloaded book's decrypted content must **never be
written to disk in plaintext**, even transiently, and access must be revocable (a lapsed
subscription or an expired loan must stop a reader from opening a book they already downloaded).

## Requirements

**Functional**
- Browse a catalogue (institutional or public/open-access) and search across it.
- Borrow a copy-limited title, or simply read/download an unlimited one.
- Read book online (All tiers)
- Download a book for offline reading (Subscription/Open Access only — Elite is online-only).
- Decrypt and render PDF/EPUB/Audio content on-device.
- Track reading progress, bookmarks, and highlights; sync them across a reader's devices.
- Personalization (theme, font, layout) and accessibility (dyslexia font, TTS, screen-reader
  hints, high contrast, large touch targets) settings, synced per user.
- Full-text, on-device search inside a downloaded book (no server round trip).

**Non-functional**
- **Offline-first**: reading, progress, and personalization must keep working with no network;
  writes queue locally and sync when connectivity returns.
- **Security**: whole-book AES-256-GCM decryption in RAM only; a device-bound key wraps every
  book's key so a book decrypted on one device can't be decrypted on another.
- **Cross-platform**: one React Native codebase for iOS and Android.
- **Memory-bounded**: a book must fit a fixed RAM budget (25 MB decrypted) — an oversized book is
  refused before it's ever stored, not discovered mid-read.
- **Revocable access**: a per-open re-check against the backend, not just a one-time download-time
  check, so a revoked entitlement stops a future open even for an already-downloaded book.

## Solution

A React Native (Expo) mobile app talks to **one Spring Boot backend application** that hosts two
teams' modules side by side (no HTTP hop between them — they call each other's Java interfaces
in-process):

- **flambeau** — auth (SAML/OIDC), loans (borrow/return), reading sessions (the ~5-minute
  "permission to fetch bytes right now" grant), holds/queueing for copy-limited titles, and the
  reader's library/sync-changes feed.
- **wokay** — institution onboarding, the OPDS 2.0 catalogue feed, admin console APIs
  (publishers/collections/catalogue items/entitlements), and the two seams flambeau calls
  in-process: `EntitlementQuery` ("may this institution access this book") and
  `ContentAccessGrant` ("give me the signed file URL and the wrapped key").

On the client side, the flow for reading a book is:

1. **Borrow** (`POST /api/v1/loans`) — possession, ~2 weeks, written once. Idempotent: a reader
   who already holds a title just gets that loan back.
2. **Open a reading session** (`POST /api/v1/reading-sessions`) — re-checks entitlement fresh
   every single open (not trusted from borrow time), returns a signed, short-lived URL to the
   encrypted file plus (for anything encrypted) a book encryption key wrapped to *this device's*
   public RSA key.
3. **Fetch + decrypt** — the app downloads the ciphertext, unwraps the book key with its
   device-private key (kept in the OS keychain, never exported), and decrypts the whole book with
   AES-256-GCM into RAM. Plaintext is handed to the reader engine (epub.js/pdf rendering) and is
   never written to disk.
4. **Store or discard** — Subscription/Open Access content persists the *ciphertext* (never
   plaintext) for offline reopening; Elite content is discarded the moment the session ends.

A local mock backend (Node/Express) stands in for the real flambeau/wokay Spring Boot app during
development and CI, implementing the same published contract.

## Flow

### End-to-end user flow
1. **Sign in** — institutional SSO (SAML/OIDC) or individual account. flambeau mints a one-hour
   app JWT (`aud: tf-app`).
2. **Browse** — the OPDS catalogue feed (wokay), scoped to what the reader's institution is
   entitled to, plus anything open access.
3. **Pick a book**:
   - Open access / Subscription → **Read now** or **Download**, no queue.
   - Elite (copy-limited) → **Borrow**. If a copy is free, borrowing succeeds immediately; if not,
     **join the queue** (a hold) and wait for an offer.
4. **Read** — the app requests a reading session, fetches and decrypts the book, and hands
   plaintext bytes to the reader engine. Elite content is streamed for that session only; nothing
   is written to disk.
5. **Offline reading** — for Subscription/Open Access, the ciphertext persists locally so the book
   reopens without a network call; a lightweight background re-check still runs on each open,
   failing open only when the network itself is unreachable.
6. **Progress sync** — page position, bookmarks, and highlights save locally first (instant, works
   offline) and sync to the server in the background whenever connectivity is available.
7. **Return / expiry** — a loan returned (manually or automatically at its due date) or an
   entitlement revoked takes effect the next time that book is *opened*, not immediately on every
   device — there is no push-based kill switch, only re-verification at open time.

### Technical flow — reading a book (sequence)
```
App                    flambeau                  wokay                Object Storage
 │                        │                        │                        │
 │  POST /api/v1/loans    │                        │                        │
 ├───────────────────────►│                        │                        │
 │                        │  EntitlementQuery      │                        │
 │                        ├───────────────────────►│ (in-process, no HTTP)  │
 │                        │◄───────────────────────┤                        │
 │                        │  write loan (Mongo)    │                        │
 │  ◄── Loan{loanId,      │                        │                        │
 │      dueAt,canPersist} │                        │                        │
 │                        │                        │                        │
 │  POST /reading-sessions│                        │                        │
 ├───────────────────────►│                        │                        │
 │                        │  EntitlementQuery      │                        │
 │                        │  (re-checked, fresh)   │                        │
 │                        ├───────────────────────►│                        │
 │                        │  ContentAccessGrant     │                        │
 │                        │  .grant(...)           │                        │
 │                        ├───────────────────────►│                        │
 │                        │◄─── signed URL + wrapped BEK + encryption info ──┤
 │  ◄── ReadingSession    │                        │                        │
 │      Response          │                        │                        │
 │                        │                        │                        │
 │  GET signed URL (ciphertext)                    │                        │
 ├─────────────────────────────────────────────────────────────────────────►│
 │  ◄──────────────────────────────────── encrypted bytes ──────────────────┤
 │                        │                        │                        │
 │  unwrap BEK (RSA-OAEP-256, device private key — Keychain, never leaves)  │
 │  AES-256-GCM decrypt whole book → plaintext bytes, in RAM only           │
 │  hand plaintext to reader engine (epub.js / pdf renderer, WebView)       │
 │  if canPersist: store CIPHERTEXT to disk (never plaintext); else discard│
```

### Technical flow — offline-first sync
```
local edit (page turn, bookmark, highlight, prefs change)
        │
        ▼
write to SQLite (progress/bookmarks/highlights/personalization/accessibility)
        │
        ▼
write a matching row to `outbox`           ← works with zero network
        │
        ▼  (connectivity restored)
syncEngine PUSH: outbox rows → server, oldest first, retried on failure
syncEngine PULL: GET .../changes?since=<cursor> → apply to local tables
        │                                          (write-locked against local writes)
        ▼
advance `sync_metadata` cursor once a batch is fully applied
```

## DB (Tables, which DB)

Two separate databases, one per side of the app — they are never the same store and never share a
schema.

### Backend (flambeau/wokay) — MongoDB, with Redis for derived/ephemeral state
Mongo is the system of record; every Redis key is rebuildable from it (see the `ops/reconcile`
endpoint). Key collections:

| Collection | Holds |
|---|---|
| `catalogueItems` | Book metadata: title, authors, ISBN, content type, access tier, ingest state |
| `publishers` / `collections` | Sellable groupings a catalogue item belongs to |
| `institutions` | Institution records, branding, SSO config |
| `entitlements` | What an institution may access (publisher/collection/item scope, copy limits) |
| `loans` | Possession records (~2 week window), one active loan per reader per item |
| `holds` | Queue entries + offers for copy-limited titles |
| `adminUsers` / `adminSessions` | Console operator accounts and refresh-token sessions |
| `auditLogs` | Every admin change and every content-access event, 90-day retention |
| `feedSettings` | Per-institution curated-shelf configuration for the OPDS feed |

Redis holds derived state only — active-loan lease sets (for the copy-limit invariant), hold
queues, and monotonic ticket dispensers — rebuilt from Mongo, never authoritative on its own.

### Mobile app (offline-first local store) — SQLite (`expo-sqlite`)
Six business tables plus two sync-infrastructure tables, all sharing the same
sync bookkeeping columns (`updated_at`, `is_deleted`, `synced`, `server_updated_at`):

| Table | Holds |
|---|---|
| `progress` | Current reading position per user/book (offset + full EPUB locator) |
| `bookmarks` | Named positions a reader saved |
| `highlights` | Selected-text ranges + colour |
| `personalization` | Theme, font, typography, layout — one row per user |
| `accessibility` | Dyslexia font, TTS settings, high contrast, screen-reader hints, etc. |
| `downloads` | Which books are downloaded locally, format, local file path, status |
| `outbox` | Pending local writes not yet pushed to the server (the offline write queue) |
| `sync_metadata` | Sync cursors (last-pull token, last-push time) |

Note: `downloads.is_valid` is **not** the entitlement gate — that's enforced by Encryption from
the licence embedded in the encrypted package on disk, independent of this table, specifically so
there's only one source of truth for "can this book still be opened."

## Security Level

- **Content encryption**: AES-256-GCM, whole book, decrypted into RAM only — never to disk.
  Integrity is enforced by GCM's own authentication tag (a tampered or truncated file fails loudly,
  never renders partially).
- **Key wrapping**: each book's key (BEK) is RSA-OAEP-256 wrapped to a device-generated RSA
  keypair. The private key lives in the OS keychain/keystore and is never exported off the device —
  a book decrypted on one device cannot be decrypted on another without a fresh grant.
- **Entitlement re-verification**: access is re-checked on every book *open*, not trusted from
  download time, so a revoked subscription or expired loan is caught even for a
  previously-downloaded book (fails open only for network-unreachable cases, fails closed for an
  explicit revocation from the server).
- **Auth tokens**: HS256 JWTs, one-hour app tokens (`aud: tf-app`) separate from admin tokens
  (`aud: tf-admin`); admin sessions use rotating opaque refresh tokens, hashed at rest.
- **Transport**: intended to be HTTPS-only end to end; current dev/mock setup uses plain HTTP and
  has no request-level auth header wired up yet — tracked as an open item to close before pointing
  at a real, authenticated backend (see `full-audit-report.md`).
- **At-rest scope**: only book *ciphertext* persists locally; reading progress/bookmarks/prefs in
  the local SQLite DB are unencrypted (low sensitivity, no key material ever stored there).
- **Known, tracked gaps** (see `CLAUDE.md` "Known open items" and `full-audit-report.md` for the
  full list and severities): licence-signature (RS256) verification isn't implemented yet
  (expiry-only enforcement today); keychain items aren't yet marked device-only for backup
  exclusion; a stale cached device key can outlive a fresh re-download.

## Project Structure

### Frontend — React Native (Expo SDK 57), TypeScript
```
App.tsx                      # entry point (temporary — pending RootNavigator)
src/
  shared/
    contracts/                # frozen cross-team interfaces (ContentProvider, ContentStore,
                               # ReadingSession/Loan, errors) — the single import barrel
    types/                    # shared primitive types
  features/
    reader/                   # epub.js/pdf rendering, WebView bridge (owner: Ahana)
    download/                 # loan + reading-session client, download orchestration (owner: Abhinav)
    encryption/                # AES-256-GCM, RSA key wrap/unwrap, on-device ContentStore (owner: Abhinav)
    sync/                     # local SQLite, outbox, push/pull sync engine (owner: Karthik)
    personalization/          # theme/font/layout prefs (owner: Vaishnavi)
    search/                   # on-device full-text search + index (owner: Vaishnavi)
    accessibility/            # TTS, dyslexia font, screen-reader support (owner: Hruthik)
samples/                      # encrypted test fixtures (never real content)
assets/reader/                # generated reader.html + sample EPUB (tracked, regenerated by script)
```
Key native dependencies: `react-native-keychain` (device key storage), `react-native-quick-crypto`
+ `react-native-aes-gcm-crypto` (crypto), `expo-sqlite` (local DB), `react-native-webview` (reader
rendering) — all require an Expo **dev client** build; Expo Go cannot load them.

### Backend
```
flambeau (Spring Boot module)     # auth, loans, reading-sessions, holds, library/sync-changes feed
wokay (Spring Boot module)        # institutions, OPDS catalogue, admin console, ContentAccessGrant
  └── one deployed Spring Boot application, both modules in-process, no HTTP between them
mock-backend/ (Node/Express)      # local stand-in implementing the same published contract,
                                  # used for this repo's dev + Jest runs (not the real backend)
  routes/                        # loans, reading-sessions, holds, content-licence, seat, device-key
  scenarios/                     # ?scenario= presets for negative-path testing (server_error,
                                  # no_active_loan, download_not_permitted, expired, tampered, ...)
  fixtures/                      # generated test EPUB/PDF + wrapped test key
```
Storage: MongoDB (system of record) + Redis (derived/ephemeral: lease counts, hold queues, ticket
dispensers) for the real backend; the mock backend uses in-memory state instead, matching the same
request/response contract.
