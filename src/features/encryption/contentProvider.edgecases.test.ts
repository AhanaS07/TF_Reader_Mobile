// Edge cases specific to contentProvider.ts's WIRING — not re-testing contentStore's own
// internal correctness (that's contentStore.test.ts / contentStore.edgecases.test.ts).
//
// Focus: does the thin getBook()/closeBook() wrapper behave IDENTICALLY to calling
// contentStore.openSession/decryptBook/close directly, in cases where the two calls inside
// getBook() could plausibly diverge (openSession succeeds, decryptBook then rejects), and does
// the wrapper hold any state of its own (it shouldn't — verified empirically here).

import * as crypto from 'crypto';
import { encrypt } from './aesGcm';
import { storeBek } from './keyStorage';
import { contentStore } from './contentStore';
import { getBook, closeBook, contentProvider } from './contentProvider';
import { ContentFailure, ContentError } from '@/shared/contracts';
import type { EncryptedPackage } from '@/shared/contracts';

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function encryptedPackage(bookId: string, plaintext: Uint8Array, payload: { content: Uint8Array; cipherLength: number; originalLength: number }, overrides: Partial<EncryptedPackage> = {}): EncryptedPackage {
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
    licence: {
      licenceId: `lic-${bookId}`,
      itemId: bookId,
      keyFingerprint: 'sha256:test-fingerprint',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      canPersist: true,
      rights: { print: false },
    },
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
    ...overrides,
  };
}

describe('contentProvider.getBook — openSession succeeds, decryptBook rejects', () => {
  it('propagates INTEGRITY_FAILED (tampered ciphertext) as a clean ContentFailure, not swallowed/wrapped', async () => {
    const bookId = 'provider-edge-tamper-1';
    const key = randomKey();
    const plaintext = plaintextOf(2048, 'tamper me after encrypting');
    const payload = await encrypt(plaintext, key);

    // Flip a byte inside the ciphertext region (after the 12-byte nonce) to break the GCM tag
    // without changing lengths — openSession must still succeed (package + lengths are intact);
    // only decryptBook should fail.
    const tampered = new Uint8Array(payload.content);
    tampered[20] ^= 0xff;

    const pkg = encryptedPackage(bookId, plaintext, { ...payload, content: tampered });
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    // openSession alone must succeed (proves the failure is decryptBook's, not openSession's).
    await expect(contentStore.openSession(bookId)).resolves.toMatchObject({ bookId });

    await expect(getBook(bookId)).rejects.toMatchObject({
      code: ContentError.INTEGRITY_FAILED,
      bookId,
    });
  });

  it('propagates LICENCE_EXPIRED as a clean ContentFailure after openSession already succeeded', async () => {
    const bookId = 'provider-edge-expired-1';
    const key = randomKey();
    const plaintext = plaintextOf(1024, 'expired licence');
    const payload = await encrypt(plaintext, key);

    const pkg = encryptedPackage(bookId, plaintext, payload, {
      licence: {
        licenceId: `lic-${bookId}`,
        itemId: bookId,
        keyFingerprint: 'sha256:test-fingerprint',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
        canPersist: true,
        rights: { print: false },
      },
    });
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await expect(getBook(bookId)).rejects.toEqual(
      expect.objectContaining({ code: ContentError.LICENCE_EXPIRED, bookId })
    );
    // And it stays a real ContentFailure instance through the wrapper, not re-thrown as something else.
    await expect(getBook(bookId)).rejects.toBeInstanceOf(ContentFailure);
  });
});

describe('contentProvider.closeBook — no assumptions beyond contentStore.close', () => {
  it('no-ops on a book that was never opened via getBook (or at all)', async () => {
    await expect(closeBook('provider-edge-never-opened')).resolves.toBeUndefined();
    // Calling it again is still a no-op.
    await expect(closeBook('provider-edge-never-opened')).resolves.toBeUndefined();
  });

  it('close then getBook again re-opens a fresh session and decrypts again, with no stale wrapper state', async () => {
    const bookId = 'provider-edge-reopen-1';
    const key = randomKey();
    const plaintext = plaintextOf(1024, 'reopen after close');
    const payload = await encrypt(plaintext, key);
    const pkg = encryptedPackage(bookId, plaintext, payload);

    await storeBek(bookId, key);
    await contentStore.store(pkg);

    const first = await getBook(bookId);
    expect(Buffer.from(first).equals(Buffer.from(plaintext))).toBe(true);

    await closeBook(bookId);
    expect(first.every((b: number) => b === 0)).toBe(true); // closed: zeroed in place

    // Immediately re-open via the SAME wrapper function for the SAME bookId.
    const second = await getBook(bookId);
    expect(Buffer.from(second).equals(Buffer.from(plaintext))).toBe(true);
    // A fresh buffer, not the same (already-zeroed) reference as `first`.
    expect(second).not.toBe(first);

    await closeBook(bookId);
  });
});

describe('contentProvider object identity', () => {
  it('contentProvider.getBook is the exact same function reference as the named export', () => {
    expect(contentProvider.getBook).toBe(getBook);
  });

  it('calling contentProvider.getBook(id) behaves identically to calling getBook(id) directly', async () => {
    const bookId = 'provider-edge-identity-1';
    const plaintext = plaintextOf(256, 'same behavior either way');
    await contentStore.store({
      bookId,
      format: 'AUDIO',
      content: plaintext,
      encryption: null,
      licence: null,
      cipherLength: plaintext.length,
      originalLength: plaintext.length,
      mimeType: 'audio/mpeg',
    });

    const viaNamed = await getBook(bookId);
    expect(Buffer.from(viaNamed).equals(Buffer.from(plaintext))).toBe(true);
    await closeBook(bookId);

    // Re-open via the object-method form for the same bookId — closeBook zeroed `viaNamed`
    // in place, so compare against the known plaintext rather than the now-zeroed buffer.
    const viaProvider = await contentProvider.getBook(bookId);
    expect(Buffer.from(viaProvider).equals(Buffer.from(plaintext))).toBe(true);
    await closeBook(bookId);
  });
});
