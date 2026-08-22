// openBook.test.ts — exercises the Open orchestrator (openBook) against mocked license check,
// mocked contentStore, and mocked chunkedAssetFetcher. Proves the key behaviors:
//   1. Already-downloaded + online: reuses local copy (no fetch)
//   2. Not-yet-downloaded + online: fetches via chunked fetcher and stores ephemerally
//   3. Offline + valid local licence: decrypts existing content
//   4. Offline + no licence: fails with OFFLINE_LICENSE_UNAVAILABLE
//   5. Chunked fetcher enforces maxBytes before the full payload is in memory (BOOK_TOO_LARGE)
//   6. content.originalLength cross-check rejects metadata disagreements (CHECKSUM_MISMATCH)

import type { Loan, ReadingSessionResponse } from '@/shared/contracts';
import { openBook } from './openBook';
import { DownloadError, DownloadFailure } from './errors';
import { USER_ID } from '../sync/syncConfig';
import { contentStore, getPersistedLicenceStatus } from '../encryption/contentStore';
import { borrowLoan, openReadingSession } from './readingSessionClient';
import { fetchEncryptedAssetChunked, discardPartialDownload } from './chunkedAssetFetcher';

// ── helpers ───────────────────────────────────────────────────────────────

function makeLoan(overrides?: Partial<Loan>): Loan {
  return {
    loanId: 'loan-test-book',
    itemId: 'test-book',
    userId: USER_ID,
    licenceModel: 'SUBSCRIPTION',
    status: 'ACTIVE',
    borrowedAt: new Date().toISOString(),
    canPersist: true,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides?: Partial<ReadingSessionResponse>): ReadingSessionResponse {
  return {
    sessionId: 'session-test-book',
    itemId: 'test-book',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverTime: new Date().toISOString(),
    content: {
      url: 'http://localhost:4000/fixtures/test-book.epub',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      cipherLength: 28,
      originalLength: 0,
      mimeType: 'application/epub+zip',
    },
    ...overrides,
  };
}

// ── module mocks ──────────────────────────────────────────────────────────

jest.mock('../encryption/deviceKeypair', () => ({
  generateDeviceKeypair: jest.fn().mockResolvedValue({ publicKey: 'mock-public-key' }),
  publicKeyToRawBase64: jest.fn().mockReturnValue('device-public-key-base64'),
  publicKeyFingerprint: jest.fn().mockResolvedValue('sha256:mock-fingerprint'),
}));

jest.mock('../encryption/licenceSignature', () => ({
  verifyLicenceSignature: jest.fn().mockReturnValue(true),
}));

jest.mock('../encryption/contentStore', () => ({
  contentStore: {
    isAvailableOffline: jest.fn().mockResolvedValue(false),
    openSession: jest.fn().mockResolvedValue({ bookId: 'test', format: 'EPUB', openedAt: Date.now() }),
    decryptBook: jest.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
    close: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
  getPersistedLicenceStatus: jest.fn().mockResolvedValue({ licence: null, expired: false }),
  MAX_DECRYPTED_BYTES: 25 * 1024 * 1024,
}));

jest.mock('./readingSessionClient', () => ({
  borrowLoan: jest.fn(),
  openReadingSession: jest.fn(),
  FAIL_CLOSED_CODES: new Set(['DOWNLOAD_NOT_PERMITTED', 'KEY_SUBSTITUTION']),
}));

jest.mock('./chunkedAssetFetcher', () => ({
  fetchEncryptedAssetChunked: jest.fn(),
  discardPartialDownload: jest.fn(),
}));

// ── tests ─────────────────────────────────────────────────────────────────

describe('openBook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(contentStore.decryptBook).mockResolvedValue(new Uint8Array([10, 20, 30]));
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(false);
    jest.mocked(contentStore.openSession).mockResolvedValue({ bookId: 'test', format: 'EPUB', openedAt: Date.now() });
    jest.mocked(contentStore.store).mockResolvedValue(undefined);
    jest.mocked(contentStore.close).mockResolvedValue(undefined);
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({ licence: null, expired: false });
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan());
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: { wrappedKey: 'mock-key', keyFingerprint: 'sha256:mock-fingerprint' } } as any),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(new Uint8Array(28)); // 12 nonce + 0 plaintext + 16 tag
  });

  it('reuses local copy when content is already downloaded (online path)', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(true);

    const result = await openBook('test-book', 'EPUB');

    expect(result).toEqual(new Uint8Array([10, 20, 30]));
    expect(contentStore.isAvailableOffline).toHaveBeenCalledWith('test-book');
    expect(contentStore.openSession).toHaveBeenCalledWith('test-book');
    expect(contentStore.decryptBook).toHaveBeenCalledWith('test-book');
    // Should NOT have fetched the asset from the network.
    expect(fetchEncryptedAssetChunked).not.toHaveBeenCalled();
  });

  it('fetches via chunked fetcher and stores ephemerally when not yet downloaded', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(false);
    const ciphertext = new Uint8Array(28); // 12 nonce + 0 plaintext + 16 tag
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(ciphertext);
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({
        encryption: { wrappedKey: 'mock-key', keyFingerprint: 'sha256:mock-fingerprint' },
        content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 0, mimeType: 'application/epub+zip' },
      } as any),
    );

    const result = await openBook('test-book', 'EPUB');

    expect(result).toEqual(new Uint8Array([10, 20, 30]));
    // Should have fetched via the chunked fetcher, not the single-shot.
    expect(fetchEncryptedAssetChunked).toHaveBeenCalledWith('test-book', expect.any(String), {
      maxBytes: expect.any(Number),
    });
    // Should have stored the ephemeral package.
    expect(contentStore.store).toHaveBeenCalledTimes(1);
    const storedPkg = jest.mocked(contentStore.store).mock.calls[0][0];
    expect(storedPkg.bookId).toBe('test-book');
    // canPersist is forced false — ephemeral Elite path.
    expect(storedPkg.licence!.canPersist).toBe(false);
  });

  it('decrypts existing content via offline fallback when network is unreachable', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256' as const, kid: 'test', value: '' },
      },
      expired: false,
    });
    jest.mocked(borrowLoan).mockRejectedValue(
      new DownloadFailure(DownloadError.LOAN_FAILED, 'test-book', new TypeError('Network request failed')),
    );

    const result = await openBook('test-book', 'EPUB');

    expect(result).toEqual(new Uint8Array([10, 20, 30]));
    expect(contentStore.openSession).toHaveBeenCalledWith('test-book');
    expect(contentStore.decryptBook).toHaveBeenCalledWith('test-book');
    // Should NOT have fetched from network or stored anything.
    expect(fetchEncryptedAssetChunked).not.toHaveBeenCalled();
    expect(contentStore.store).not.toHaveBeenCalled();
  });

  it('throws OFFLINE_LICENSE_UNAVAILABLE when offline and no persisted licence', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({ licence: null, expired: false });
    jest.mocked(borrowLoan).mockRejectedValue(
      new DownloadFailure(DownloadError.LOAN_FAILED, 'test-book', new TypeError('Network request failed')),
    );

    await expect(openBook('test-book', 'EPUB')).rejects.toThrow(
      expect.objectContaining({ code: DownloadError.OFFLINE_LICENSE_UNAVAILABLE }),
    );
  });

  it('throws BOOK_TOO_LARGE when chunked fetcher aborts due to oversized asset', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(false);
    jest.mocked(fetchEncryptedAssetChunked).mockRejectedValue(
      new DownloadFailure(
        DownloadError.BOOK_TOO_LARGE,
        'test-book',
        new Error('asset is 30000000 bytes on the wire, exceeds the 25165843-byte budget'),
      ),
    );

    await expect(openBook('test-book', 'EPUB')).rejects.toThrow(
      expect.objectContaining({ code: DownloadError.BOOK_TOO_LARGE }),
    );
    // Partial state should be cleaned up on abort.
    expect(discardPartialDownload).toHaveBeenCalledWith('test-book');
  });

  it('throws CHECKSUM_MISMATCH when server originalLength disagrees with cipherLength', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(false);
    // 28-byte ciphertext (12 nonce + 0 plaintext + 16 tag) but server claims originalLength=999
    const ciphertext = new Uint8Array(28);
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(ciphertext);
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({
        encryption: { wrappedKey: 'mock-key', keyFingerprint: 'sha256:mock-fingerprint' },
        content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 999, mimeType: 'application/epub+zip' },
      } as any),
    );

    await expect(openBook('test-book', 'EPUB')).rejects.toThrow(
      expect.objectContaining({ code: DownloadError.CHECKSUM_MISMATCH }),
    );
    // Nothing should be stored when the cross-check fails.
    expect(contentStore.store).not.toHaveBeenCalled();
  });

  it('passes maxBytes budget to chunked fetcher accounting for nonce + tag overhead', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(false);
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(new Uint8Array(28));
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({
        encryption: { wrappedKey: 'mock-key', keyFingerprint: 'sha256:mock-fingerprint' },
        content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 0, mimeType: 'application/epub+zip' },
      } as any),
    );

    await openBook('test-book', 'EPUB');

    const MAX_DECRYPTED_BYTES = 25 * 1024 * 1024;
    expect(fetchEncryptedAssetChunked).toHaveBeenCalledWith('test-book', expect.any(String), {
      maxBytes: MAX_DECRYPTED_BYTES + 12 + 16, // NONCE_BYTES + GCM_TAG_BYTES
    });
  });

  it('reuses local copy when already downloaded, even for PDF', async () => {
    jest.mocked(contentStore.isAvailableOffline).mockResolvedValue(true);

    const result = await openBook('test-book', 'PDF');

    expect(result).toEqual(new Uint8Array([10, 20, 30]));
    expect(contentStore.openSession).toHaveBeenCalledWith('test-book');
    expect(contentStore.decryptBook).toHaveBeenCalledWith('test-book');
    expect(fetchEncryptedAssetChunked).not.toHaveBeenCalled();
    expect(contentStore.store).not.toHaveBeenCalled();
  });

  // ── open-access tests ─────────────────────────────────────────────────────

  it('fetches session + asset for open-access book, stores ephemerally', async () => {
    // Borrow returns an OPEN_ACCESS loan → checkLicense short-circuits to open-access mode.
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan({ licenceModel: 'OPEN_ACCESS' }));
    // open-access session: no encryption (open-access books are unencrypted).
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: undefined, content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 28, mimeType: 'application/epub+zip' } }),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(new Uint8Array(28));

    const result = await openBook('test-book', 'EPUB');

    expect(result).toEqual(new Uint8Array([10, 20, 30]));
    // openBook fetches its own session (STREAM intent) since checkLicense short-circuited.
    expect(openReadingSession).toHaveBeenCalledWith('test-book', {
      format: 'EPUB',
      intent: 'STREAM',
      devicePublicKey: 'device-public-key-base64',
      wantSearchIndex: false,
    });
    expect(fetchEncryptedAssetChunked).toHaveBeenCalled();
    expect(contentStore.store).toHaveBeenCalledTimes(1);
    expect(contentStore.openSession).toHaveBeenCalledWith('test-book');
    expect(contentStore.decryptBook).toHaveBeenCalledWith('test-book');
  });

  it('attaches synthetic ephemeral licence (canPersist: false, non-null) for open-access', async () => {
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan({ licenceModel: 'OPEN_ACCESS' }));
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: undefined, content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 28, mimeType: 'application/epub+zip' } }),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(new Uint8Array(28));

    await openBook('test-book', 'EPUB');

    expect(contentStore.store).toHaveBeenCalledTimes(1);
    const storedPkg = jest.mocked(contentStore.store).mock.calls[0][0];
    // KEY ASSERTION: non-null licence with canPersist: false → isElite() returns true → in-memory only.
    expect(storedPkg.licence).not.toBeNull();
    expect(storedPkg.licence!.canPersist).toBe(false);
  });

  it('open-access: nothing persists to disk (store is called but package is Elite)', async () => {
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan({ licenceModel: 'OPEN_ACCESS' }));
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: undefined, content: { url: 'http://localhost:4000/fixtures/test-book.epub', expiresAt: '', cipherLength: 28, originalLength: 28, mimeType: 'application/epub+zip' } }),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockResolvedValue(new Uint8Array(28));

    await openBook('test-book', 'EPUB');

    // store() IS called (the Elite branch caches in RAM), but isAvailableOffline must still
    // be false afterward — nothing was written to disk.
    expect(contentStore.store).toHaveBeenCalledTimes(1);
    // The mock returns false by default, which is correct — but verify the store was called
    // with a package that triggers the Elite path (canPersist: false).
    const storedPkg = jest.mocked(contentStore.store).mock.calls[0][0];
    expect(storedPkg.licence!.canPersist).toBe(false);
  });

  it('open-access: cleans up partial download on fetch error', async () => {
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan({ licenceModel: 'OPEN_ACCESS' }));
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: undefined }),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockRejectedValue(
      new DownloadFailure(DownloadError.BOOK_TOO_LARGE, 'test-book', new Error('oversized')),
    );

    await expect(openBook('test-book', 'EPUB')).rejects.toThrow(
      expect.objectContaining({ code: DownloadError.BOOK_TOO_LARGE }),
    );
    expect(discardPartialDownload).toHaveBeenCalledWith('test-book');
  });

  it('open-access: throws BOOK_TOO_LARGE when oversized', async () => {
    jest.mocked(borrowLoan).mockResolvedValue(makeLoan({ licenceModel: 'OPEN_ACCESS' }));
    jest.mocked(openReadingSession).mockResolvedValue(
      makeSession({ encryption: undefined }),
    );
    jest.mocked(fetchEncryptedAssetChunked).mockRejectedValue(
      new DownloadFailure(
        DownloadError.BOOK_TOO_LARGE,
        'test-book',
        new Error('asset is 30000000 bytes on the wire, exceeds the 25165843-byte budget'),
      ),
    );

    await expect(openBook('test-book', 'EPUB')).rejects.toThrow(
      expect.objectContaining({ code: DownloadError.BOOK_TOO_LARGE }),
    );
  });
});
