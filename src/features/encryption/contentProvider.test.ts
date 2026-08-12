// Exercises contentProvider.ts — the thin ContentProvider wrapper Reader (Ahana) actually
// imports. contentStore.ts's own test suites already cover session lifecycle, key resolution,
// GCM tag verification, and RAM budget in depth; this file only confirms the WIRING through
// getBook()/closeBook() is correct, not re-testing everything underneath it again.

import * as crypto from 'crypto';
import { encrypt } from './aesGcm';
import { storeBek } from './keyStorage';
import { contentStore } from './contentStore';
import { getBook, getIndex, closeBook } from './contentProvider';
import { encryptMockSearchIndex, decodeSearchIndex } from './mockSearchIndex';
import { ContentFailure } from '@/shared/contracts';
import type { EncryptedPackage } from '@/shared/contracts';

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function openAccessPackage(bookId: string, plaintext: Uint8Array): EncryptedPackage {
  return {
    bookId,
    format: 'AUDIO',
    content: plaintext,
    encryption: null,
    licence: null,
    cipherLength: plaintext.length,
    originalLength: plaintext.length,
    mimeType: 'audio/mpeg',
  };
}

describe('contentProvider.getBook — open access', () => {
  it('returns the whole decrypted (already-plaintext) book, byte-for-byte', async () => {
    const bookId = 'provider-oa-1';
    const plaintext = plaintextOf(1024, 'reader gets this back verbatim');

    await contentStore.store(openAccessPackage(bookId, plaintext));
    const bytes = await getBook(bookId);

    expect(Buffer.from(bytes).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe('contentProvider.getBook — encrypted (Subscription-style)', () => {
  it('decrypts and returns the whole book without Reader ever touching ContentStore directly', async () => {
    const bookId = 'provider-sub-1';
    const key = randomKey();
    const plaintext = plaintextOf(4096, 'this is what epub.js/pdf.js would open');
    const payload = await encrypt(plaintext, key);

    const pkg: EncryptedPackage = {
      bookId,
      format: 'EPUB',
      content: payload.content,
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'not-a-real-wrap-in-this-test',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint: 'sha256:test-fingerprint',
      },
      licence: {
        licenceId: `lic-${bookId}`,
        itemId: bookId,
        keyFingerprint: 'sha256:test-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
      },
      cipherLength: payload.cipherLength,
      originalLength: payload.originalLength,
      mimeType: 'application/epub+zip',
    };

    await storeBek(bookId, key); // same "already unwrapped in a past session" cache path
    await contentStore.store(pkg);

    const bytes = await getBook(bookId);
    expect(Buffer.from(bytes).equals(Buffer.from(plaintext))).toBe(true);

    // Calling it again (e.g. a re-render) must not re-decrypt into a different buffer or throw.
    const bytesAgain = await getBook(bookId);
    expect(Buffer.from(bytesAgain).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe('contentProvider.getIndex — search index available alongside the decrypted book', () => {
  it('is resident in RAM at the same time as the decrypted book, via the same Search-facing seam', async () => {
    const bookId = 'provider-idx-1';
    const key = randomKey();
    const plaintext = plaintextOf(2048, 'the book Search needs to search inside');
    const payload = await encrypt(plaintext, key);
    const indexBytes = await encryptMockSearchIndex(bookId, key);

    const pkg: EncryptedPackage = {
      bookId,
      format: 'EPUB',
      content: payload.content,
      index: indexBytes,
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'not-a-real-wrap-in-this-test',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint: 'sha256:test-fingerprint',
      },
      licence: {
        licenceId: `lic-${bookId}`,
        itemId: bookId,
        keyFingerprint: 'sha256:test-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
      },
      cipherLength: payload.cipherLength,
      originalLength: payload.originalLength,
      mimeType: 'application/epub+zip',
    };

    await storeBek(bookId, key);
    await contentStore.store(pkg);

    // Reader opens the book first, same as any real reading session...
    const bookBytes = await getBook(bookId);
    expect(Buffer.from(bookBytes).equals(Buffer.from(plaintext))).toBe(true);

    // ...and while that session is open, Search can independently pull the decrypted index —
    // both live in RAM at once, under the SAME bookId session, without Search ever importing
    // contentStore.ts or touching keyStorage/aesGcm itself.
    const decryptedIndex = await getIndex(bookId);
    expect(decryptedIndex).not.toBeNull();
    expect(decodeSearchIndex(decryptedIndex!).bookId).toBe(bookId);

    // Getting the index doesn't disturb the already-decrypted book.
    const bookBytesAgain = await getBook(bookId);
    expect(Buffer.from(bookBytesAgain).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('works even if getBook was never called — Search does not depend on Reader having opened first', async () => {
    const bookId = 'provider-idx-2';
    const key = randomKey();
    const payload = await encrypt(plaintextOf(256, 'body'), key);
    const indexBytes = await encryptMockSearchIndex(bookId, key);

    const pkg: EncryptedPackage = {
      bookId,
      format: 'EPUB',
      content: payload.content,
      index: indexBytes,
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'not-a-real-wrap-in-this-test',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint: 'sha256:test-fingerprint',
      },
      licence: {
        licenceId: `lic-${bookId}`,
        itemId: bookId,
        keyFingerprint: 'sha256:test-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
      },
      cipherLength: payload.cipherLength,
      originalLength: payload.originalLength,
      mimeType: 'application/epub+zip',
    };

    await storeBek(bookId, key);
    await contentStore.store(pkg);

    const decryptedIndex = await getIndex(bookId);
    expect(decryptedIndex).not.toBeNull();
    expect(decodeSearchIndex(decryptedIndex!).bookId).toBe(bookId);
  });

  it('returns null for a book with no search index', async () => {
    const bookId = 'provider-idx-none';
    await contentStore.store(openAccessPackage(bookId, plaintextOf(128, 'no index')));

    await expect(getIndex(bookId)).resolves.toBeNull();
  });

  it('closeBook zeroes the index buffer too, same as the book buffer', async () => {
    const bookId = 'provider-idx-close';
    const key = randomKey();
    const plaintext = plaintextOf(256, 'body');
    const payload = await encrypt(plaintext, key);
    const indexBytes = await encryptMockSearchIndex(bookId, key);

    const pkg: EncryptedPackage = {
      bookId,
      format: 'EPUB',
      content: payload.content,
      index: indexBytes,
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'not-a-real-wrap-in-this-test',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint: 'sha256:test-fingerprint',
      },
      licence: {
        licenceId: `lic-${bookId}`,
        itemId: bookId,
        keyFingerprint: 'sha256:test-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
      },
      cipherLength: payload.cipherLength,
      originalLength: payload.originalLength,
      mimeType: 'application/epub+zip',
    };

    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await getBook(bookId);
    const decryptedIndex = await getIndex(bookId);
    expect(decryptedIndex!.some((b: number) => b !== 0)).toBe(true);

    await closeBook(bookId);
    expect(decryptedIndex!.every((b: number) => b === 0)).toBe(true);
  });
});

describe('contentProvider — errors and lifecycle pass through untouched', () => {
  it('getBook rejects with the underlying ContentFailure when the book was never stored', async () => {
    await expect(getBook('provider-never-stored')).rejects.toBeInstanceOf(ContentFailure);
  });

  it('closeBook zeroes the SAME buffer getBook returned, in place', async () => {
    const bookId = 'provider-close-1';
    const plaintext = plaintextOf(512, 'zero me via the Reader-facing seam');

    await contentStore.store(openAccessPackage(bookId, plaintext));
    const bytes = await getBook(bookId);
    expect(bytes.some((b: number) => b !== 0)).toBe(true); // sanity: not already all-zero

    await closeBook(bookId);
    expect(bytes.every((b: number) => b === 0)).toBe(true); // same reference, zeroed by ContentStore.close

    await expect(closeBook(bookId)).resolves.toBeUndefined(); // idempotent, matches ContentStore.close
  });
});
