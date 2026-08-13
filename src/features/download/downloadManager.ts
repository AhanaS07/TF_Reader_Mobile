// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 3 + Phase 4 items 1/3/4: the download skeleton's single entry point.
// Permission -> storage -> 5-book limit -> resolve the encrypted asset by Book ID -> verify its
// checksum -> reject if the decrypted size would exceed contentStore's RAM budget
// (MAX_DECRYPTED_BYTES, BOOK_TOO_LARGE) -> best-effort fetch the encrypted search index, if the
// licence has one -> hand the bytes to Encryption's store() (never persist plaintext) -> record
// the download locally.
//
// Uses `downloadTable` (the general primitive `downloadRepository.ts` is built on), NOT
// `downloadRepository`'s own convenience methods (list/currentForBook/recordCompleted) — those
// are hardcoded to sync/config.ts's single fixed BOOK_ID, a prototype shortcut that can't count
// across DIFFERENT books. downloadTable already supports multiple books; the wrapper just wasn't
// built for this case. See docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md.
//
// SEARCH INDEX (added 2026-08-14): `ContentLicenceResponse.index` (content-licence.ts) carries an
// optional `{ url, encrypted, termCount }` — the real backend shape (team flambeau's
// `ReadingSessionResponse.index`, forwarding wokay's `IndexUrl` unchanged). Fetched the same way
// as the main asset and attached to `EncryptedPackage.index`, which contentStore.ts's
// decryptSearchIndex/getIndex already know how to decrypt — they just never had anything real to
// decrypt before this, since nothing in the download flow could reach an index URL. A failure
// fetching the index does NOT fail the whole download: contentStore.ts already treats the index
// as an independent failure domain from the book itself ("an index-only integrity failure has no
// business making the book unreadable too" — decryptSearchIndex's own doc comment), so the same
// philosophy applies here — a book with a temporarily-unfetchable index still downloads and reads
// fine, just without offline search until a later attempt succeeds.

import * as Crypto from 'expo-crypto';
import type { BookId, EncryptedPackage } from '@/shared/contracts';
import { contentStore, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { NONCE_BYTES, GCM_TAG_BYTES } from '../encryption/cipherLayout';
import { downloadTable } from '../sync/repositories/downloadRepository';
import { withWriteLock } from '../sync/repositories/syncableTable';
import { newId, nowIso } from '../sync/db/database';
import { USER_ID } from '../sync/config';
import type { DownloadRow } from '../sync/db/types';
import { checkStoragePermission } from './permissions';
import { checkAvailableStorage } from './storageCheck';
import { fetchContentLicence, fetchEncryptedAsset } from './contentLicenceClient';
import { DownloadError, DownloadFailure } from './errors';

export const BOOK_LIMIT = 5;

function bytesToHex(bytes: Uint8Array): string {
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

async function verifyChecksum(bookId: BookId, bytes: Uint8Array, expectedHex: string): Promise<void> {
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
function computeOriginalLength(cipherLength: number, isEncrypted: boolean): number {
  return isEncrypted ? cipherLength - NONCE_BYTES - GCM_TAG_BYTES : cipherLength;
}

export async function downloadBook(bookId: BookId): Promise<void> {
  const hasPermission = await checkStoragePermission();
  if (!hasPermission) {
    throw new DownloadFailure(DownloadError.PERMISSION_DENIED, bookId);
  }
  if (!checkAvailableStorage()) {
    throw new DownloadFailure(DownloadError.INSUFFICIENT_STORAGE, bookId);
  }

  // Fast-fail before spending bandwidth. NOT the authoritative check — the one that decides
  // whether a row is written is re-run inside the write lock at the bottom of this function.
  assertBookLimitNotExceeded(bookId, await downloadTable.listActive(USER_ID));

  const licence = await fetchContentLicence(bookId);
  const bytes = await fetchEncryptedAsset(bookId, licence.encryptedFileUrl);
  await verifyChecksum(bookId, bytes, licence.checksum);

  // Reject an over-budget book BEFORE store(): contentStore.ts enforces MAX_DECRYPTED_BYTES only
  // on the read paths (loadPersisted/decryptBook), so an oversized book would otherwise download
  // "successfully", occupy one of the BOOK_LIMIT offline slots, and then throw on every single
  // attempt to open it. Fail here instead, while nothing has been persisted yet.
  const originalLength = computeOriginalLength(bytes.length, licence.encryption !== null);
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
  if (licence.index) {
    try {
      indexBytes = await fetchEncryptedAsset(bookId, licence.index.url);
    } catch (cause) {
      console.warn(
        `downloadManager: failed to fetch search index for ${bookId}, continuing without it`,
        cause,
      );
    }
  }

  const pkg: EncryptedPackage = {
    bookId,
    format: licence.format,
    content: bytes,
    index: indexBytes,
    encryption: licence.encryption,
    licence: licence.licence,
    cipherLength: bytes.length,
    originalLength,
    mimeType: licence.mimeType,
  };

  await contentStore.store(pkg);

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
      format: licence.format,
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
