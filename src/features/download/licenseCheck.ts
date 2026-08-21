// Owner: Download (Abhinav).
//
// Unified license gate — the single entry point for both Open and Download. Every
// book-reading action starts here, then diverges on whether it persists:
//
//   checkLicense(bookId, format, 'STREAM')   → openBook.ts  (ephemeral, nothing saved)
//   checkLicense(bookId, format, 'DOWNLOAD') → downloadBook  (persists licence + ciphertext)
//
// Both paths share the same borrow → session → key-fingerprint → licence-synthesis sequence.
// The inline copy in downloadManager.ts is being REPLACED by calls into this file — the
// synthesis happens exactly once, here, not twice.
//
// Network vs explicit denial (readingSessionClient.ts's own distinction): a mapped
// FlambeauError code (via LOAN_ERROR_CODE_MAP / SESSION_ERROR_CODE_MAP) means the server
// answered and said no; the generic LOAN_FAILED / SESSION_FETCH_FAILED fallback means the
// request never got a structured response at all (timeout, DNS, offline). Only the latter
// triggers the offline fallback — no new classification logic needed.

import type { BookId, ContentFormat, Loan, ReadingSessionResponse, SignedLicence } from '@/shared/contracts';
import { generateDeviceKeypair, publicKeyToRawBase64, publicKeyFingerprint } from '../encryption/deviceKeypair';
import { getPersistedLicenceStatus } from '../encryption/contentStore';
import { verifyLicenceSignature } from '../encryption/licenceSignature';
import { borrowLoan, openReadingSession, FAIL_CLOSED_CODES } from './readingSessionClient';
import { DownloadError, DownloadFailure } from './errors';

const OPEN_ACCESS_LICENCE_EXPIRES_AT = '9999-12-31T23:59:59.000Z';

// ── result types ──────────────────────────────────────────────────────────

export type LicenseCheckResult =
  | { ok: false; reason: DownloadError }
  | { ok: true; mode: 'open-access'; loan: Loan }
  | { ok: true; mode: 'online'; loan: Loan; session: ReadingSessionResponse; licence: SignedLicence }
  | { ok: true; mode: 'offline-license'; loan: Loan; licence: SignedLicence };

// ── helpers ───────────────────────────────────────────────────────────────

function isGenuineNetworkError(error: DownloadFailure): boolean {
  // LOAN_FAILED / SESSION_FETCH_FAILED cover BOTH genuine network errors (fetch rejected
  // with a TypeError — DNS failure, timeout, offline) AND server responses that weren't
  // shaped as a FlambeauError (a 404 with a plain HTML body, a 500 with no JSON at all).
  // Only the former should trigger the offline fallback — a server that actually answered
  // (even with an error) is reachable, and falling back to a stale local licence masks a
  // real server-side problem. TypeError is what fetch() throws on network-level failure.
  return (
    (error.code === DownloadError.LOAN_FAILED || error.code === DownloadError.SESSION_FETCH_FAILED) &&
    error.cause instanceof TypeError
  );
}

// A book with no `dueAt` (open access) needs a far-future placeholder for the local
// SignedLicence's `expiresAt`. Same value downloadManager.ts has always used.
function synthesiseLicence(
  loan: Loan,
  session: ReadingSessionResponse,
  deviceKeyFingerprint: string,
): SignedLicence {
  return {
    licenceId: session.sessionId,
    itemId: loan.itemId,
    keyFingerprint: deviceKeyFingerprint,
    expiresAt: loan.dueAt ?? OPEN_ACCESS_LICENCE_EXPIRES_AT,
    canPersist: loan.canPersist,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },
  };
}

// ── main gate ─────────────────────────────────────────────────────────────

/**
 * Unified license check — the first call for both Open and Download. Handles
 * borrow → session → key-fingerprint → licence-synthesis, and falls back to a
 * persisted local licence when the network is unreachable.
 *
 * @param intent - `'STREAM'` for Open (nothing persists), `'DOWNLOAD'` for Download.
 * @returns `ok: false` with a `reason` code the caller should throw, or `ok: true`
 *   with everything the caller needs to proceed (loan, session, synthesised licence).
 */
export async function checkLicense(
  bookId: BookId,
  format: ContentFormat,
  intent: 'STREAM' | 'DOWNLOAD',
): Promise<LicenseCheckResult> {
  // ── step 1: borrow ──────────────────────────────────────────────────────

  let loan: Loan;
  try {
    loan = await borrowLoan(bookId);
  } catch (error) {
    if (error instanceof DownloadFailure && isGenuineNetworkError(error)) {
      // Genuine network unreachable (TypeError from fetch) — fall through to the offline
      // fallback below. Server errors (404/500 with a non-Flambeau body) are NOT routed here;
      // those mean the server is reachable but the request was bad, and masking that with a
      // stale local licence would hide a real problem.
      return offlineFallback(bookId);
    }
    // Explicit denial (mapped Flambeau error code) — fail immediately.
    if (error instanceof DownloadFailure) {
      return { ok: false, reason: error.code };
    }
    throw error;
  }

  // ── step 2: open access short-circuit ──────────────────────────────────

  if (loan.licenceModel === 'OPEN_ACCESS') {
    return { ok: true, mode: 'open-access', loan };
  }

  // ── step 3: reading session ─────────────────────────────────────────────

  const { publicKey } = await generateDeviceKeypair();
  const devicePublicKey = publicKeyToRawBase64(publicKey);
  const deviceKeyFingerprint = await publicKeyFingerprint(publicKey);

  // Elite (canPersist: false) refuses DOWNLOAD intent server-side (403 DOWNLOAD_NOT_PERMITTED).
  // Auto-downgrade to STREAM — the caller asked to download, but the loan doesn't allow it,
  // so we stream instead. This preserves the old downloadManager.ts behavior where
  // `loan.canPersist ? 'DOWNLOAD' : 'STREAM'` derived the intent from the loan.
  const effectiveIntent = intent === 'DOWNLOAD' && !loan.canPersist ? 'STREAM' : intent;

  let session: ReadingSessionResponse;
  try {
    session = await openReadingSession(bookId, {
      format,
      intent: effectiveIntent,
      devicePublicKey,
      wantSearchIndex: true,
    });
  } catch (error) {
    if (error instanceof DownloadFailure && isGenuineNetworkError(error)) {
      // Genuine network unreachable after a successful borrow — still fall back to offline.
      return offlineFallback(bookId);
    }
    if (error instanceof DownloadFailure) {
      // Explicit denial — fail closed for FAIL_CLOSED_CODES, propagate for everything else.
      if (FAIL_CLOSED_CODES.has(error.code)) {
        return { ok: false, reason: error.code };
      }
      // Non-fail-closed codes (NO_ACTIVE_LOAN, CONTENT_NOT_READY, unmapped FlambeauError
      // codes, or LOAN_FAILED/SESSION_FETCH_FAILED from a non-TYPE_ERROR cause like a 404
      // with a plain body) — the server responded with something we can't map. Propagate
      // rather than fall back to a stale local licence, which would mask the real problem.
      return { ok: false, reason: error.code };
    }
    throw error;
  }

  // ── step 4: anti-key-substitution check ─────────────────────────────────

  if (session.encryption && session.encryption.keyFingerprint !== deviceKeyFingerprint) {
    return {
      ok: false,
      reason: DownloadError.KEY_SUBSTITUTION,
    };
  }

  // ── step 5: synthesise licence ──────────────────────────────────────────

  const licence = synthesiseLicence(loan, session, deviceKeyFingerprint);

  // ── step 6: verify licence signature (stub — always true today) ─────────

  if (!verifyLicenceSignature(licence)) {
    return { ok: false, reason: DownloadError.KEY_SUBSTITUTION };
  }

  return { ok: true, mode: 'online', loan, session, licence };
}

// ── offline fallback ──────────────────────────────────────────────────────

/**
 * Offline fallback — only produces a result for a PREVIOUSLY DOWNLOADED book.
 * A valid persisted licence already guarantees the content is on disk (licence and
 * content are written together by contentStore.store()).
 */
async function offlineFallback(bookId: BookId): Promise<LicenseCheckResult> {
  const { licence, expired } = await getPersistedLicenceStatus(bookId);

  if (!licence) {
    return { ok: false, reason: DownloadError.OFFLINE_LICENSE_UNAVAILABLE };
  }

  if (!verifyLicenceSignature(licence)) {
    return { ok: false, reason: DownloadError.OFFLINE_LICENSE_UNAVAILABLE };
  }

  if (expired) {
    return { ok: false, reason: DownloadError.ENTITLEMENT_EXPIRED };
  }

  // Build a minimal Loan from the persisted licence so callers that need `loan` (both
  // openBook and downloadBook do) get a consistent shape. The persisted licence has
  // `canPersist` and `expiresAt`, which is all the downstream code actually reads off
  // `loan` — `loan.licenceModel` is only checked in checkLicense itself (step 2 above,
  // before we reach the offline path).
  const offlineLoan: Loan = {
    loanId: licence.licenceId,
    itemId: licence.itemId,
    userId: '',
    licenceModel: 'SUBSCRIPTION',
    status: 'ACTIVE',
    borrowedAt: '',
    canPersist: licence.canPersist,
    serverTime: new Date().toISOString(),
  };

  return { ok: true, mode: 'offline-license', loan: offlineLoan, licence };
}
