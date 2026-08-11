// Owner: Encryption (Abhinav).
//
// Phase 1 encryption round-trip spike (see BuildPlan.md). Whole-file AES-256-GCM: one nonce,
// one ciphertext, one GCM tag for the entire book (text or audio) — see cipherLayout.ts for the
// exact `content` byte layout (nonce | ciphertext | tag) this module produces and consumes.
//
// ENVIRONMENT NOTE — read before touching this file:
// Today's implementation uses Node's built-in `crypto` module directly (createCipheriv /
// createDecipheriv with 'aes-256-gcm'). That is genuinely correct, spec-compliant AES-256-GCM —
// not a mock — which is what lets us prove the round-trip and tamper-detection behavior in this
// spike, in a plain Node/Jest environment, before any native toolchain exists.
//
// Node's `crypto` module does NOT exist in the React Native JS runtime. Once P0-1 (Expo
// bootstrap) lands and `react-native-aes-gcm-crypto` is installed, `encrypt`/`decrypt` below
// should be swapped to delegate to that native module for on-device use instead — same function
// signatures, same CipherPayload shape in/out, different implementation body. That swap is the
// only thing that needs to change; callers should not need to change.

import * as crypto from 'crypto';
import { CipherPayload, NONCE_BYTES, GCM_TAG_BYTES, assertCipherLayout } from './cipherLayout';

const KEY_BYTES = 32; // AES-256

/**
 * Encrypts `plaintext` with AES-256-GCM under `key`, producing a CipherPayload whose `content`
 * is laid out as nonce (12B) || ciphertext (originalLength B) || GCM tag (16B), per
 * cipherLayout.ts.
 *
 * @param plaintext - raw bytes to encrypt (e.g. a whole book file's contents)
 * @param key - 256-bit (32 byte) AES key
 */
export function encrypt(plaintext: Uint8Array, key: Uint8Array): CipherPayload {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encrypt: key must be ${KEY_BYTES} bytes (AES-256), got ${key.length}`);
  }

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  if (tag.length !== GCM_TAG_BYTES) {
    throw new Error(`encrypt: unexpected GCM tag length ${tag.length}, expected ${GCM_TAG_BYTES}`);
  }

  const content = new Uint8Array(Buffer.concat([nonce, ciphertext, tag]));
  const originalLength = plaintext.length;
  const cipherLength = content.length;

  const payload: CipherPayload = { content, cipherLength, originalLength };

  // Sanity-check our own output against the shared layout invariant before returning it.
  assertCipherLayout(payload);

  return payload;
}

/**
 * Decrypts a CipherPayload produced by `encrypt` (or anything conforming to the same layout)
 * back into plaintext bytes.
 *
 * Throws if:
 *  - the payload's structural layout is inconsistent (via assertCipherLayout), or
 *  - the GCM authentication tag fails to verify — i.e. the ciphertext/tag was corrupted or
 *    tampered with. That failure is intentionally NOT caught/swallowed here; callers must see it.
 *
 * @param payload - CipherPayload to decrypt
 * @param key - 256-bit (32 byte) AES key used for the original encryption
 */
export function decrypt(payload: CipherPayload, key: Uint8Array): Uint8Array {
  assertCipherLayout(payload);

  if (key.length !== KEY_BYTES) {
    throw new Error(`decrypt: key must be ${KEY_BYTES} bytes (AES-256), got ${key.length}`);
  }

  const { content } = payload;
  const nonce = content.subarray(0, NONCE_BYTES);
  const tag = content.subarray(content.length - GCM_TAG_BYTES);
  const ciphertext = content.subarray(NONCE_BYTES, content.length - GCM_TAG_BYTES);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  // decipher.final() throws if the auth tag doesn't verify (tamper/corruption detection).
  // Deliberately not wrapped in try/catch: that error must propagate to the caller.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return new Uint8Array(plaintext);
}
