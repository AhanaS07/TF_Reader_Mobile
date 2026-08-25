// Owner: Download (Abhinav).
//
// Unified license gate — the single entry point for both Open and Download. Every
// book-reading action starts here, then diverges on whether it persists:
//
//   checkLicense(bookId, format, 'STREAM')   → openBook.ts  (ephemeral, nothing saved)
//   checkLicense(bookId, format, 'DOWNLOAD') → downloadBook  (persists licence + ciphertext)
//
// ONE CALL, NOT TWO: this used to borrow a loan (`POST /api/v1/loans`) before opening a session.
// The real backend has no such endpoint (confirmed: `POST /api/v1/loans` 405s — only `GET`, a
// list, is mapped; see `reading-session.ts`'s header, D-020). `licenceModel`/`canPersist`/
// `licenceId` now come straight off `openReadingSession()`'s response, so there is nothing left
// to borrow first. `synthesiseLicence()` below reads all of it off the session.
//
// Network vs explicit denial (readingSessionClient.ts's own distinction): a mapped
// FlambeauError code (via SESSION_ERROR_CODE_MAP) means the server answered and said no; the
// generic SESSION_FETCH_FAILED fallback means the request never got a structured response at all
// (timeout, DNS, offline). Only the latter triggers the offline fallback.

import type { BookId, ContentFormat, ReadingSessionResponse, SignedLicence } from '@/shared/contracts';
import { generateDeviceKeypair, publicKeyToRawBase64, publicKeyFingerprint } from '../encryption/deviceKeypair';
import { getPersistedLicenceStatus, invalidateLicence } from '../encryption/contentStore';
import { verifyLicenceSignature } from '../encryption/licenceSignature';
import { openReadingSession } from './readingSessionClient';
import { DownloadError, DownloadFailure, UnmappedServerResponse } from './errors';
import { downloadStore } from '../sync/stores/downloadStore';

// Far-future placeholder for `expiresAt` — covers both open-access (no real due date) and
// subscription (no real due date from the backend, confirmed: `GET /api/v1/loans` returns
// `dueAt: null` for every seeded loan). This will be replaced by a real date once the backend
// publishes one; until then, the 4-day offline cap (computeOfflineLicenceExpiry) provides the
// actual bound for previously-downloaded books.
const FAR_FUTURE_PLACEHOLDER = '9999-12-31T23:59:59.000Z';

// ── result types ──────────────────────────────────────────────────────────

export type LicenseCheckResult =
  | { ok: false; reason: DownloadError }
  // `session`/`licence` are present when this came from a live reading-session call, absent when
  // it came from the offline fallback for a previously-downloaded open-access book (no network
  // call was made — see offlineFallback's own open-access branch). A caller that needs a live
  // session (downloadBook) must check for its presence; openBook.ts never needs to, because it
  // checks contentStore.isAvailableOffline() first and that is guaranteed true whenever this
  // variant lacks a session.
  | { ok: true; mode: 'open-access'; session?: ReadingSessionResponse; licence?: SignedLicence }
  | { ok: true; mode: 'online'; session: ReadingSessionResponse; licence: SignedLicence }
  | { ok: true; mode: 'offline-license'; licence: SignedLicence };

// ── helpers ───────────────────────────────────────────────────────────────

function isGenuineNetworkError(error: DownloadFailure): boolean {
  // LOAN_FAILED / SESSION_FETCH_FAILED cover BOTH genuine network errors (fetch/AbortController
  // rejected before any Response arrived) AND server responses that weren't shaped as a
  // FlambeauError (a 404 with a plain HTML body, a 500 with no JSON at all — see
  // readingSessionClient.ts's UnmappedServerResponse). Only the former should trigger the offline
  // fallback — a server that actually answered (even with an error) is reachable, and falling
  // back to a stale local licence would mask a real server-side problem.
  //
  // NOT narrowed to `error.cause instanceof TypeError` (what the Fetch spec documents for a
  // network-level rejection) — that used to be the check here, and device testing (2026-08-25)
  // found it unreliable: a genuine connection-refused on a real iOS simulator did not reliably
  // produce that exact constructor, so a real "book is downloaded, server is unreachable, open it
  // offline" case silently fell through to the explicit-denial branch instead of the fallback.
  // `UnmappedServerResponse` is the one shape that positively means "reached the server" — every
  // other Error reaching here means the request never got a response at all, regardless of which
  // concrete Error subclass the platform's fetch implementation happened to throw.
  if (error.code !== DownloadError.LOAN_FAILED && error.code !== DownloadError.SESSION_FETCH_FAILED) {
    return false;
  }
  return error.cause instanceof Error && !(error.cause instanceof UnmappedServerResponse);
}

// The real backend exposes no long-term loan due-date anywhere (confirmed: `GET /api/v1/loans`
// returns `dueAt: null` for every seeded loan) — only the session's own ~5-minute `expiresAt`,
// which must never gate an offline reopen weeks later (reading-session.ts's header). So the
// server-shipped `expiresAt` on the synthesised licence is a far-future placeholder until the
// backend adds a real one. The actual offline bound is computed separately by
// `computeOfflineLicenceExpiry()` below — the licence is synthesised with the placeholder, and
// the 4-day cap is applied at open-time, not at synthesis-time.
function synthesiseLicence(
  session: ReadingSessionResponse,
  deviceKeyFingerprint: string,
  intent: 'STREAM' | 'DOWNLOAD',
): SignedLicence {
  return {
    licenceId: session.licenceId ?? session.sessionId,
    itemId: session.itemId,
    keyFingerprint: deviceKeyFingerprint,
    expiresAt: FAR_FUTURE_PLACEHOLDER,
    canPersist: session.canPersist ?? true,
    rights: { print: intent === 'DOWNLOAD' },
    signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },
  };
}

// 4-day offline licence cap: the maximum time a previously-downloaded book can be opened without
// contacting the server. Computed at OPEN time (not at download time) as:
//   min(now + 4 days, candidateExpiry)
//
// `candidateExpiry` is the licence's own `expiresAt` — a real due-date from the backend, once one
// exists. Today it is always the FAR_FUTURE_PLACEHOLDER, so the result is always `now + 4 days`.
// When the backend starts publishing real due dates, the cap naturally shortens to whichever
// comes first: the server's own expiry, or 4 days from the last successful open.
const OFFLINE_LICENCE_TTL_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

export function computeOfflineLicenceExpiry(candidateExpiry: string): Date {
  const now = Date.now();
  const candidateMs = new Date(candidateExpiry).getTime();
  if (Number.isNaN(candidateMs)) {
    // Malformed expiry — fall back to the 4-day window (fail-open on date parsing, fail-closed
    // on the licence itself: the 4-day cap still applies).
    return new Date(now + OFFLINE_LICENCE_TTL_MS);
  }
  const fourDaysFromNow = now + OFFLINE_LICENCE_TTL_MS;
  return new Date(Math.min(fourDaysFromNow, candidateMs));
}

// ── main gate ─────────────────────────────────────────────────────────────

/**
 * Unified license check — the first call for both Open and Download. Handles
 * session → key-fingerprint → licence-synthesis, and falls back to a persisted
 * local licence when the network is unreachable. No separate borrow step — see
 * this file's header.
 *
 * @param intent - `'STREAM'` for Open (nothing persists), `'DOWNLOAD'` for Download. Sent to the
 *   server AS REQUESTED — an ELITE title refuses `'DOWNLOAD'` server-side with
 *   `DOWNLOAD_NOT_PERMITTED` (a `FAIL_CLOSED_CODES` member), which `downloadBook()` surfaces as a
 *   real failure rather than silently reading it instead. There is no client-side downgrade
 *   anymore: with no borrow step, `canPersist` isn't known until this call already returns, so
 *   there is nothing to downgrade based on beforehand. A caller that wants ELITE content should
 *   use `openBook()` (`'STREAM'`), which is exactly the seam this design added it for.
 * @returns `ok: false` with a `reason` code the caller should throw, or `ok: true`
 *   with everything the caller needs to proceed (session, synthesised licence).
 */
export async function checkLicense(
  bookId: BookId,
  format: ContentFormat,
  intent: 'STREAM' | 'DOWNLOAD',
): Promise<LicenseCheckResult> {
  const { publicKey } = await generateDeviceKeypair();
  const devicePublicKey = publicKeyToRawBase64(publicKey);
  const deviceKeyFingerprint = await publicKeyFingerprint(publicKey);

  let session: ReadingSessionResponse;
  try {
    session = await openReadingSession(bookId, {
      format,
      intent,
      devicePublicKey,
      wantSearchIndex: true,
    });
  } catch (error) {
    if (error instanceof DownloadFailure && isGenuineNetworkError(error)) {
      // Genuine network unreachable — fall through to the offline fallback below. Server errors
      // (404/500 with a non-Flambeau body) are NOT routed here; those mean the server is
      // reachable but the request was bad, and masking that with a stale local licence would
      // hide a real problem.
      return offlineFallback(bookId);
    }
    if (error instanceof DownloadFailure) {
      // Explicit denial — the server answered and said no, so fail immediately rather than
      // fall back to a stale local licence. Includes DOWNLOAD_NOT_PERMITTED (see this function's
      // own doc comment for why an ELITE + 'DOWNLOAD' request lands here instead of being
      // silently downgraded).
      return { ok: false, reason: error.code };
    }
    throw error;
  }

  // ── anti-key-substitution check ──────────────────────────────────────────

  if (session.encryption && session.encryption.keyFingerprint !== deviceKeyFingerprint) {
    return {
      ok: false,
      reason: DownloadError.KEY_SUBSTITUTION,
    };
  }

  // ── synthesise licence ────────────────────────────────────────────────────

  const licence = synthesiseLicence(session, deviceKeyFingerprint, intent);

  // ── verify licence signature (stub — always true today) ──────────────────

  if (!verifyLicenceSignature(licence)) {
    return { ok: false, reason: DownloadError.KEY_SUBSTITUTION };
  }

  // Branch AFTER the call, not before — the real backend puts `licenceModel` on the session
  // response itself now, so there is no separate check to do earlier (see this file's header).
  if (session.licenceModel === 'OPEN_ACCESS') {
    return { ok: true, mode: 'open-access', session, licence };
  }

  return { ok: true, mode: 'online', session, licence };
}

// ── offline fallback ──────────────────────────────────────────────────────

/**
 * Offline fallback — only produces a result for a PREVIOUSLY DOWNLOADED book.
 * A valid persisted licence already guarantees the content is on disk (licence and
 * content are written together by contentStore.store()).
 *
 * This function does TWO things the server would normally do:
 * 1. Checks `is_valid` (the pull-based revocation signal) — if false, the entitlement has been
 *    administratively revoked server-side, and the local copy must be invalidated (licence + BEK
 *    destroyed, ciphertext left on disk). This is distinct from expiry: revocation is immediate
 *    and discretionary; expiry is a natural lapse.
 * 2. Applies the 4-day offline cap (`computeOfflineLicenceExpiry`) — even if the licence's own
 *    `expiresAt` is a far-future placeholder, the offline window is bounded to 4 days from the
 *    last successful open.
 */
async function offlineFallback(bookId: BookId): Promise<LicenseCheckResult> {
  const { licence, expired, downloaded, revoked } = await getPersistedLicenceStatus(bookId);

  if (!downloaded) {
    return { ok: false, reason: DownloadError.OFFLINE_LICENSE_UNAVAILABLE };
  }

  // Post-revocation: the licence was stripped by invalidateLicence() on a previous open when
  // the server signalled is_valid = false. Ciphertext is still on disk but the licence + BEK
  // are gone — the book cannot be decrypted. A fresh online open with a valid licence can
  // re-attach rights and re-wrap the BEK.
  if (revoked) {
    return { ok: false, reason: DownloadError.ENTITLEMENT_REVOKED };
  }

  // Open access persists with `licence: null` (no key material to protect) — a downloaded
  // open-access book has no expiry to check and no signature to verify. Route it through the
  // same 'open-access' mode the online path uses, minus `session`/`licence` — no network call
  // was made, so there is nothing to attach. openBook.ts's 'open-access' case reads the local
  // copy straight off disk via contentStore.isAvailableOffline() and never needs either field;
  // downloadBook() rejects this variant outright (a download needs a live session).
  if (!licence) {
    return { ok: true, mode: 'open-access' };
  }

  // Pull-based revocation check: is_valid is an advisory signal from the server's last pull.
  // If false, the entitlement has been revoked — destroy licence + BEK locally, leaving the
  // ciphertext on disk (a fresh online open with a new licence can re-encrypt the BEK).
  const isValid = await downloadStore.isBookValid(bookId);
  if (!isValid) {
    await invalidateLicence(bookId);
    return { ok: false, reason: DownloadError.ENTITLEMENT_REVOKED };
  }

  if (!verifyLicenceSignature(licence)) {
    return { ok: false, reason: DownloadError.OFFLINE_LICENSE_UNAVAILABLE };
  }

  if (expired) {
    return { ok: false, reason: DownloadError.ENTITLEMENT_EXPIRED };
  }

  // 4-day offline cap: even if the licence's own expiresAt is a far-future placeholder, the
  // offline window is bounded. This is the only place the cap is applied — the synthesised
  // licence carries the placeholder, and the real bound is checked here at open-time.
  const offlineExpiry = computeOfflineLicenceExpiry(licence.expiresAt);
  if (Date.now() >= offlineExpiry.getTime()) {
    return { ok: false, reason: DownloadError.ENTITLEMENT_EXPIRED };
  }

  return { ok: true, mode: 'offline-license', licence };
}
