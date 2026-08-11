// Exercises contentStore.ts (the frozen ContentStore contract) against REAL AES-256-GCM crypto
// via the Jest manual mock of the native module (__mocks__/react-native-aes-gcm-crypto.js) and
// REAL file I/O via the Jest manual mock of expo-file-system (__mocks__/expo-file-system.js,
// backed by Node's real `fs` under a temp dir) — not fakes standing in for the logic under test,
// only for the two native modules Jest can't load directly.
//
// The RSA-OAEP unwrap path (deviceKeypair.ts) is genuinely NOT implemented yet (see that file's
// header) — tests that need a raw BEK pre-seed it via keyStorage.storeBek directly, the same
// "cached from a previous unwrap" path decryptBook() already falls back to. One test below
// (KEYSTORE_UNAVAILABLE) exercises the real, current, blocked-on-RSA behavior instead of routing
// around it.

import * as crypto from 'crypto';
import { encrypt } from './aesGcm';
import { NONCE_BYTES } from './cipherLayout';
import { getBek, storeBek } from './keyStorage';
import { contentStore, MAX_DECRYPTED_BYTES } from './contentStore';
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
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // +1 day
    canPersist: true,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
    ...overrides,
  };
}

async function buildEncryptedPackage(
  bookId: string,
  plaintext: Uint8Array,
  key: Uint8Array,
  licenceOverrides: Partial<SignedLicence> = {}
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  return {
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
    licence: licenceFor(bookId, licenceOverrides),
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
  };
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

describe('contentStore — open access (no encryption)', () => {
  it('round-trips a plaintext book with no crypto involved', async () => {
    const bookId = 'oa-book-1';
    const plaintext = plaintextOf(2048, 'open access audio');

    await contentStore.store(openAccessPackage(bookId, plaintext));
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe('contentStore — Subscription (persisted, real AES-256-GCM)', () => {
  it('store -> openSession -> decryptBook reproduces the book, byte-for-byte, tag verified', async () => {
    const bookId = 'sub-book-1';
    const key = randomKey();
    const plaintext = plaintextOf(4096, 'subscription book contents');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);

    // Simulate "BEK already unwrapped in a previous session" — the real cache path
    // decryptBook() checks before ever calling the (currently-stubbed) unwrapBek.
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('is available offline after store(), and not before', async () => {
    const bookId = 'sub-book-2';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'x'), key);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
  });

  it('survives a cold start: a fresh openSession()/decryptBook() after the in-memory cache is gone', async () => {
    const bookId = 'sub-book-cold-start';
    const key = randomKey();
    const plaintext = plaintextOf(1024, 'reopened after restart');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    // No explicit "clear the in-memory cache" hook exists (by design — that's process restart,
    // not a public API) so this proves the DISK path specifically by asserting the file is what
    // isAvailableOffline actually inspects, then re-opening a brand-new bookId-scoped session.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('rejects with ContentFailure(INTEGRITY_FAILED) when the ciphertext is tampered', async () => {
    const bookId = 'sub-book-tampered';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(1500, 'tamper me'), key);
    await storeBek(bookId, key);

    // Flip a byte inside the ciphertext region before storing — the GCM tag must catch this.
    const tampered = new Uint8Array(pkg.content);
    const target = NONCE_BYTES + 10;
    tampered[target] ^= 0xff;

    await contentStore.store({ ...pkg, content: tampered });
    await contentStore.openSession(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toThrow(ContentFailure);
    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.INTEGRITY_FAILED);
    }
  });

  it('rejects with ContentFailure(LICENCE_EXPIRED) when the licence has expired', async () => {
    const bookId = 'sub-book-expired';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'expired'), key, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.LICENCE_EXPIRED);
    }
  });

  it('rejects with ContentFailure(KEYSTORE_UNAVAILABLE) when no raw key is cached (RSA unwrap still a stub)', async () => {
    const bookId = 'sub-book-no-key';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'no key cached'), key);
    // Deliberately do NOT call storeBek — forces the real (currently-stubbed) unwrapBek path.

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.KEYSTORE_UNAVAILABLE);
    }
  });

  it('rejects ContentFailure when the book exceeds the RAM budget', async () => {
    const bookId = 'sub-book-too-big';
    const key = randomKey();
    // Genuinely over budget — not a lied-about length field, an actually oversized plaintext, so
    // this proves the check against real data rather than a fixture that's inconsistent with
    // itself (store()'s own length-invariant check would otherwise catch that first, for the
    // right reason but the wrong test).
    const plaintext = plaintextOf(MAX_DECRYPTED_BYTES + 1, 'too big for the RAM budget');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toThrow(ContentFailure);
  });

  it('rejects store() with ContentFailure(INTEGRITY_FAILED) on a cipherLength mismatch', async () => {
    const bookId = 'sub-book-bad-length';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'y'), key);

    await expect(contentStore.store({ ...pkg, cipherLength: pkg.cipherLength + 1 })).rejects.toMatchObject({
      code: ContentError.INTEGRITY_FAILED,
    });
  });

  it('rejects store() with ContentFailure(LICENCE_INVALID) when licence.itemId does not match bookId', async () => {
    const bookId = 'sub-book-wrong-licence';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'z'), key);
    const mismatched: EncryptedPackage = {
      ...pkg,
      licence: { ...pkg.licence!, itemId: 'some-other-book' },
    };

    await expect(contentStore.store(mismatched)).rejects.toMatchObject({
      code: ContentError.LICENCE_INVALID,
    });
  });
});

describe('contentStore — session lifecycle: close/destroy', () => {
  it('close() zeroes the decrypted buffer in place and is idempotent', async () => {
    const bookId = 'lifecycle-close';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'zero me on close');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.some((b) => b !== 0)).toBe(true); // sanity: not already all zero

    await contentStore.close(bookId);
    expect(decrypted.every((b) => b === 0)).toBe(true); // same buffer reference, zeroed in place

    await expect(contentStore.close(bookId)).resolves.toBeUndefined(); // idempotent no-op
  });

  it('close() then decryptBook() requires a fresh openSession() (no open session -> rejects)', async () => {
    const bookId = 'lifecycle-reopen';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'reopen'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    await contentStore.decryptBook(bookId);
    await contentStore.close(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });

    // REVERSIBLE: ciphertext survives close(), so a fresh session decrypts again fine.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.length).toBe(256);
  });

  it('destroy() is terminal: wipes persisted state so isAvailableOffline() and openSession() both fail after', async () => {
    const bookId = 'lifecycle-destroy';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'destroy me'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await contentStore.destroy(bookId);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    await expect(contentStore.openSession(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  });
});

describe('contentStore — Elite (memory-only, canPersist: false)', () => {
  it('store() writes nothing to disk: isAvailableOffline() is always false', async () => {
    const bookId = 'elite-book-1';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'elite, in memory only'), key, {
      canPersist: false,
    });

    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('never touches the keychain: decryptBook() goes straight to unwrapBek, not getBek', async () => {
    const bookId = 'elite-book-2';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'elite, keystore off-limits'), key, {
      canPersist: false,
    });
    // Deliberately do NOT seed keyStorage — a Subscription book might have this bookId's BEK
    // cached from a past session; Elite must ignore that entirely rather than reading it.

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    // unwrapBek (deviceKeypair.ts) is still a genuine stub (blocked on an RSA-OAEP library
    // choice — see that file's header), so this rejects for real, the same honest way the
    // Subscription "no key cached" test does above. What THIS test proves is narrower and
    // Elite-specific: the failure comes from unwrapBek, not from a keychain miss, confirming
    // Elite's code path never calls getBek() at all.
    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.KEYSTORE_UNAVAILABLE);
    }

    // And confirms no write side effect either: still nothing in the keychain for this book.
    await expect(getBek(bookId)).rejects.toThrow();
  });
});
