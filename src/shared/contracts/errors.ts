// src/shared/contracts/errors.ts
// Content errors — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Reader (Ahana), co-frozen with Encryption (Abhinav).
//
// FAIL-CLOSED. Every code is a hard DENY. The reader shows an error and renders
// NOTHING; it must NEVER fall back to plaintext, a partial buffer, or a stale
// copy. Encodes wokay's three non-negotiable rules (source-of-truth §04):
//   1. Never write plaintext to disk, any tier.
//   2. Never decrypt a partial object — the GCM tag covers the whole ciphertext.
//   3. A failed tag fails LOUDLY — never render whatever came out.
import type { BookId } from '../types/primitives';

// String-valued so the code survives logging / crash reports / the sync wire.
export enum ContentError {
  // GCM tag mismatch: tampered or truncated ciphertext (or wrong nonce split).
  // → rule 3. Do not render. This is the whole reason we chose an AEAD cipher.
  INTEGRITY_FAILED = 'INTEGRITY_FAILED',

  // Decrypt could not complete for a non-integrity reason (bad BEK unwrap,
  // malformed nonce(12)||ct||tag(16) layout, unsupported algorithm).
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',

  // Licence signature (RS256) did not verify, or a required licence is missing.
  // Expiry MUST NOT be trusted before the signature checks out.
  LICENCE_INVALID = 'LICENCE_INVALID',

  // Licence signature is valid but expiresAt has passed. Deny + the wrapped BEK
  // should already be destroyed (see offline-lock / ContentStore.destroy).
  LICENCE_EXPIRED = 'LICENCE_EXPIRED',

  // Device keystore / wrapped BEK unreachable (keychain locked, key evicted,
  // non-exportable private key unavailable). Deny — never proceed without it.
  KEYSTORE_UNAVAILABLE = 'KEYSTORE_UNAVAILABLE',
}

// The CARRIER every ContentStore method rejects with. A bare ContentError enum
// is a string — throwing it loses the stack, fails `instanceof Error`, and
// carries no bookId/cause, so the store and the Reader would drift on the shape.
// Freezing it as an Error subclass fixes all three:
//   - `err instanceof Error` and `instanceof ContentFailure` both hold
//   - `err.code` is the typed, switchable discriminant (ContentError)
//   - `err.bookId` / `err.cause` carry context to the catch site
// This is a real runtime class (see barrel note) — import it as a VALUE, and
// always reject with `new ContentFailure(code, bookId, cause)`, never a raw enum.
export class ContentFailure extends Error {
  readonly code: ContentError;
  readonly bookId: BookId;
  readonly cause?: unknown;

  constructor(code: ContentError, bookId: BookId, cause?: unknown) {
    super(`${code} for ${bookId}`);
    this.name = 'ContentFailure';
    this.code = code;
    this.bookId = bookId;
    this.cause = cause;
    // Preserve the prototype chain under downlevel targets so `instanceof` holds.
    Object.setPrototypeOf(this, ContentFailure.prototype);
  }
}

/**
 * Format any error (including ContentFailure, DownloadFailure, or generic Error) into a
 * human-readable diagnostic message that surfaces the underlying cause.
 */
export function formatDiagnosticErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';

  const cause = (error as { cause?: unknown }).cause;
  const code = (error as { code?: string }).code;
  const causeRecord =
    cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : null;
  const causeCode = typeof causeRecord?.code === 'string' ? causeRecord.code : '';
  const causeMsg =
    cause instanceof Error
      ? cause.message
      : typeof causeRecord?.message === 'string'
        ? causeRecord.message
        : cause
          ? String(cause)
          : '';

  if (code && causeMsg) {
    return `${code}${causeCode ? ` (${causeCode})` : ''}: ${causeMsg}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  // A STRUCTURED ERROR OBJECT that is not a throwable — `{ code, message }` shapes parsed off a
  // wire, of which the reader bridge's `ReaderError` is one. Without this it falls to `String(error)`
  // below and renders as "[object Object]" in whatever UI shows it, which is exactly what happened
  // to ReaderScreen's error banner. Checked AFTER `instanceof Error` so a real Error's own message
  // still wins, and after the code+cause branch so richer detail is preferred when present.
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message !== '') {
    return code ? `${code}: ${message}` : message;
  }

  return String(error);
}
