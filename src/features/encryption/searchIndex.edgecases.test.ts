// Adversarial edge-case probes for the search-index encrypt/decrypt path, written AFTER reading
// searchIndex.test.ts (happy paths: mock-index shape, encrypt/decode round trip, Subscription +
// open-access integration, decryptSearchIndex without decryptBook first, null for no-index,
// independent tamper rejection, close() zeroing) and contentStore.edgecases.test.ts (this
// codebase's own edge-case idioms: buildEncryptedPackage-style fixtures, storeBek pre-seeding,
// concurrency races, reopen-no-alias checks).
//
// This file specifically hunts for bugs in decryptSearchIndex's OWN wiring (indexPending sharing,
// RAM budget, stale-cache-on-restore, no-session errors) and in mockSearchIndex.ts's ASCII-only
// codec, per the task brief. Confirmed-fine/deliberate behaviors already called out in the task
// (independent decrypt pass from decryptBook, close()-racing gap, null-for-no-index) are NOT
// re-tested here as "new" bugs — only genuinely new hypotheses are exercised.

import * as crypto from 'crypto';
import { encrypt, decryptBook as decryptRaw } from './aesGcm';
import { NONCE_BYTES } from './cipherLayout';
import { storeBek } from './keyStorage';
import { contentStore, decryptSearchIndex, MAX_DECRYPTED_BYTES } from './contentStore';
import { createMockSearchIndex, encryptMockSearchIndex, decodeSearchIndex } from './mockSearchIndex';
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
  options: { index?: Uint8Array | 'mock' | 'none' } = {}
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  let index: Uint8Array | undefined;
  if (options.index === 'none') {
    index = undefined;
  } else if (options.index === undefined || options.index === 'mock') {
    index = await encryptMockSearchIndex(bookId, key);
  } else {
    index = options.index;
  }
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

describe('EDGE: concurrent decryptSearchIndex() calls share one in-flight decrypt', () => {
  it('two concurrent decryptSearchIndex() calls both resolve to the SAME buffer reference', async () => {
    const bookId = 'idx-edge-concurrent';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(1024, 'concurrent index race'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const [i1, i2] = await Promise.all([decryptSearchIndex(bookId), decryptSearchIndex(bookId)]);
    expect(i1).not.toBeNull();
    expect(i2).toBe(i1); // same object — one shared decrypt, not two racing ones
  });

  it('after close(), a buffer returned by a concurrent decryptSearchIndex() race is zeroed (no live copy survives)', async () => {
    const bookId = 'idx-edge-concurrent-close';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(1024, 'concurrent then close'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const [i1, i2] = await Promise.all([decryptSearchIndex(bookId), decryptSearchIndex(bookId)]);
    await contentStore.close(bookId);

    expect(i1!.every((b) => b === 0)).toBe(true);
    expect(i2!.every((b) => b === 0)).toBe(true);
  });
});

describe('EDGE: mockSearchIndex ASCII codec — non-ASCII bookId', () => {
  it('encryptMockSearchIndex throws a clear error for a bookId containing a non-ASCII character (accented letter)', async () => {
    const key = randomKey();
    await expect(encryptMockSearchIndex('boök-1', key)).rejects.toThrow(/asciiEncode: non-ASCII character/);
  });

  it('encryptMockSearchIndex throws a clear error for a bookId containing an em-dash', async () => {
    const key = randomKey();
    await expect(encryptMockSearchIndex('book—1', key)).rejects.toThrow(/asciiEncode: non-ASCII character/);
  });

  it('createMockSearchIndex itself does not throw for a non-ASCII bookId (only the encode step is ASCII-only)', async () => {
    // createMockSearchIndex just builds the structured object — no encoding happens there, so a
    // non-ASCII bookId flows through fine; the failure should surface only at encryptMockSearchIndex.
    const built = await createMockSearchIndex('boök-1');
    expect(built.bookId).toBe('boök-1');
  });

  it('createMockSearchIndex\'s own generated content (chapter ids, snippets, cfi strings) is pure ASCII and never trips asciiEncode for an ASCII bookId', async () => {
    const key = randomKey();
    await expect(encryptMockSearchIndex('plain-ascii-book', key)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('EDGE: decryptSearchIndex on a fresh session after close() — no aliasing/stale data', () => {
  it('a NEW session after close() decrypts the index independently, not aliased to the closed (zeroed) buffer', async () => {
    const bookId = 'idx-edge-reopen-no-alias';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(512, 'reopen independence'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    const first = await decryptSearchIndex(bookId);
    expect(first).not.toBeNull();
    await contentStore.close(bookId); // zeroes `first` in place
    expect(first!.every((b) => b === 0)).toBe(true);

    await contentStore.openSession(bookId);
    const second = await decryptSearchIndex(bookId);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.every((b) => b === 0)).toBe(false);
    expect(decodeSearchIndex(second!).bookId).toBe(bookId);
  });

  it('OPEN ACCESS: closing a session must not zero the persisted/cached package index, corrupting a later re-open of the same book', async () => {
    const bookId = 'idx-edge-oa-reopen-no-corruption';
    const plaintext = plaintextOf(256, 'open access index reopen');
    const originalIndex = plaintextOf(64, 'open access index bytes');
    const expected = new Uint8Array(originalIndex); // defensive copy, immune to aliasing

    await contentStore.store(openAccessPackageWithIndex(bookId, plaintext, originalIndex));
    await contentStore.openSession(bookId);
    const first = await decryptSearchIndex(bookId);
    expect(Buffer.from(first!).equals(Buffer.from(expected))).toBe(true);

    await contentStore.close(bookId);

    await contentStore.openSession(bookId);
    const second = await decryptSearchIndex(bookId);
    // If the open-access branch aliased session.indexPlaintext directly to pkg.index instead of
    // copying, close()'s fill(0) would have zeroed the cached package's index too.
    expect(Buffer.from(second!).equals(Buffer.from(expected))).toBe(true);
  });
});

describe('EDGE: no open session at all', () => {
  it('decryptSearchIndex on a bookId that never had openSession() called throws ContentFailure(DECRYPTION_FAILED), same shape as decryptBook', async () => {
    await expect(decryptSearchIndex('idx-edge-never-opened')).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
    // Cross-check against decryptBook's own rejection shape for the same never-opened bookId.
    await expect(contentStore.decryptBook('idx-edge-never-opened-2')).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  });
});

describe('EDGE: re-store() with a different index while a session is already open', () => {
  it('an already-open session keeps returning the FIRST index (session-cached), even after a later store() with a different index — same documented behavior as session.plaintext', async () => {
    const bookId = 'idx-edge-double-store-open-session';
    const key1 = randomKey();
    const key2 = randomKey();
    const pkgA = await buildEncryptedPackageWithIndex(bookId, plaintextOf(200, 'v1 body'), key1);
    await storeBek(bookId, key1);
    await contentStore.store(pkgA);

    await contentStore.openSession(bookId);
    const firstIndex = await decryptSearchIndex(bookId);
    expect(firstIndex).not.toBeNull();

    // A different mock index would be identical in content (mock generator is deterministic), so
    // use an explicit distinguishable raw index this time via a fresh encrypt of different bytes,
    // bypassing the mock generator, to make "still returns the OLD one" unambiguous.
    const distinctIndexPlaintext = plaintextOf(32, 'DISTINCT-V2-INDEX-CONTENT');
    const distinctEncrypted = await encrypt(distinctIndexPlaintext, key2);
    const pkgB = await buildEncryptedPackageWithIndex(bookId, plaintextOf(200, 'v2 body'), key2, {
      index: distinctEncrypted.content,
    });
    await storeBek(bookId, key2);
    await contentStore.store(pkgB);

    const stillFirst = await decryptSearchIndex(bookId);
    expect(stillFirst).toBe(firstIndex); // session-cached, unaffected by the later store()

    // A brand new session (post-update) sees the new index.
    await contentStore.close(bookId);
    await contentStore.openSession(bookId);
    const newIndex = await decryptSearchIndex(bookId);
    expect(Buffer.from(newIndex!).equals(Buffer.from(distinctIndexPlaintext))).toBe(true);
  });
});

describe('EDGE: RAM budget — decryptSearchIndex vs MAX_DECRYPTED_BYTES', () => {
  it('an index whose PLAINTEXT size exceeds MAX_DECRYPTED_BYTES is rejected, mirroring decryptBook\'s own budget check', async () => {
    const bookId = 'idx-edge-oversized';
    const key = randomKey();
    const oversizedIndexPlaintext = plaintextOf(MAX_DECRYPTED_BYTES + 1024, 'oversized index');
    const encryptedIndex = await encrypt(oversizedIndexPlaintext, key);
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(64, 'small body'), key, {
      index: encryptedIndex.content,
    });
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    await expect(decryptSearchIndex(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  }, 30_000);
});

describe('EDGE: createMockSearchIndex / encryptMockSearchIndex determinism', () => {
  it('createMockSearchIndex produces identical structure across two calls for the same bookId', async () => {
    const a = await createMockSearchIndex('idx-edge-determinism');
    const b = await createMockSearchIndex('idx-edge-determinism');
    expect(a).toEqual(b);
  });

  it('encryptMockSearchIndex produces DIFFERENT ciphertext bytes (fresh nonce) but the SAME decoded structure across two calls', async () => {
    const key = randomKey();
    const encA = await encryptMockSearchIndex('idx-edge-determinism-2', key);
    const encB = await encryptMockSearchIndex('idx-edge-determinism-2', key);

    // Nonces (and therefore full ciphertexts) must differ between independent encrypt calls.
    expect(Buffer.from(encA).equals(Buffer.from(encB))).toBe(false);

    const nonceA = encA.subarray(0, NONCE_BYTES);
    const nonceB = encB.subarray(0, NONCE_BYTES);
    expect(Buffer.from(nonceA).equals(Buffer.from(nonceB))).toBe(false);

    const decodedA = decodeSearchIndex(await decryptRaw(encA.subarray(NONCE_BYTES), nonceA, key));
    const decodedB = decodeSearchIndex(await decryptRaw(encB.subarray(NONCE_BYTES), nonceB, key));
    expect(decodedA).toEqual(decodedB);
  });
});

describe('EDGE: open-access index with degenerate lengths', () => {
  it('an empty (zero-length) index on an open-access book is treated as a present-but-empty index, not null', async () => {
    const bookId = 'idx-edge-oa-empty-index';
    const plaintext = plaintextOf(128, 'body');
    const emptyIndex = new Uint8Array(0);

    await contentStore.store(openAccessPackageWithIndex(bookId, plaintext, emptyIndex));
    await contentStore.openSession(bookId);

    const result = await decryptSearchIndex(bookId);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

  it('an index shorter than NONCE_BYTES on an ENCRYPTED book fails loudly as ContentFailure(INTEGRITY_FAILED), not an uncaught primitive error', async () => {
    const bookId = 'idx-edge-too-short-encrypted';
    const key = randomKey();
    const pkg = await buildEncryptedPackageWithIndex(bookId, plaintextOf(64, 'body'), key, {
      index: new Uint8Array(5), // shorter than NONCE_BYTES (12)
    });
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    try {
      await decryptSearchIndex(bookId);
      throw new Error('expected decryptSearchIndex to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.INTEGRITY_FAILED);
    }
  });
});
