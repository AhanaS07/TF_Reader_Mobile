// Integration-style test: real contentStore (real filesystem via __mocks__/expo-file-system.js,
// real AES-GCM math via the manual native-module mocks), real downloadTable (real SQLite via
// __mocks__/expo-sqlite.js), mocked global.fetch only. Proves the FULL orchestration order and
// every failure branch, and specifically the 5-book-limit-across-different-books behavior that
// motivated using downloadTable instead of downloadRepository (see the design doc).

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { downloadBook } from './downloadManager';
import { downloadTable } from '../sync/stores/downloadStore';
import { USER_ID } from '../sync/syncConfig';
import { contentStore, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { encrypt } from '../encryption/aesGcm';
import { generateDeviceKeypair, wrapBek } from '../encryption/deviceKeypair';
import { DownloadError } from './errors';
import { Paths } from 'expo-file-system';
import type { ContentLicenceResponse, SignedLicence } from '@/shared/contracts';

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function openAccessLicenceFor(bookId: string, content: Uint8Array): ContentLicenceResponse {
  return {
    bookId,
    format: 'EPUB',
    mimeType: 'application/epub+zip',
    encryptedFileUrl: `http://localhost:4000/fixtures/${bookId}.epub`,
    checksum: sha256Hex(content),
    encryption: null,
    licence: null,
  };
}

// Uint8Array<ArrayBuffer>, not the bare (ArrayBufferLike-generic) `Uint8Array`: TS 6's DOM lib
// types Response's BodyInit/BufferSource as the ArrayBuffer-specific variant, and every caller
// here passes a `new Uint8Array([...])` literal, which infers as exactly this type already.
function mockFetchFor(licence: ContentLicenceResponse, content: Uint8Array<ArrayBuffer>) {
  return jest.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/content-licence')) {
      return new Response(JSON.stringify(licence), { status: 200 });
    }
    if (url === licence.encryptedFileUrl) {
      return new Response(content, { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}

describe('downloadBook — happy path', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores the book via contentStore and records a downloads row, never touching plaintext-on-disk outside contentStore', async () => {
    const bookId = 'happy-path-book';
    const content = new Uint8Array([10, 20, 30, 40, 50]); // open access: content IS plaintext
    const licence = openAccessLicenceFor(bookId, content);
    global.fetch = mockFetchFor(licence, content);

    await downloadBook(bookId);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
    const rows = await downloadTable.listActive(USER_ID);
    const row = rows.find((r) => r.book_id === bookId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('COMPLETED');
    expect(row!.local_path).toBeNull();
  });

  it('re-downloading the SAME book updates its existing row rather than creating a second one', async () => {
    const bookId = 'repeat-download-book';
    const content = new Uint8Array([1, 2, 3]);
    const licence = openAccessLicenceFor(bookId, content);
    global.fetch = mockFetchFor(licence, content);

    await downloadBook(bookId);
    const firstRows = await downloadTable.listActive(USER_ID);
    const firstRow = firstRows.find((r) => r.book_id === bookId)!;

    await downloadBook(bookId);
    const secondRows = await downloadTable.listActive(USER_ID);
    const matching = secondRows.filter((r) => r.book_id === bookId);

    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(firstRow.id);
  });
});

// Matches deviceKeypair.ts's internal constant — duplicated here only for the scoped keychain
// cleanup below, exactly as contentStore.test.ts does it (deviceKeypair.ts exposes no reset).
const DEVICE_PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

describe('downloadBook — the ENCRYPTED (Subscription) path, for real', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  // Every other test in this file uses an open-access licence (encryption/licence both null), which
  // never exercises computeOriginalLength's ENCRYPTED branch (cipherLength - NONCE - TAG). This one
  // does, against real AES-GCM bytes and a real RSA-OAEP-wrapped BEK — the same
  // generateDeviceKeypair -> wrapBek -> store -> decryptBook path contentStore.test.ts's
  // "end-to-end via the real device keypair" block proves for contentStore alone, driven here
  // through downloadBook instead. It CAN fail: an off-by-one in that subtraction makes
  // contentStore.store()'s own assertLengthInvariant reject the package outright
  // (ContentFailure(INTEGRITY_FAILED)), and a wrong nonce/tag split makes decryptBook reject.
  it('downloads, stores and decrypts an AES-256-GCM book with a real wrapped BEK', async () => {
    const bookId = 'encrypted-subscription-book';
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const bek = new Uint8Array(crypto.randomBytes(32));

    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);

    // aesGcm.encrypt returns a CipherPayload whose `content` is nonce(12)||ciphertext||tag(16) —
    // exactly the bytes the mock backend would serve at encryptedFileUrl.
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);

    const keyFingerprint = 'sha256:downloadmanager-encrypted-test';
    const licence: SignedLicence = {
      licenceId: `lic-${bookId}`,
      itemId: bookId, // MUST equal bookId — contentStore.store() rejects a mismatch
      keyFingerprint,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // +1 day
      canPersist: true, // Subscription, not Elite: persists to disk
      rights: { print: false },
      // RS256 signature verification is a documented, not-yet-implemented gap in contentStore.ts,
      // so this value is a placeholder — nothing verifies it today.
      signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
    };
    const response: ContentLicenceResponse = {
      bookId,
      format: 'EPUB',
      mimeType: 'application/epub+zip',
      encryptedFileUrl: `http://localhost:4000/fixtures/${bookId}.epub.enc`,
      checksum: sha256Hex(encryptedBytes), // checksum is over the ENCRYPTED bytes
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek,
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint,
      },
      licence,
    };
    global.fetch = mockFetchFor(response, encryptedBytes);

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    // Full round trip: the bytes downloadBook handed to store() really do decrypt back to the
    // original plaintext, via the real device private key and the real GCM tag check.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });
});

describe('downloadBook — failure branches', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects with INSUFFICIENT_STORAGE and never calls fetch when free space is below the floor', async () => {
    Object.defineProperty(Paths, 'availableDiskSpace', { get: () => 0, configurable: true });
    global.fetch = jest.fn();

    await expect(downloadBook('low-storage-book')).rejects.toMatchObject({
      code: DownloadError.INSUFFICIENT_STORAGE,
    });
    expect(global.fetch).not.toHaveBeenCalled();

    Object.defineProperty(Paths, 'availableDiskSpace', { get: () => 10 * 1024 * 1024 * 1024, configurable: true });
  });

  it('rejects with CHECKSUM_MISMATCH and never calls contentStore.store when the checksum is wrong', async () => {
    const bookId = 'tampered-checksum-book';
    const content = new Uint8Array([9, 9, 9]);
    const licence = { ...openAccessLicenceFor(bookId, content), checksum: 'not-the-real-checksum' };
    global.fetch = mockFetchFor(licence, content);

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.CHECKSUM_MISMATCH,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  // Same "never stored" assertion shape as the CHECKSUM_MISMATCH test above: isAvailableOffline
  // stays false, which is only true if contentStore.store() was never reached.
  it('rejects with BOOK_TOO_LARGE and never calls contentStore.store when the book exceeds the RAM budget', async () => {
    const bookId = 'oversized-book';
    // One byte over contentStore's MAX_DECRYPTED_BYTES. Open access, so originalLength ===
    // content.length — no nonce/tag overhead to reason about here.
    const content = new Uint8Array(MAX_DECRYPTED_BYTES + 1);
    const licence = openAccessLicenceFor(bookId, content);
    global.fetch = mockFetchFor(licence, content);

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_TOO_LARGE,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('rejects with LICENCE_FETCH_FAILED when content-licence 404s', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));

    await expect(downloadBook('missing-book')).rejects.toMatchObject({
      code: DownloadError.LICENCE_FETCH_FAILED,
    });
  });
});
