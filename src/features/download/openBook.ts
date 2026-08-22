// Owner: Download (Abhinav).
//
// Open orchestrator — read a book NOW without persisting anything. License check first,
// then either decrypt from an existing local copy or stream the signed URL into memory
// (ephemeral Elite package, canPersist forced false), then decrypt and return the bytes.
//
// Nothing is saved — no licence, no ciphertext. close(bookId) drops the in-memory
// package from packageCache, exactly as it does for Elite today.
//
// NOT wired into Reader's call site yet — that change is in Ahana's directory
// (src/features/reader/readerAssets.ts). This file and its tests land first so the
// seam is proven before the Reader-side boundary is crossed.

import type { BookId, ContentFormat, EncryptedPackage, SignedLicence } from '@/shared/contracts';
import { contentStore, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { NONCE_BYTES, GCM_TAG_BYTES } from '../encryption/cipherLayout';
import { generateDeviceKeypair, publicKeyToRawBase64 } from '../encryption/deviceKeypair';
import { fetchEncryptedAssetChunked, discardPartialDownload } from './chunkedAssetFetcher';
import { openReadingSession } from './readingSessionClient';
import { checkLicense } from './licenseCheck';
import { DownloadError, DownloadFailure } from './errors';

// Same MIME-type fallback as downloadManager.ts — EncryptedPackage.mimeType is not optional.
const FORMAT_MIME_TYPES: Record<ContentFormat, string> = {
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  AUDIO: 'application/octet-stream',
};

const OPEN_ACCESS_LICENCE_EXPIRES_AT = '9999-12-31T23:59:59.000Z';

/**
 * Synthetic ephemeral licence for open-access books opened via Open. Forces
 * `canPersist: false` so `contentStore.store()` routes through the Elite branch
 * (in-memory only, nothing written to disk). This is the key move: downloadManager.ts
 * uses `licence: null` for open-access (which DOES persist — no key material to protect),
 * but Open must never persist, so we need a non-null licence with `canPersist: false` to
 * trigger the Elite path. Same pattern as the `'online'` branch's ephemeral licence.
 */
function synthesiseEphemeralLicence(sessionId: string, itemId: string): SignedLicence {
  return {
    licenceId: sessionId,
    itemId,
    keyFingerprint: 'ephemeral',
    expiresAt: OPEN_ACCESS_LICENCE_EXPIRES_AT,
    canPersist: false,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },
  };
}

/**
 * Open a book for immediate reading — nothing persists. The caller MUST call
 * `contentProvider.closeBook(bookId)` (or `contentStore.close(bookId)`) when done to
 * drop the in-memory package and zero the decrypted buffer.
 *
 * @returns the decrypted book bytes (same as `contentProvider.getBook`).
 * @throws `DownloadFailure` on licence denial, network failure, or offline-with-no-valid-licence.
 */
export async function openBook(bookId: BookId, format: ContentFormat): Promise<Uint8Array> {
  const license = await checkLicense(bookId, format, 'STREAM');
  if (!license.ok) {
    throw new DownloadFailure(license.reason, bookId);
  }

  switch (license.mode) {
    case 'offline-license': {
      // Content is on disk (persisted alongside the licence by a previous download).
      // openSession + decryptBook is the existing path — nothing new to build.
      await contentStore.openSession(bookId);
      return contentStore.decryptBook(bookId);
    }

    case 'online': {
      // Check if content is already on disk from a previous download — if so, decrypt
      // the local copy (the fresh licence check above confirms we still have access).
      if (await contentStore.isAvailableOffline(bookId)) {
        await contentStore.openSession(bookId);
        return contentStore.decryptBook(bookId);
      }

      // Not on disk — stream the signed URL into memory via the chunked fetcher, build
      // an ephemeral Elite package (canPersist forced false regardless of the real
      // loan.canPersist), and store() it. contentStore.store()'s existing Elite branch
      // caches the package in RAM only, nothing written to disk — zero new decrypt/cache
      // logic.
      //
      // fetchEncryptedAssetChunked (not the single-shot fetchEncryptedAsset) because it
      // enforces a maxBytes ceiling on the ciphertext as soon as the total is known (first
      // chunk / Content-Range), aborting mid-transfer before the oversized payload is fully
      // assembled in memory. The single-shot variant only checks AFTER the full fetch
      // completes, defeating the purpose of the RAM budget for Open-path books that aren't
      // already on disk.
      const isEncrypted = license.session.encryption != null;
      const maxCipherBytes = MAX_DECRYPTED_BYTES + (isEncrypted ? NONCE_BYTES + GCM_TAG_BYTES : 0);

      let bytes: Uint8Array;
      try {
        bytes = await fetchEncryptedAssetChunked(bookId, license.session.content.url, {
          maxBytes: maxCipherBytes,
        });
      } catch (cause) {
        // Fail-closed: clean up any partial download state on mid-transfer abort/timeout.
        // Incomplete ciphertext must not linger on disk.
        try {
          discardPartialDownload(bookId);
        } catch (cleanupCause) {
          console.warn(
            `openBook: rollback discardPartialDownload(${bookId}) failed during asset fetch cleanup`,
            cleanupCause,
          );
        }
        throw cause;
      }

      // Cross-check: if the server supplied content.originalLength, verify it against what
      // the ciphertext length implies. A disagreement means the metadata record is corrupted
      // — reject before store(), same as downloadManager.ts does. The GCM tag catches real
      // byte-level corruption on decrypt; this is the less-precise metadata-layer check.
      const expectedOriginalLength = isEncrypted
        ? bytes.length - NONCE_BYTES - GCM_TAG_BYTES
        : bytes.length;

      if (
        license.session.content.originalLength !== undefined &&
        license.session.content.originalLength !== expectedOriginalLength
      ) {
        throw new DownloadFailure(
          DownloadError.CHECKSUM_MISMATCH,
          bookId,
          new Error(
            `content.originalLength (${license.session.content.originalLength}) disagrees with cipherLength ` +
              `(${bytes.length}) for ${isEncrypted ? 'an encrypted' : 'an open-access'} book — expected ${expectedOriginalLength}`,
          ),
        );
      }

      const originalLength = license.session.content.originalLength ?? expectedOriginalLength;

      if (originalLength > MAX_DECRYPTED_BYTES) {
        throw new DownloadFailure(
          DownloadError.BOOK_TOO_LARGE,
          bookId,
          new Error(
            `book decrypts to ${originalLength} bytes, over the ${MAX_DECRYPTED_BYTES}-byte RAM budget`,
          ),
        );
      }

      const pkg: EncryptedPackage = {
        bookId,
        format,
        content: bytes,
        encryption: license.session.encryption ?? null,
        licence: {
          ...license.licence,
          // KEY MOVE: force canPersist false so store() treats this as Elite
          // (in-memory only, nothing written to disk) regardless of the real loan.
          canPersist: false,
        },
        cipherLength: bytes.length,
        originalLength,
        mimeType: license.session.content.mimeType ?? FORMAT_MIME_TYPES[format],
      };

      await contentStore.store(pkg);
      await contentStore.openSession(bookId);
      return contentStore.decryptBook(bookId);
    }

    case 'open-access': {
      // Open-access short-circuits at checkLicense (before the session step) because
      // open-access books don't need a reading session for rights — but we still need the
      // session for the asset URL. Fetch it here, same pattern as downloadManager.ts.
      const { publicKey } = await generateDeviceKeypair();
      const session = await openReadingSession(bookId, {
        format,
        intent: 'STREAM',
        devicePublicKey: publicKeyToRawBase64(publicKey),
        wantSearchIndex: false,
      });

      const isEncrypted = session.encryption != null;
      const maxCipherBytes = MAX_DECRYPTED_BYTES + (isEncrypted ? NONCE_BYTES + GCM_TAG_BYTES : 0);

      let bytes: Uint8Array;
      try {
        bytes = await fetchEncryptedAssetChunked(bookId, session.content.url, {
          maxBytes: maxCipherBytes,
        });
      } catch (cause) {
        try {
          discardPartialDownload(bookId);
        } catch (cleanupCause) {
          console.warn(
            `openBook: rollback discardPartialDownload(${bookId}) failed during open-access asset fetch cleanup`,
            cleanupCause,
          );
        }
        throw cause;
      }

      const expectedOriginalLength = isEncrypted
        ? bytes.length - NONCE_BYTES - GCM_TAG_BYTES
        : bytes.length;

      if (
        session.content.originalLength !== undefined &&
        session.content.originalLength !== expectedOriginalLength
      ) {
        throw new DownloadFailure(
          DownloadError.CHECKSUM_MISMATCH,
          bookId,
          new Error(
            `content.originalLength (${session.content.originalLength}) disagrees with cipherLength ` +
              `(${bytes.length}) for an open-access book — expected ${expectedOriginalLength}`,
          ),
        );
      }

      const originalLength = session.content.originalLength ?? expectedOriginalLength;

      if (originalLength > MAX_DECRYPTED_BYTES) {
        throw new DownloadFailure(
          DownloadError.BOOK_TOO_LARGE,
          bookId,
          new Error(
            `book decrypts to ${originalLength} bytes, over the ${MAX_DECRYPTED_BYTES}-byte RAM budget`,
          ),
        );
      }

      // KEY MOVE: attach a synthetic ephemeral licence with canPersist: false. This makes
      // isElite() return true, so store() treats the package as Elite (in-memory only,
      // nothing written to disk). downloadManager.ts uses `licence: null` for open-access
      // (which persists — no key material to protect), but Open must never persist, so we
      // need a non-null licence with canPersist: false to trigger the Elite path.
      const pkg: EncryptedPackage = {
        bookId,
        format,
        content: bytes,
        encryption: session.encryption ?? null,
        licence: synthesiseEphemeralLicence(session.sessionId, bookId),
        cipherLength: bytes.length,
        originalLength,
        mimeType: session.content.mimeType ?? FORMAT_MIME_TYPES[format],
      };

      await contentStore.store(pkg);
      await contentStore.openSession(bookId);
      return contentStore.decryptBook(bookId);
    }
  }
}
