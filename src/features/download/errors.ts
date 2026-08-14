// Owner: Download (Abhinav).
//
// Download's OWN fail-loud error carrier — same shape as Encryption's ContentFailure
// (src/shared/contracts/errors.ts), but NOT added to that file: it's frozen and co-owned by
// Reader + Encryption, and none of its codes (INTEGRITY_FAILED, DECRYPTION_FAILED, ...) describe
// a download-side failure like "storage full" or "book limit reached". A ContentFailure the
// Encryption layer raises (e.g. from contentStore.store()) is left to bubble up UNWRAPPED by
// downloadManager.ts — it is already well-typed by its owning module, no need to double-wrap.
//
// bookId is nullable: REGISTRATION_FAILED (device-key provisioning) is not book-specific.
//
// ADDITIONS 2026-08-14, for the real flambeau contract (reading-session.ts) — every member
// ABOVE this comment is untouched; nothing was renamed or removed. `LICENCE_FETCH_FAILED` and
// `fetchContentLicence`/`ContentLicenceResponse` (content-licence.ts) stay defined and exported,
// just unused by the new primary flow, per an explicit "don't remove functionality" instruction.
//
// LOAN_FAILED / SESSION_FETCH_FAILED are this app's own network/parse-failure codes (mirroring
// the shape of the old LICENCE_FETCH_FAILED, one per new network call). The rest are a DELIBERATE
// SUBSET of the real backend's own `FlambeauErrorCode` (reading-session.ts) — only the ones a
// caller here can actually act on differently get their own `DownloadError` member; the others
// (VALIDATION_FAILED, UNAUTHENTICATED, TOKEN_EXPIRED, FORBIDDEN_SCOPE,
// FORBIDDEN_INSTITUTION_MISMATCH, NOT_FOUND, NO_COPIES_AVAILABLE, LOAN_NOT_ACTIVE, OFFER_EXPIRED)
// fall back to the generic LOAN_FAILED/SESSION_FETCH_FAILED with the real `FlambeauError` attached
// as `cause` — nothing is silently swallowed, see readingSessionClient.ts.

export enum DownloadError {
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INSUFFICIENT_STORAGE = 'INSUFFICIENT_STORAGE',
  BOOK_LIMIT_REACHED = 'BOOK_LIMIT_REACHED',
  LICENCE_FETCH_FAILED = 'LICENCE_FETCH_FAILED',
  ASSET_FETCH_FAILED = 'ASSET_FETCH_FAILED',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  // The book's decrypted size would exceed contentStore.ts's MAX_DECRYPTED_BYTES RAM budget, so
  // it could never be opened after download. Rejected BEFORE store() rather than after: a stored
  // oversized book burns one of the 5 offline slots and throws on every later decryptBook().
  BOOK_TOO_LARGE = 'BOOK_TOO_LARGE',
  REGISTRATION_FAILED = 'REGISTRATION_FAILED',

  // --- real flambeau contract, added 2026-08-14 ---
  /** POST /api/v1/loans failed at the network/parse level, or returned an error code with no
   * dedicated member below (see the fallback note above). */
  LOAN_FAILED = 'LOAN_FAILED',
  /** POST /api/v1/reading-sessions failed at the network/parse level, or ditto. */
  SESSION_FETCH_FAILED = 'SESSION_FETCH_FAILED',
  /** 403 NO_ENTITLEMENT — this institution/reader has no grant covering this book at all. */
  NO_ENTITLEMENT = 'NO_ENTITLEMENT',
  /** 403 ENTITLEMENT_EXPIRED — the grant has lapsed since it was checked at borrow time. */
  ENTITLEMENT_EXPIRED = 'ENTITLEMENT_EXPIRED',
  /** 403 ENTITLEMENT_SUSPENDED. */
  ENTITLEMENT_SUSPENDED = 'ENTITLEMENT_SUSPENDED',
  /** 403 INSTITUTION_INACTIVE — the institution's own account is suspended. */
  INSTITUTION_INACTIVE = 'INSTITUTION_INACTIVE',
  /** 403 DOWNLOAD_NOT_PERMITTED — an ELITE (copy-limited, online-only) title refused `intent:
   * DOWNLOAD`. `canPersist` on the loan already said so; this is the server enforcing it. */
  DOWNLOAD_NOT_PERMITTED = 'DOWNLOAD_NOT_PERMITTED',
  /** 403 DEVICE_LIMIT_REACHED — this account is already reading on the maximum number of devices. */
  DEVICE_LIMIT_REACHED = 'DEVICE_LIMIT_REACHED',
  /** 409 NO_ACTIVE_LOAN — a reading session was requested before borrowing (should not surface in
   * practice, since `downloadManager.ts`/`readingSessionClient.ts` always borrow first). */
  NO_ACTIVE_LOAN = 'NO_ACTIVE_LOAN',
  /** 409 CONTENT_NOT_READY — ingest hasn't finished on the server side yet. */
  CONTENT_NOT_READY = 'CONTENT_NOT_READY',
}

export class DownloadFailure extends Error {
  readonly code: DownloadError;
  readonly bookId: string | null;
  readonly cause?: unknown;

  constructor(code: DownloadError, bookId: string | null, cause?: unknown) {
    super(`${code}${bookId ? ` for ${bookId}` : ''}`);
    this.name = 'DownloadFailure';
    this.code = code;
    this.bookId = bookId;
    this.cause = cause;
    // Preserve the prototype chain under downlevel targets so `instanceof` holds — same fix
    // ContentFailure applies, for the same reason.
    Object.setPrototypeOf(this, DownloadFailure.prototype);
  }
}
