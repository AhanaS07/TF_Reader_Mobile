// Exercises the search-index half of contentStore.ts: decryptSearchIndex(bookId), and the mock
// index generator (mockSearchIndex.ts) that stands in for Search's (Vaishnavi's) real, server-side
// index builder. Per search.ts's own contract, the index is encrypted under the SAME BEK as the
// book, its OWN nonce, and decrypted in the same pass as the book content.

import * as crypto from 'crypto';
import { encrypt, decryptBook as decryptRaw } from './aesGcm';
import { NONCE_BYTES } from './cipherLayout';
import { storeBek } from './keyStorage';
import { contentStore, decryptSearchIndex } from './contentStore';
import { createMockSearchIndex, encryptMockSearchIndex, decodeSearchIndex } from './mockSearchIndex';
import { utf8Encode } from './utf8';
import { ContentError, ContentFailure } from '@/shared/contracts';
import type { EncryptedPackage, SignedLicence } from '@/shared/contracts';

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function licenceFor(bookId: string, overrides: Partial<SignedLicence> = {}): SignedLicence {
  return {
    licenceId: `lic-${bookId}`,
    itemId: bookId,
    keyFingerprint: 'sha256:test-fingerprint',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    canPersist: true,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
    ...overrides,
  };
}

async function buildEncryptedPackageWithIndex(
  bookId: string,
  plaintext: Uint8Array,
  key: Uint8Array,
  options: { withIndex?: boolean } = {}
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  const index = options.withIndex === false ? undefined : await encryptMockSearchIndex(bookId, key);
  return {
    bookId,
    format: 'EPUB',
    content: payload.content,
    index,
    encryption: {
      algorithm: 'AES-256-GCM',
      layout: 'nonce(12) || ciphertext || tag(16)',
      wrappedBek: 'not-a-real-wrap-in-this-test',
      wrapAlgorithm: 'RSA-OAEP-256',
      keyId: 'master-v1',
      keyFingerprint: 'sha256:test-fingerprint',
    },
    licence: licenceFor(bookId),
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
  };
}

function openAccessPackageWithIndex(bookId: string, plaintext: Uint8Array, indexBytes?: Uint8Array): EncryptedPackage {
  return {
    bookId,
    format: 'EPUB',
    content: plaintext,
    index: indexBytes,
    encryption: null,
    licence: null,
    cipherLength: plaintext.length,
    originalLength: plaintext.length,
    mimeType: 'application/epub+zip',
  };
}

describe('createMockSearchIndex / encryptMockSearchIndex / decodeSearchIndex', () => {
  it('builds a well-formed BookSearchIndex matching the frozen shape', async () => {
    const built = await createMockSearchIndex('book-1');
    expect(built.bookId).toBe('book-1');
    expect(built.format).toBe('EPUB');
    expect(built.version).toBe(1);
    expect(Object.keys(built.index).length).toBeGreaterThan(0);
    expect(built.index.search[0]).toMatchObject({ chapterId: expect.any(String), snippet: expect.any(String) });
  });

  it('encrypts and decodes back to the identical structure, independent of contentStore', async () => {
    const key = randomKey();
    const encryptedIndex = await encryptMockSearchIndex('book-2', key);

    expect(encryptedIndex.length).toBeGreaterThan(NONCE_BYTES);

    const nonce = encryptedIndex.subarray(0, NONCE_BYTES);
    const ciphertextWithTag = encryptedIndex.subarray(NONCE_BYTES);
    // Decrypt with the real primitive directly (not via contentStore) to prove the encoding
    // step itself is correct in isolation.
    const decrypted = await decryptRaw(ciphertextWithTag, nonce, key);

    const decoded = decodeSearchIndex(decrypted);
    const original = await createMockSearchIndex('book-2');
    expect(decoded).toEqual(original);
  });
});

describe('contentStore.decryptSearchIndex — encrypted (Subscription-style)', () => {
  it('decrypts the bundled index in the same pass as the book, under the SAME BEK', async () => {
    const bookId = 'idx-sub-1';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(2048, 'book body'), key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const book = await contentStore.decryptBook(bookId);
    expect(book.length).toBe(2048);

    const indexBytes = await decryptSearchIndex(bookId);
    expect(indexBytes).not.toBeNull();
    const decoded = decodeSearchIndex(indexBytes!);
    expect(decoded.bookId).toBe(bookId);
    expect(decoded.index.book).toBeDefined();
  });

  it('decryptSearchIndex works even if decryptBook was never called explicitly first', async () => {
    const bookId = 'idx-sub-2';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(512, 'body'), key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    // No explicit decryptBook() call here — decryptSearchIndex must trigger the same pass itself.
    const indexBytes = await decryptSearchIndex(bookId);
    expect(indexBytes).not.toBeNull();
    expect(decodeSearchIndex(indexBytes!).bookId).toBe(bookId);
  });

  it('returns null for a book that has no index', async () => {
    const bookId = 'idx-sub-none';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(256, 'no index here'), key, {
      withIndex: false,
    });
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    await expect(decryptSearchIndex(bookId)).resolves.toBeNull();
  });

  it('rejects with ContentFailure(INTEGRITY_FAILED) when the index ciphertext is tampered, independent of the book content', async () => {
    const bookId = 'idx-sub-tampered';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(512, 'untouched body'), key);
    await storeBek(bookId, key);

    const tamperedIndex = new Uint8Array(pkg.index!);
    tamperedIndex[NONCE_BYTES + 3] ^= 0xff;

    await contentStore.store({ ...pkg, index: tamperedIndex });
    await contentStore.openSession(bookId);

    // The book content itself is untouched and must still decrypt fine...
    const book = await contentStore.decryptBook(bookId);
    expect(book.length).toBe(512);

    // ...but the index, tampered independently (its own nonce/tag), must fail loudly on its own.
    try {
      await decryptSearchIndex(bookId);
      throw new Error('expected decryptSearchIndex to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.INTEGRITY_FAILED);
    }
  });

  it('close() zeroes the decrypted index buffer in place, same as the book buffer', async () => {
    const bookId = 'idx-sub-close';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(256, 'body'), key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const indexBytes = await decryptSearchIndex(bookId);
    expect(indexBytes).not.toBeNull();
    expect(indexBytes!.some((b) => b !== 0)).toBe(true);

    await contentStore.close(bookId);
    expect(indexBytes!.every((b) => b === 0)).toBe(true);
  });
});

describe('contentStore.decryptSearchIndex — open access (no encryption)', () => {
  it('returns the index bytes as-is (no crypto) when the book has no encryption', async () => {
    const bookId = 'idx-oa-1';
    const plaintext = plaintextOf(512, 'open access body');
    const rawIndexBytes = utf8Encode(JSON.stringify({ bookId, format: 'EPUB', version: 1, index: {} }));

    await contentStore.store(openAccessPackageWithIndex(bookId, plaintext, rawIndexBytes));
    await contentStore.openSession(bookId);

    const indexBytes = await decryptSearchIndex(bookId);
    expect(indexBytes).not.toBeNull();
    expect(Buffer.from(indexBytes!).equals(Buffer.from(rawIndexBytes))).toBe(true);
  });

  it('returns null when there is no index at all', async () => {
    const bookId = 'idx-oa-none';
    await contentStore.store(openAccessPackageWithIndex(bookId, plaintextOf(128, 'body')));
    await contentStore.openSession(bookId);

    await expect(decryptSearchIndex(bookId)).resolves.toBeNull();
  });
});
