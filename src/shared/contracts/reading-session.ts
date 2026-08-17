// src/shared/contracts/reading-session.ts
// Real flambeau backend contract — Loans + Reading sessions. CAP-7 Reader & Offline (t4targaryen)
//
// Owner: Download + Encryption (Abhinav).
//
// Added 2026-08-14, replacing content-licence.ts's mock-shaped `GET /books/:id/content-licence`
// as the PRIMARY flow, against team flambeau's real, published OpenAPI spec
// (https://deepu1004.github.io/flambeau-api-contracts/, `x-stability: FROZEN` on every endpoint
// modeled here). `content-licence.ts` is left in place, untouched, per an explicit "don't remove
// functionality" instruction — nothing in this file deletes it, and downloadManager.ts's switch
// to this file's shapes doesn't remove `fetchContentLicence`/`ContentLicenceResponse` from the
// codebase, just stops calling them from the main flow.
//
// TWO REAL ENDPOINTS, TWO REAL OBJECTS — do not conflate them:
//   - A LOAN is possession, lasts ~2 weeks, written once per book (`POST /api/v1/loans`).
//   - A READING SESSION is permission to fetch bytes RIGHT NOW, lasts ~5 minutes, requested once
//     per book OPEN — download or read — never taking a lease itself (`POST /api/v1/reading-sessions`).
// Confusing the two is, per the spec's own words, "the most common design mistake in this system."
// `Loan.canPersist` (not tier, not licenceModel) is what actually gates whether `intent: DOWNLOAD`
// will be honoured — the server refuses it for ELITE regardless of what the UI offered.
//
// WHY A LOAN STEP EXISTS HERE AT ALL, WHEN NOTHING IN THIS REPO MODELED ONE BEFORE: the real
// backend requires an active loan before a reading session succeeds (`409 NO_ACTIVE_LOAN`
// otherwise), except open access. No capability in this repo owns "borrow" UI yet (CAP-4, if it
// exists, is outside CAP-7's scope) — `downloadManager.ts` calls `borrowLoan()` itself, silently,
// as the first step of a download. That is a pragmatic stand-in, not a claim that Download now
// owns the borrow UX; flagged as such in `flambeau-contract-comparison.md`.
//
// `licence: SignedLicence` DOES NOT EXIST ON THE REAL RESPONSE — content-provider.ts's frozen
// `EncryptedPackage`/`ContentStore.store()` require one (with `expiresAt`/`canPersist`/`rights`/
// `signature`) to decide Subscription-vs-Elite persistence, but the real backend never sends
// anything shaped like it. `downloadManager.ts` synthesizes one locally from `Loan.canPersist` +
// `Loan.dueAt` (the actual multi-week offline-reopen window) — NOT from `ReadingSessionResponse
// .expiresAt` (only ~5 minutes, meant for the signed URL/grant, not for gating an offline reopen
// weeks later). Conflating those two `expiresAt`s was flagged explicitly in
// `flambeau-contract-comparison.md` §3 as a real divergence; this is where that gets resolved.
// `signature` has no real-backend counterpart at all (RS256 licence signing isn't part of this
// spec) — synthesized as an empty/unverified placeholder, matching `contentStore.ts`'s own
// already-documented, pre-existing gap (RS256 verification was never implemented, real or mock).

import type { BookId, ContentFormat } from '../types/primitives';
import type { EncryptionDescriptor } from './content-provider';

// ── reading ───────────────────────────────────────────────────────────────

/** `Format` in the real spec — same three values as `ContentFormat`, kept as an alias so this
 * file's exports read the same as the spec rather than silently renaming it. */
export type ReadingFormat = ContentFormat;

/** `DOWNLOAD` is refused for ELITE whatever the UI offered. Audio streams, never encrypted. */
export type ReadingIntent = 'STREAM' | 'DOWNLOAD';

export interface ReadingSessionRequest {
  itemId: BookId;
  format: ReadingFormat;
  intent: ReadingIntent;
  /** Base64 of RAW key bytes — NOT a PEM, NOT a JWK. See deviceKeypair.ts's
   * `publicKeyToRawBase64()`, added alongside this file for exactly this wire shape. */
  devicePublicKey: string;
  /** wokay's schema states `Default=true`; flambeau's own rendered schema states no default.
   * Moot either way — this client always sends the field explicitly (matches the OLD
   * content-licence.ts client's same stated behavior — see that file's `index` comment). */
  wantSearchIndex?: boolean;
}

/** wokay's `SignedUrl`, forwarded by flambeau unchanged. Carries its OWN `expiresAt` — the signed
 * URL's, not the session's or the loan's. Slightly outlives the session in the spec's own example
 * (content 10:15 vs session 10:05) so a slow download doesn't race the grant.
 *
 * `cipherLength`/`originalLength`/`mimeType` are OPTIONAL on the real spec (no `*` on any of the
 * three in wokay's schema) — only `url` and `expiresAt` are required. Marking them required here
 * was a real bug, found in review: `downloadManager.ts` trusted `originalLength` unconditionally,
 * so an absent field would make its own length cross-check compare a real number against
 * `undefined`, always fail, and reject every download with a `CHECKSUM_MISMATCH` that blames a
 * field that no longer exists. `computeOriginalLength` (downloadManager.ts) is the fallback for
 * exactly this case — test presence, per the real spec's own stated convention ("a null field is
 * omitted rather than sent as null; test for presence, not length"). */
export interface SignedUrl {
  url: string;
  expiresAt: string; // ISO-8601 UTC
  cipherLength?: number;
  originalLength?: number;
  mimeType?: string;
}

/** wokay's `IndexUrl`, forwarded by flambeau unchanged. Same shape `content-licence.ts`'s
 * `ContentLicenceIndexInfo` already models — kept as a separate named type here rather than
 * reused, so this file's exports mirror the spec 1:1 without a cross-file dependency on the
 * mock-shaped contract it's replacing.
 *
 * `url`/`encrypted` are OPTIONAL on the real spec too (same "test for presence" convention as
 * `SignedUrl` above) — only present when the caller asked for an index (`wantSearchIndex`) AND
 * the book actually has one. */
export interface IndexUrl {
  url?: string;
  encrypted?: boolean;
  termCount?: number;
}

export interface ReadingSessionResponse {
  /** For correlating logs. Not a credential, never presented back to the server. */
  sessionId: string;
  itemId: BookId;
  /** The loan this read was authorised against. Absent for open access. */
  loanId?: string;
  /** ~5 minutes. This is the SESSION's expiry, not the licence's — see this file's header. */
  expiresAt: string;
  serverTime: string;
  content: SignedUrl;
  /** Absent when there is none, or when `wantSearchIndex` wasn't set. */
  index?: IndexUrl;
  /** Absent for open access and for all audio. Reused verbatim from content-provider.ts — same
   * field names ARE the real wire format, per that file's own header. */
  encryption?: EncryptionDescriptor;
}

// ── loans ─────────────────────────────────────────────────────────────────

/** wokay's vocabulary. `ENTITLED_UNLIMITED` is `SUBSCRIPTION`, `ENTITLED_CONCURRENT` is `ELITE`. */
export type LicenceModel = 'OPEN_ACCESS' | 'SUBSCRIPTION' | 'ELITE';

/** `EXPIRED` is a loan the server's own sweep closed at its due date; `RETURNED` is one the
 * reader closed. Both are over. */
export type LoanStatus = 'ACTIVE' | 'RETURNED' | 'EXPIRED';

export interface BorrowRequest {
  itemId: BookId;
}

export interface Loan {
  loanId: string;
  itemId: BookId;
  userId: string;
  /** Omitted for an individual subscriber (no institution). */
  institutionId?: string;
  licenceModel: LicenceModel;
  status: LoanStatus;
  borrowedAt: string;
  /** Absent for open access, which never expires. Otherwise borrowedAt + the entitlement's
   * loanPeriodDays — a real multi-week window, NOT the ~5-minute reading-session expiry. */
  dueAt?: string;
  returnedAt?: string;
  /** THE download-button gate — not `licenceModel`. False for ELITE; the server refuses a
   * DOWNLOAD-intent reading session regardless of what the UI showed. */
  canPersist: boolean;
  serverTime: string;
}

export interface LoanPage {
  loans: Loan[];
  page: number;
  size: number;
  total: number;
  serverTime: string;
}

export interface ReturnRequest {
  /** The reader's own timestamp, for an offline return reported late. Server clamps it to
   * [borrowedAt, serverTime] — omit to let the server timestamp the return itself. */
  returnedAt?: string;
}

export interface ReturnResponse {
  loanId: string;
  itemId: BookId;
  status: LoanStatus;
  borrowedAt: string;
  returnedAt: string;
  /** Whether freeing this copy promoted a queued reader. */
  promoted: boolean;
  serverTime: string;
}

// ── errors ────────────────────────────────────────────────────────────────

/**
 * The real backend's own error taxonomy (`common/error/ErrorCode`), field-for-field from the
 * spec's `Error`/`ErrorCode` schemas — NOT `DownloadError` (errors.ts), which is this app's own,
 * separate, already-existing carrier for client/device-side failures (storage, permissions, the
 * book limit). `downloadManager.ts`/`readingSessionClient.ts` map a subset of THESE onto specific
 * NEW `DownloadError` members (see errors.ts's additions) rather than replacing anything — every
 * pre-existing `DownloadError` member is untouched.
 */
export type FlambeauErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_DEVICE_PUBLIC_KEY'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN_SCOPE'
  | 'FORBIDDEN_INSTITUTION_MISMATCH'
  | 'NO_ENTITLEMENT'
  | 'ENTITLEMENT_EXPIRED'
  | 'ENTITLEMENT_SUSPENDED'
  | 'INSTITUTION_INACTIVE'
  | 'DOWNLOAD_NOT_PERMITTED'
  | 'DEVICE_LIMIT_REACHED'
  | 'NOT_FOUND'
  | 'CONTENT_NOT_READY'
  | 'NO_COPIES_AVAILABLE'
  | 'NO_ACTIVE_LOAN'
  | 'LOAN_NOT_ACTIVE'
  | 'OFFER_EXPIRED';

/** One envelope for the whole backend, field-for-field wokay's `Error`. `message` is for a
 * human — switch on `code`, never on `message`. */
export interface FlambeauError {
  timestamp: string;
  status: number;
  code: FlambeauErrorCode;
  message: string;
  path: string;
  traceId?: string;
}
