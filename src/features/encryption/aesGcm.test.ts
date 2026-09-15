// Runs against the real react-native-aes-gcm-crypto API shape via the Jest manual mock at
// __mocks__/react-native-aes-gcm-crypto.js (root-level, auto-applied — see that file's header).
// encrypt/decrypt/decryptBook are async now because the real native module is Promise-based.

import * as crypto from 'crypto';
import { encrypt, decrypt, decryptBook } from './aesGcm';
import { assertCipherLayout, NONCE_BYTES, GCM_TAG_BYTES } from './cipherLayout';

const KEY_BYTES = 32;

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(KEY_BYTES));
}

function makePlaintext(sizeBytes: number): Uint8Array {
  const chunk = 'The quick brown fox jumps over the lazy dog. ';
  const buf = Buffer.alloc(sizeBytes);
  let written = 0;
  while (written < sizeBytes) {
    const remaining = sizeBytes - written;
    const piece = Buffer.from(chunk, 'utf8');
    const slice = piece.subarray(0, Math.min(piece.length, remaining));
    slice.copy(buf, written);
    written += slice.length;
  }
  return new Uint8Array(buf);
}

describe('aesGcm encrypt/decrypt round trip', () => {
  it('encrypts and decrypts a multi-KB plaintext back to byte-for-byte equality', async () => {
    const key = randomKey();
    const plaintext = makePlaintext(4096); // a few KB

    const payload = await encrypt(plaintext, key);
    const decrypted = await decrypt(payload, key);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('produces a payload that satisfies assertCipherLayout', async () => {
    const key = randomKey();
    const plaintext = makePlaintext(2048);

    const payload = await encrypt(plaintext, key);

    expect(() => assertCipherLayout(payload)).not.toThrow();
    expect(payload.cipherLength).toBe(payload.content.length);
    expect(payload.originalLength).toBe(plaintext.length);
    expect(payload.content.length).toBe(NONCE_BYTES + plaintext.length + GCM_TAG_BYTES);
  });

  it('rejects when a byte inside the ciphertext region is corrupted', async () => {
    const key = randomKey();
    const plaintext = makePlaintext(3000);
    const payload = await encrypt(plaintext, key);

    // Copy content and flip a byte squarely inside the ciphertext region (not the nonce prefix,
    // not the trailing tag).
    const corruptedContent = new Uint8Array(payload.content);
    const ciphertextStart = NONCE_BYTES;
    const ciphertextEnd = corruptedContent.length - GCM_TAG_BYTES;
    const targetIndex = ciphertextStart + Math.floor((ciphertextEnd - ciphertextStart) / 2);
    corruptedContent[targetIndex] = corruptedContent[targetIndex] ^ 0xff;

    const corruptedPayload = {
      ...payload,
      content: corruptedContent,
    };

    await expect(decrypt(corruptedPayload, key)).rejects.toThrow();
  });

  it('rejects when a byte inside the GCM tag region is corrupted', async () => {
    const key = randomKey();
    const plaintext = makePlaintext(1500);
    const payload = await encrypt(plaintext, key);

    const corruptedContent = new Uint8Array(payload.content);
    const tagStart = corruptedContent.length - GCM_TAG_BYTES;
    corruptedContent[tagStart] = corruptedContent[tagStart] ^ 0xff;

    const corruptedPayload = {
      ...payload,
      content: corruptedContent,
    };

    await expect(decrypt(corruptedPayload, key)).rejects.toThrow();
  });

  it('round-trips a zero-length plaintext', async () => {
    const key = randomKey();
    const plaintext = new Uint8Array(0);

    const payload = await encrypt(plaintext, key);

    expect(() => assertCipherLayout(payload)).not.toThrow();
    expect(payload.content.length).toBe(NONCE_BYTES + GCM_TAG_BYTES);

    const decrypted = await decrypt(payload, key);
    expect(decrypted.length).toBe(0);
  });
});

describe('decryptBook primitive (ciphertext, nonce, key -> plaintext)', () => {
  it('decrypts real Node-crypto-produced ciphertext+tag independently of encrypt()/CipherPayload', async () => {
    // Deliberately does NOT call encrypt() here — builds the ciphertext by hand with Node's
    // crypto module directly, so this test proves decryptBook against an independent producer,
    // not just against its own sibling function (and not just against the mock's own encrypt).
    const key = randomKey();
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const plaintext = makePlaintext(2500);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertextWithTag = new Uint8Array(Buffer.concat([ciphertext, tag]));

    const decrypted = await decryptBook(ciphertextWithTag, new Uint8Array(nonce), key);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('is what decrypt(payload, key) delegates to (same result either way)', async () => {
    const key = randomKey();
    const plaintext = makePlaintext(1024);
    const payload = await encrypt(plaintext, key);

    const viaDecrypt = await decrypt(payload, key);
    const viaPrimitive = await decryptBook(
      payload.content.subarray(NONCE_BYTES),
      payload.content.subarray(0, NONCE_BYTES),
      key
    );

    expect(Buffer.from(viaPrimitive).equals(Buffer.from(viaDecrypt))).toBe(true);
  });

  it('rejects on a tampered tag (last byte of ciphertextWithTag)', async () => {
    const key = randomKey();
    const payload = await encrypt(makePlaintext(512), key);
    const nonce = payload.content.subarray(0, NONCE_BYTES);
    const ciphertextWithTag = new Uint8Array(payload.content.subarray(NONCE_BYTES));
    ciphertextWithTag[ciphertextWithTag.length - 1] ^= 0xff;

    await expect(decryptBook(ciphertextWithTag, nonce, key)).rejects.toThrow();
  });

  it('rejects on a wrong-length nonce', async () => {
    const key = randomKey();
    const payload = await encrypt(makePlaintext(100), key);
    const ciphertextWithTag = payload.content.subarray(NONCE_BYTES);

    await expect(decryptBook(ciphertextWithTag, new Uint8Array(8), key)).rejects.toThrow(/nonce must be/);
  });

  it('rejects on a wrong-length key', async () => {
    const payload = await encrypt(makePlaintext(100), randomKey());
    const nonce = payload.content.subarray(0, NONCE_BYTES);
    const ciphertextWithTag = payload.content.subarray(NONCE_BYTES);

    await expect(decryptBook(ciphertextWithTag, nonce, new Uint8Array(16))).rejects.toThrow(/key must be/);
  });

  it('rejects on a ciphertextWithTag too short to contain a tag', async () => {
    const key = randomKey();
    const nonce = crypto.randomBytes(NONCE_BYTES);

    await expect(decryptBook(new Uint8Array(4), new Uint8Array(nonce), key)).rejects.toThrow(/too short/);
  });
});
