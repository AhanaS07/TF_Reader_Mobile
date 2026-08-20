// Owner: Download (Abhinav).
//
// Real flambeau contract client — `POST /api/v1/loans` (borrow) and `POST /api/v1/reading-sessions`
// (permission to fetch bytes right now), replacing `contentLicenceClient.ts`'s
// `fetchContentLicence` as the primary flow. See `src/shared/contracts/reading-session.ts`'s
// header for the full loan-vs-session distinction and why a loan step exists here at all with no
// borrow UI anywhere in this repo.
//
// `fetchEncryptedAsset` is NOT duplicated here — it's generic over (bookId, url) and has no
// dependency on the OLD `ContentLicenceResponse` shape, so it's re-exported from
// `contentLicenceClient.ts` unchanged (including its `reachableAssetUrl` localhost-rewrite, which
// applies identically to a `SignedUrl.url` from this new flow).
//
// Both functions throw `DownloadFailure`, never a bare fetch/TypeError or a raw `FlambeauError` —
// same rule `contentLicenceClient.ts` follows, so `downloadManager.ts` (and any future caller)
// only ever switches on `.code`.

import type { BookId, BorrowRequest, Loan, ReadingFormat, ReadingSessionRequest, ReadingSessionResponse, FlambeauError } from '@/shared/contracts';
import { generateDeviceKeypair, publicKeyToRawBase64 } from '../encryption/deviceKeypair';
import { API_BASE_URL } from './config';
import { DownloadError, DownloadFailure } from './errors';

export { fetchEncryptedAsset } from './contentLicenceClient';

// React Native's `fetch` has no default timeout: a host that accepts the TCP connection and then
// never answers (dead proxy, captive portal, a firewall silently dropping packets) leaves `await
// fetch(...)` pending forever, and the fail-open catch in `verifyReadingAccess` below can only run
// once the call actually rejects. Same value and same abort-controller-plus-timer shape as
// `sync/syncApi.ts`'s `request()` (`REQUEST_TIMEOUT_MS` in `sync/syncConfig.ts`) — not imported
// from there, since `sync/` and `download/` are separately owned modules with their own configs
// (see `config.ts`'s header on why `download/` never reaches into `sync/config.ts`).
const REQUEST_TIMEOUT_MS = 8000;

// A DELIBERATE SUBSET of FlambeauErrorCode gets its own DownloadError member (errors.ts) — only
// the ones a caller here can react to differently. Everything else falls back to the generic
// per-endpoint code with the real FlambeauError attached as `cause`, so nothing is silently lost.
const LOAN_ERROR_CODE_MAP: Partial<Record<FlambeauError['code'], DownloadError>> = {
  NO_ENTITLEMENT: DownloadError.NO_ENTITLEMENT,
  ENTITLEMENT_EXPIRED: DownloadError.ENTITLEMENT_EXPIRED,
  ENTITLEMENT_SUSPENDED: DownloadError.ENTITLEMENT_SUSPENDED,
  INSTITUTION_INACTIVE: DownloadError.INSTITUTION_INACTIVE,
  // Promoted per API_CONTRACT_NOTES.md B10 — on the LOAN map (not just SESSION's) since either
  // endpoint can fail auth once auth exists (B1), and SESSION_ERROR_CODE_MAP spreads this map in.
  UNAUTHENTICATED: DownloadError.UNAUTHENTICATED,
  TOKEN_EXPIRED: DownloadError.TOKEN_EXPIRED,
  // 409 on borrow only, but harmless to include here even before it's reachable from a session.
  NO_COPIES_AVAILABLE: DownloadError.NO_COPIES_AVAILABLE,
};

const SESSION_ERROR_CODE_MAP: Partial<Record<FlambeauError['code'], DownloadError>> = {
  ...LOAN_ERROR_CODE_MAP,
  DOWNLOAD_NOT_PERMITTED: DownloadError.DOWNLOAD_NOT_PERMITTED,
  DEVICE_LIMIT_REACHED: DownloadError.DEVICE_LIMIT_REACHED,
  NO_ACTIVE_LOAN: DownloadError.NO_ACTIVE_LOAN,
  CONTENT_NOT_READY: DownloadError.CONTENT_NOT_READY,
};

// Reads the real Error envelope (reading-session.ts's FlambeauError) off a non-ok response, if the
// body is shaped that way. Deliberately tolerant: a malformed/empty error body must not throw a
// SECOND, confusing error out of this helper — it just means the map lookup below misses and the
// caller gets the generic fallback code instead, with whatever we could parse (or nothing) as cause.
async function tryParseFlambeauError(response: Response): Promise<FlambeauError | null> {
  try {
    const body = (await response.json()) as unknown;
    if (body && typeof body === 'object' && 'code' in body) {
      return body as FlambeauError;
    }
  } catch {
    // not JSON, or not this shape — fall through to null.
  }
  return null;
}

/**
 * `POST /api/v1/loans` — take possession of a title. Idempotent by the real contract's own design:
 * a reader who already holds this title gets 200 with the existing loan, not an error.
 *
 * Called by `downloadManager.ts` as the FIRST step of every download, silently — this repo has no
 * borrow UI/screen anywhere (see reading-session.ts's header for why that's a pragmatic stand-in,
 * not a claim that Download owns borrowing).
 */
export async function borrowLoan(bookId: BookId): Promise<Loan> {
  const body: BorrowRequest = { itemId: bookId };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new DownloadFailure(DownloadError.LOAN_FAILED, bookId, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const flambeauError = await tryParseFlambeauError(response);
    const mapped = flambeauError ? LOAN_ERROR_CODE_MAP[flambeauError.code] : undefined;
    throw new DownloadFailure(
      mapped ?? DownloadError.LOAN_FAILED,
      bookId,
      flambeauError ?? new Error(`POST /api/v1/loans responded ${response.status}`),
    );
  }

  return (await response.json()) as Loan;
}

/**
 * `POST /api/v1/reading-sessions` — permission to fetch bytes right now (~5 minutes). Re-checks
 * entitlement every single call, by design (the real contract's own words: "a subscription can
 * lapse between [borrow and read], and the second check is the only thing standing between a
 * revoked institution and a decryption key").
 *
 * @param intent - 'DOWNLOAD' persists the asset locally; refused server-side for ELITE regardless
 *   of what the caller asked for. 'STREAM' is the lighter-weight "just let me read this now" check
 *   — used for the per-open re-verification of an already-downloaded book (see ReaderScreen.tsx).
 */
export async function openReadingSession(
  bookId: BookId,
  request: Omit<ReadingSessionRequest, 'itemId'>,
): Promise<ReadingSessionResponse> {
  const body: ReadingSessionRequest = { itemId: bookId, ...request };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/reading-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new DownloadFailure(DownloadError.SESSION_FETCH_FAILED, bookId, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const flambeauError = await tryParseFlambeauError(response);
    const mapped = flambeauError ? SESSION_ERROR_CODE_MAP[flambeauError.code] : undefined;
    throw new DownloadFailure(
      mapped ?? DownloadError.SESSION_FETCH_FAILED,
      bookId,
      flambeauError ?? new Error(`POST /api/v1/reading-sessions responded ${response.status}`),
    );
  }

  return (await response.json()) as ReadingSessionResponse;
}

// Fail-open / fail-closed policy for verifyReadingAccess below. The real contract's own design
// conversation doesn't resolve what a per-open call should do with NO network — flagged as an
// open question in this directory's `API_CONTRACT_NOTES.md` (`B7`: "call on every open doesn't
// say what happens reopening an already-downloaded book offline") — so this is a deliberate,
// documented choice, not an oversight. A reader must not lose access to a book already sitting on their
// device just because they're offline right now, or because this mock backend's in-memory loan
// state didn't survive a restart. Fail CLOSED only for the codes that mean the server explicitly,
// successfully told us this reader cannot proceed: genuine access revocations (NO_ENTITLEMENT,
// ENTITLEMENT_EXPIRED, ENTITLEMENT_SUSPENDED, INSTITUTION_INACTIVE) AND device-limit concurrency
// refusals (DEVICE_LIMIT_REACHED — reader is already reading on the max number of devices, so
// THIS device cannot read right now). See API_CONTRACT_NOTES.md B7. Never fail closed for
// network-level failures, and never for NO_ACTIVE_LOAN/CONTENT_NOT_READY (state-not-found reads
// as "can't confirm", not "confirmed denied").
const FAIL_CLOSED_CODES: ReadonlySet<DownloadError> = new Set([
  DownloadError.NO_ENTITLEMENT,
  DownloadError.ENTITLEMENT_EXPIRED,
  DownloadError.ENTITLEMENT_SUSPENDED,
  DownloadError.INSTITUTION_INACTIVE,
  DownloadError.DEVICE_LIMIT_REACHED,
]);

/**
 * Per-book-OPEN access re-verification — NOT per-download. This is the real contract's own
 * headline behavior (reading-session.ts's header): "entitlement is re-checked... because a
 * subscription can lapse between borrow and read." Requests a lightweight `'STREAM'` session
 * (never `'DOWNLOAD'` — this never persists anything, it only asks "am I still allowed to read
 * this right now").
 *
 * Called from `readerAssets.ts`'s `getBookBase64()`, ahead of every decrypt — including for a
 * book already fully downloaded and stored. FAILS OPEN for anything that isn't an explicit
 * server-side denial (see `FAIL_CLOSED_CODES` above): resolves silently, allowing the read to
 * proceed against the already-persisted ciphertext exactly as before this existed. REJECTS for
 * codes in `FAIL_CLOSED_CODES` — that set includes genuine access revocations (NO_ENTITLEMENT,
 * ENTITLEMENT_EXPIRED, ENTITLEMENT_SUSPENDED, INSTITUTION_INACTIVE) AND DEVICE_LIMIT_REACHED
 * (reader is at their device limit on *this* device, a concurrency refusal not a revocation, but
 * still fail-closed: this device cannot read right now). See API_CONTRACT_NOTES.md B7 for the
 * rationale — the caller should treat a DEVICE_LIMIT_REACHED as fatal to this per-open attempt.
 */
export async function verifyReadingAccess(bookId: BookId, format: ReadingFormat): Promise<void> {
  try {
    // Deliberately INSIDE the try, not above it: this fails open on the same terms as the
    // network call below. Found in review — with this call outside the try, a keychain hiccup
    // (device just booted and not yet unlocked, or `generateDeviceKeypair`'s own "keychain
    // rejected storing the private key" throw on a first-ever call) escaped uncaught, turning a
    // transient local error into "I lost my book" for content already sitting on the device —
    // exactly the harm this function's fail-open policy exists to prevent.
    const { publicKey } = await generateDeviceKeypair();
    await openReadingSession(bookId, {
      format,
      intent: 'STREAM',
      devicePublicKey: publicKeyToRawBase64(publicKey),
      wantSearchIndex: false,
    });
  } catch (cause) {
    if (cause instanceof DownloadFailure && FAIL_CLOSED_CODES.has(cause.code)) {
      throw cause;
    }
    // Fail open — see the policy comment above. Logged, not swallowed silently, so a genuinely
    // unreachable backend is still visible somewhere.
    console.warn(
      `readingSessionClient: per-open access re-verification failed for ${bookId}, allowing the read (fail-open)`,
      cause,
    );
  }
}
