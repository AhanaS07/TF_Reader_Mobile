// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 3 + Phase 4 items 1/3/4: the download skeleton's single entry point.
// Permission -> storage -> 5-book limit -> resolve the encrypted asset by Book ID -> verify its
// checksum -> hand the bytes to Encryption's store() (never persist plaintext) -> record the
// download locally.
//
// Uses `downloadTable` (the general primitive `downloadRepository.ts` is built on), NOT
// `downloadRepository`'s own convenience methods (list/currentForBook/recordCompleted) — those
// are hardcoded to sync/config.ts's single fixed BOOK_ID, a prototype shortcut that can't count
// across DIFFERENT books. downloadTable already supports multiple books; the wrapper just wasn't
// built for this case. See docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md.

import * as Crypto from 'expo-crypto';
import type { BookId, EncryptedPackage } from '@/shared/contracts';
import { contentStore } from '../encryption/contentStore';
import { NONCE_BYTES, GCM_TAG_BYTES } from '../encryption/cipherLayout';
import { downloadTable } from '../sync/repositories/downloadRepository';
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

async function assertBookLimitNotExceeded(bookId: BookId): Promise<DownloadRow[]> {
  const rows = await downloadTable.listActive(USER_ID);
  const alreadyDownloaded = rows.some((row) => row.book_id === bookId);
  if (!alreadyDownloaded && rows.length >= BOOK_LIMIT) {
    throw new DownloadFailure(
      DownloadError.BOOK_LIMIT_REACHED,
      bookId,
      new Error(`already at the ${BOOK_LIMIT}-book offline limit`),
    );
  }
  return rows;
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

  const existingRows = await assertBookLimitNotExceeded(bookId);

  const licence = await fetchContentLicence(bookId);
  const bytes = await fetchEncryptedAsset(bookId, licence.encryptedFileUrl);
  await verifyChecksum(bookId, bytes, licence.checksum);

  const pkg: EncryptedPackage = {
    bookId,
    format: licence.format,
    content: bytes,
    encryption: licence.encryption,
    licence: licence.licence,
    cipherLength: bytes.length,
    originalLength: computeOriginalLength(bytes.length, licence.encryption !== null),
    mimeType: licence.mimeType,
  };

  await contentStore.store(pkg);

  const existing = existingRows.find((row) => row.book_id === bookId) ?? null;
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
}
