// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 3 + Phase 4 items 1/3/4: the download skeleton's single entry point.
// Permission -> storage -> 5-book limit -> borrow a loan -> open a reading session -> resolve the
// encrypted asset -> reject if the decrypted size would exceed contentStore's RAM budget
// (MAX_DECRYPTED_BYTES, BOOK_TOO_LARGE) -> best-effort fetch the encrypted search index, if the
// session has one -> hand the bytes to Encryption's store() (never persist plaintext) -> record
// the download locally.
//
// REAL FLAMBEAU CONTRACT (2026-08-14) — this file now calls `readingSessionClient.ts`'s
// `borrowLoan`/`openReadingSession` (team flambeau's real, published `POST /api/v1/loans` +
// `POST /api/v1/reading-sessions`), NOT `contentLicenceClient.ts`'s `fetchContentLicence` (the
// old mock-shaped `GET /books/:id/content-licence`) — that function, and `ContentLicenceResponse`
// (content-licence.ts), are left fully in place and still exported/tested, just no longer called
// from here. See `src/shared/contracts/reading-session.ts`'s header for the full loan-vs-session
// distinction and why a loan step exists here (no borrow UI/screen exists anywhere in this repo —
// this function borrows on the caller's behalf, silently, as a pragmatic stand-in).
//
// `format` is a NEW required parameter (default 'EPUB' so every pre-existing call site — tests
// included — keeps compiling and behaving identically): the real request needs it up front
// (`ReadingSessionRequest.format`), unlike the old mock, which told the CLIENT the format instead
// of asking for it — there is no catalogue/browse step anywhere in this repo to source it from
// otherwise.
//
// INTENT IS DERIVED FROM THE LOAN, NOT HARDCODED TO 'DOWNLOAD': `loan.canPersist` (from the
// borrow step, BEFORE the reading session) decides `intent: 'DOWNLOAD'` vs `intent: 'STREAM'`.
// Hardcoding `'DOWNLOAD'` would make every ELITE (online-only, canPersist:false) book's read
// attempt fail outright with `403 DOWNLOAD_NOT_PERMITTED` — the real backend refuses that intent
// for ELITE unconditionally — which would remove Elite readability entirely (the old mock never
// refused anything; `contentStore.store()` already handles `canPersist:false` gracefully by not
// persisting). Requesting `'STREAM'` for an ELITE loan instead keeps that path working exactly as
// before: the bytes still get fetched and handed to `contentStore.store()`, which still declines
// to write anything to disk/keychain for it, same as always.
//
// CHECKSUM: the real `ReadingSessionResponse` carries no checksum field at all — GCM's own
// authentication tag (checked at decrypt time) is the integrity guarantee, not a separate SHA-256
// (see this directory's `API_CONTRACT_NOTES.md`, `B_ok4`). `verifyChecksum`/`bytesToHex` stay
// defined and EXPORTED below (not deleted, not orphaned-and-unused) for a caller that ever gets a
// checksum from a future response shape, but nothing here calls them today.
//
// `cipherLength`/`originalLength` now arrive directly on `content` (`SignedUrl`) instead of being
// derived — `computeOriginalLength` is kept and used as a defense-in-depth CROSS-CHECK against
// the server-supplied value instead, matching `content-provider.ts`'s own stated philosophy for
// `EncryptedPackage` ("REDUNDANT BY DESIGN, so the redundancy is made safe rather than removed").
//
// Uses `downloadTable` (the general primitive `downloadRepository.ts` is built on), NOT
// `downloadRepository`'s own convenience methods (list/currentForBook/recordCompleted) — those
// are hardcoded to sync/syncConfig.ts's single fixed BOOK_ID, a prototype shortcut that can't count
// across DIFFERENT books. downloadTable already supports multiple books; the wrapper just wasn't
// built for this case. See docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md.
//
// CHUNKED + RESUMABLE MAIN ASSET FETCH (added 2026-08-18): the main asset — the one that can
// actually be tens of megabytes — now goes through `chunkedAssetFetcher.ts`'s
// `fetchEncryptedAssetChunked` instead of the old single-`fetch()` `fetchEncryptedAsset`. Same
// RAM budget (`MAX_DECRYPTED_BYTES`) enforced, just earlier: converted to a ciphertext-byte
// ceiling and checked as soon as the total is known (first chunk, or immediately on a resume),
// before downloading further, in addition to the original post-fetch `BOOK_TOO_LARGE` check kept
// below as a backstop. The 5-book limit is untouched by this — it's checked before any fetch
// starts and re-checked under the write lock at the end, exactly as before; chunking only changed
// how the BYTES for one book arrive, not the accounting around it. `fetchEncryptedAsset` (plain,
// non-chunked) stays the call for the search index below — much smaller, no resumability need.
// See docs/superpowers/specs/2026-08-17-resumable-chunked-download-scoping.md for the design.
//
// SEARCH INDEX (added 2026-08-14, unchanged by the flambeau migration): `ReadingSessionResponse
// .index` (reading-session.ts) carries an optional `{ url, encrypted, termCount }`. Fetched the
// same way as the main asset and attached to `EncryptedPackage.index`, which contentStore.ts's
// decryptSearchIndex/getIndex already know how to decrypt. A failure fetching the index does NOT
// fail the whole download: contentStore.ts already treats the index as an independent failure
// domain from the book itself ("an index-only integrity failure has no business making the book
// unreadable too" — decryptSearchIndex's own doc comment).

import * as Crypto from 'expo-crypto';
import type { BookId, ContentFormat, EncryptedPackage, SignedLicence } from '@/shared/contracts';
import { contentStore, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { generateDeviceKeypair, publicKeyToRawBase64, publicKeyFingerprint } from '../encryption/deviceKeypair';
import { NONCE_BYTES, GCM_TAG_BYTES } from '../encryption/cipherLayout';
import { downloadTable } from '../sync/stores/downloadStore';
import { withWriteLock } from '../sync/stores/syncableTable';
import { newId, nowIso } from '../sync/localDb/database';
import { USER_ID } from '../sync/syncConfig';
import type { DownloadRow } from '../sync/localDb/types';
import { checkStoragePermission } from './permissions';
import { checkAvailableStorage } from './storageCheck';
import { borrowLoan, openReadingSession, fetchEncryptedAsset } from './readingSessionClient';
import { fetchEncryptedAssetChunked } from './chunkedAssetFetcher';
import { DownloadError, DownloadFailure } from './errors';

export const BOOK_LIMIT = 5;

// A book with no `dueAt` (open access, which never expires per the real contract) needs SOME
// value for the local SignedLicence's required `expiresAt` — contentStore.ts's `isLicenceExpired`
// only ever compares against `Date.now()`, so a far-future placeholder is exactly equivalent to
// "never expires" for every real check, without needing a third, nullable licence shape.
const OPEN_ACCESS_LICENCE_EXPIRES_AT = '9999-12-31T23:59:59.000Z';

// Fallback for `SignedUrl.mimeType`, which is optional on the real spec — `EncryptedPackage
// .mimeType` (content-provider.ts) is NOT optional, so an absent server value needs a real one
// from somewhere. `format` alone can't name an exact audio codec, so AUDIO gets a generic
// container type rather than a guess at a specific one.
const FORMAT_MIME_TYPES: Record<ContentFormat, string> = {
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  AUDIO: 'application/octet-stream',
};

// Exported (not just used internally) so it stays a real, callable utility rather than orphaned
// dead code now that the main flow below no longer calls it — see this file's header.
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Throws BOOK_LIMIT_REACHED iff `bookId` is not already among `rows` AND the cap is full.
// Already-downloaded books don't count twice — re-download/update is allowed at the cap.
function assertBookLimitNotExceeded(bookId: BookId, rows: DownloadRow[]): void {
  const alreadyDownloaded = rows.some((row) => row.book_id === bookId);
  if (!alreadyDownloaded && rows.length >= BOOK_LIMIT) {
    throw new DownloadFailure(
      DownloadError.BOOK_LIMIT_REACHED,
      bookId,
      new Error(`already at the ${BOOK_LIMIT}-book offline limit`),
    );
  }
}

// Exported for the same reason as bytesToHex above — see this file's header ("CHECKSUM:").
export async function verifyChecksum(bookId: BookId, bytes: Uint8Array, expectedHex: string): Promise<void> {
  // `bytes` arrives typed as the bare (ArrayBufferLike-generic) Uint8Array — fetchEncryptedAsset's
  // declared return type (contentLicenceClient.ts, Task 4, not owned by this task) erases the
  // more specific inference its own body would otherwise carry. `Crypto.digest`'s BufferSource
  // param wants the ArrayBuffer-specific variant under TS 6's DOM lib; this is always a real
  // ArrayBuffer at runtime (never a SharedArrayBuffer), so the cast is safe.
  const digestBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as BufferSource);
  const actualHex = bytesToHex(new Uint8Array(digestBuffer));
  if (actualHex.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new DownloadFailure(
      DownloadError.CHECKSUM_MISMATCH,
      bookId,
      new Error(`expected checksum ${expectedHex}, got ${actualHex}`),
    );
  }
}

// Encrypted layout is nonce(12) || ciphertext || tag(16) (cipherLayout.ts) — ciphertext length
// equals plaintext length for AES-GCM, so originalLength is derivable from cipherLength alone,
// with no decrypt needed. Open access ships plaintext directly: cipherLength IS originalLength.
// Used below as a cross-check against the server-supplied value, not to derive it — see this
// file's header ("cipherLength/originalLength now arrive directly...").
export function computeOriginalLength(cipherLength: number, isEncrypted: boolean): number {
  return isEncrypted ? cipherLength - NONCE_BYTES - GCM_TAG_BYTES : cipherLength;
}

export interface DownloadOptions {
  /** Forwarded verbatim to `fetchEncryptedAssetChunked` — see its own doc comment. Only the main
   * asset reports progress; the search index fetch below is small enough that it doesn't need it. */
  onProgress?: (bytesReceived: number, expectedLength: number) => void;
}

export async function downloadBook(
  bookId: BookId,
  format: ContentFormat = 'EPUB',
  options: DownloadOptions = {},
): Promise<void> {
  const hasPermission = await checkStoragePermission();
  if (!hasPermission) {
    throw new DownloadFailure(DownloadError.PERMISSION_DENIED, bookId);
  }
  if (!checkAvailableStorage()) {
    throw new DownloadFailure(DownloadError.INSUFFICIENT_STORAGE, bookId);
  }

  // Loan BEFORE session, always — the real contract's own ordering requirement (reading-session.ts
  // header). `loan.canPersist` (not `licenceModel`) decides whether we ask to persist at all.
  const loan = await borrowLoan(bookId);

  // Fast-fail before spending bandwidth on the asset — NOT the authoritative check (the one that
  // decides whether a row is written is re-run inside the write lock at the bottom of this
  // function). Gated on `loan.canPersist`: an ELITE (STREAM-intent) read never persists anything
  // and never writes a downloads row (see the `withWriteLock` block below), so it must not count
  // against, or be blocked by, the 5-book limit either — found in review (D-18): without this
  // gate, a reader already at the cap on real downloads would get a bogus BOOK_LIMIT_REACHED
  // trying to just READ an ELITE book online, even though doing so would never actually consume a
  // slot. Checking AFTER the loan (rather than before, as this used to) costs one small loan-borrow
  // call on a doomed attempt instead of zero — a proportionate trade against blocking legitimate
  // online-only reads at the cap.
  if (loan.canPersist) {
    assertBookLimitNotExceeded(bookId, await downloadTable.listActive(USER_ID));
  }

  const { publicKey } = await generateDeviceKeypair();
  const devicePublicKey = publicKeyToRawBase64(publicKey);
  const deviceKeyFingerprint = await publicKeyFingerprint(publicKey);

  const session = await openReadingSession(bookId, {
    format,
    intent: loan.canPersist ? 'DOWNLOAD' : 'STREAM',
    devicePublicKey,
    wantSearchIndex: true,
  });

  // Anti-key-substitution check (API_CONTRACT_NOTES.md C7/B3), moved HERE rather than left solely
  // to contentStore.ts's `assertLicenceMatchesPackage()`: `session.encryption.keyFingerprint` is
  // available the instant the session response arrives, so comparing now fails in milliseconds
  // instead of after `fetchEncryptedAsset` has pulled up to 25MB. Also surfaces as a typed
  // `DownloadFailure` at this layer instead of a `ContentFailure` bubbling up from Encryption.
  // contentStore's own check still runs too — kept as defense in depth for any caller that
  // reaches `store()` directly (e.g. `devContentSeed.ts`), not made redundant by this.
  if (session.encryption && session.encryption.keyFingerprint !== deviceKeyFingerprint) {
    throw new DownloadFailure(
      DownloadError.KEY_SUBSTITUTION,
      bookId,
      new Error("encryption.keyFingerprint does not match this device's own key"),
    );
  }

  // Moved up from below the fetch — needed here now to size the chunked fetch's own RAM-budget
  // ceiling (maxCipherBytes) BEFORE requesting a single byte, not just to classify the response
  // afterward. Meaning unchanged from its original spot: session.encryption != null.
  const isEncrypted = session.encryption != null;

  // Chunked + resumable (docs/superpowers/specs/2026-08-17-resumable-chunked-download-scoping.md):
  // MAX_DECRYPTED_BYTES is a budget on the DECRYPTED size; the fetcher deals in ciphertext bytes,
  // which are 28 bytes larger (nonce + tag) for encrypted content and identical for open access/
  // audio. Converting here, once, keeps `chunkedAssetFetcher.ts` ignorant of encryption entirely —
  // it only ever sees "a byte budget", not why that number is what it is.
  const maxCipherBytes = MAX_DECRYPTED_BYTES + (isEncrypted ? NONCE_BYTES + GCM_TAG_BYTES : 0);
  const bytes = await fetchEncryptedAssetChunked(bookId, session.content.url, {
    maxBytes: maxCipherBytes,
    onProgress: options.onProgress,
  });

  // `content.originalLength`/`mimeType` are OPTIONAL on the real spec (reading-session.ts's own
  // header — "test for presence, not length"). Found in review: comparing a real number against
  // an ABSENT field unconditionally made every download reject with a CHECKSUM_MISMATCH that
  // blamed a field the response never carried. Only cross-check when the server actually sent a
  // value; when it didn't, `computeOriginalLength` IS the value, not just a defense-in-depth
  // check against one.
  // Whether this download NEEDS a licence at all — deliberately NOT the same test as `isEncrypted`
  // above. Both contracts agree audio is never encrypted regardless of tier ("Encryption is null
  // for open access and for all audio"), so `encryption == null` means "unencrypted", not "open
  // access, no rights to enforce". Gating the licence on `isEncrypted` (as this used to) made a
  // SUBSCRIPTION or ELITE *audio* book indistinguishable from real open access: `licence` ended up
  // null, `isElite()`/`isLicenceExpired()` (contentStore.ts) both read off `pkg.licence`, and a null
  // licence makes both answer "no restriction" — an Elite audiobook would persist to disk forever
  // instead of staying memory-only, and a Subscription audiobook's local copy would never expire.
  // `loan.licenceModel === 'OPEN_ACCESS'` is the real test for "no rights to attach" — the app
  // already has it on the Loan, from the borrow step, independent of the session's encryption block.
  const needsLicence = loan.licenceModel !== 'OPEN_ACCESS';
  const expectedOriginalLength = computeOriginalLength(bytes.length, isEncrypted);
  if (
    session.content.originalLength !== undefined &&
    session.content.originalLength !== expectedOriginalLength
  ) {
    // The grant's own originalLength disagrees with what the ciphertext length implies — treat
    // this the same as a checksum mismatch would have been: a loud, typed rejection BEFORE
    // store(), never a silent trust of either number alone.
    throw new DownloadFailure(
      DownloadError.CHECKSUM_MISMATCH,
      bookId,
      new Error(
        `content.originalLength (${session.content.originalLength}) disagrees with cipherLength ` +
          `(${bytes.length}) for ${isEncrypted ? 'an encrypted' : 'an open-access'} book — expected ${expectedOriginalLength}`,
      ),
    );
  }

  // Reject an over-budget book BEFORE store(): contentStore.ts enforces MAX_DECRYPTED_BYTES only
  // on the read paths (loadPersisted/decryptBook), so an oversized book would otherwise download
  // "successfully", occupy one of the BOOK_LIMIT offline slots, and then throw on every single
  // attempt to open it. Fail here instead, while nothing has been persisted yet.
  const originalLength = session.content.originalLength ?? expectedOriginalLength;
  if (originalLength > MAX_DECRYPTED_BYTES) {
    throw new DownloadFailure(
      DownloadError.BOOK_TOO_LARGE,
      bookId,
      new Error(
        `book decrypts to ${originalLength} bytes, over contentStore's ${MAX_DECRYPTED_BYTES}-byte ` +
          `RAM budget — it could never be opened, so it is not stored`,
      ),
    );
  }

  let indexBytes: Uint8Array | undefined;
  // `session.index.url` is optional too (reading-session.ts) — `session.index` being present
  // doesn't guarantee a fetchable url came with it under the real spec's "absent means absent"
  // convention, even though every scenario this mock currently returns happens to include one.
  if (session.index?.url) {
    try {
      indexBytes = await fetchEncryptedAsset(bookId, session.index.url);
    } catch (cause) {
      console.warn(
        `downloadManager: failed to fetch search index for ${bookId}, continuing without it`,
        cause,
      );
    }
  }

  // Synthesized locally — the real response has no `licence` field at all (see this file's
  // header). `expiresAt` comes from the LOAN's `dueAt` (the real multi-week offline-reopen
  // window), never from the session's own ~5-minute `expiresAt`. `signature` has no real-backend
  // counterpart; contentStore.ts doesn't verify RS256 today regardless (a pre-existing, documented
  // gap — this placeholder doesn't create a new one).
  const licence: SignedLicence = {
    licenceId: session.sessionId,
    itemId: bookId,
    keyFingerprint: deviceKeyFingerprint, // computed once, above, before the early substitution check
    expiresAt: loan.dueAt ?? OPEN_ACCESS_LICENCE_EXPIRES_AT,
    canPersist: loan.canPersist,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },
  };

  const pkg: EncryptedPackage = {
    bookId,
    format,
    content: bytes,
    index: indexBytes,
    encryption: session.encryption ?? null,
    // NOT tied to `encryption` being non-null (see `needsLicence` above) — an unencrypted
    // SUBSCRIPTION/ELITE audio book still needs its licence attached to enforce expiry/canPersist;
    // only genuine OPEN_ACCESS content ships with no licence at all.
    licence: needsLicence ? licence : null,
    cipherLength: bytes.length,
    originalLength,
    mimeType: session.content.mimeType ?? FORMAT_MIME_TYPES[format],
  };

  await contentStore.store(pkg);

  // ELITE (STREAM-intent, `!loan.canPersist`) never reaches this point with anything actually
  // written to disk — `contentStore.store()` already declines to persist for it. Found in review
  // (D-18): the code below used to run unconditionally anyway, writing a `status: 'COMPLETED'`
  // downloads row and burning one of the 5 offline slots for a book that was never actually
  // downloaded. Five ELITE reads and zero real offline books would incorrectly hit
  // BOOK_LIMIT_REACHED. Skip the whole block for a non-persisting read — there is nothing to
  // track, and nothing to roll back if a race loses, since nothing was written.
  if (!loan.canPersist) {
    return;
  }

  // Everything below runs under withWriteLock — the lock every other repository call site in this
  // repo takes, and the one that serializes writes onto the app's single SQLite connection
  // (syncableTable.ts's withWriteLock doc comment). `{ locked: true }` on saveLocal is correct
  // ONLY because this block already holds the lock.
  //
  // It deliberately RE-QUERIES listActive instead of reusing the pre-fetch result above (which
  // the design doc's step 9 suggested as an optimization): that result is now stale — a network
  // fetch, a checksum and a store() ago — and reusing it is exactly what makes
  // check-then-write non-atomic. The `downloads` schema has no unique constraint on
  // (user_id, book_id), so two concurrent downloads of the same book, each holding its own
  // pre-fetch snapshot, would each see "no existing row" and INSERT a duplicate. Re-reading
  // under the lock is what makes the decision (UPDATE vs CREATE) and the write one atomic unit.
  await withWriteLock(async () => {
    const rows = await downloadTable.listActive(USER_ID);
    // Re-assert the cap here too, for the same reason: the pre-fetch check above could have
    // raced another download that has since taken the last slot. If it did, roll back the
    // store() — leaving ciphertext on disk that no downloads row accounts for would make
    // isAvailableOffline(bookId) true for a book the app believes it never downloaded.
    try {
      assertBookLimitNotExceeded(bookId, rows);
    } catch (cause) {
      // Best-effort rollback: destroy() failing here (e.g. a keychain/FS error) must NOT replace
      // `cause` — the caller needs the coded BOOK_LIMIT_REACHED DownloadFailure to switch on, not
      // a raw, untyped error from the cleanup attempt. Swallow (log) any destroy failure and
      // still surface the original reason.
      try {
        await contentStore.destroy(bookId);
      } catch (destroyCause) {
        console.warn(`downloadManager: rollback contentStore.destroy(${bookId}) failed`, destroyCause);
      }
      throw cause;
    }

    const existing = rows.find((row) => row.book_id === bookId) ?? null;
    const now = nowIso();
    const row: DownloadRow = {
      id: existing?.id ?? newId(),
      user_id: USER_ID,
      book_id: bookId,
      format,
      local_path: null, // contentStore.ts does not expose its internal file path — see design doc.
      status: 'COMPLETED',
      is_valid: 1,
      downloaded_at: now,
      updated_at: now,
      is_deleted: 0,
      synced: 0,
    };
    await downloadTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', { locked: true });
  });
}
