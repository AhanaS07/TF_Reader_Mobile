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
