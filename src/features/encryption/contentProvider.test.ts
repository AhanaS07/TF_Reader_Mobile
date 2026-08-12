// Exercises contentProvider.ts — the thin ContentProvider wrapper Reader (Ahana) actually
// imports. contentStore.ts's own test suites already cover session lifecycle, key resolution,
// GCM tag verification, and RAM budget in depth; this file only confirms the WIRING through
// getBook()/closeBook() is correct, not re-testing everything underneath it again.

import * as crypto from 'crypto';
import { encrypt } from './aesGcm';
import { storeBek } from './keyStorage';
import { contentStore } from './contentStore';
import { getBook, closeBook } from './contentProvider';
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
