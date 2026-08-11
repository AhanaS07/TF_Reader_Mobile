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
//
// ADAPTER NOTE (researched 2026-08-11, package installed but not yet linked/tested on-device —
// no simulator/device available in this environment): `react-native-aes-gcm-crypto`'s real API
// does NOT return/accept the concatenated CipherPayload.content layout directly:
//
//   encrypt(plainText: string, inBinary: boolean, key: string): Promise<{iv, tag, content}>
//   decrypt(base64Ciphertext: string, key: string, iv: string, tag: string, isBinary: boolean): Promise<string>
//
// `iv` (== our `nonce`) and `tag` come back as SEPARATE base64/hex strings from `content`. The
// on-device implementation of `decryptBook` will need to further split its `ciphertextWithTag`
// argument into ciphertext + tag (same split it already does internally for Node's `crypto`)
// and pass nonce/tag as separate strings to the native `decrypt(...)` call — one more split than
// today's Node version needs, since the native API doesn't accept a tag-appended blob at all.
// Also note: that native API takes/returns base64 STRINGS over the
// (non-JSI) NativeModules bridge — for a large audio file this has real serialization/memory
// cost. The package also exposes `encryptFile`/`decryptFile` (operates on native file paths,
// no bridge overhead) — but `decryptFile` writes plaintext straight to a file on disk, which
// conflicts with the "never write plaintext to disk" rule elsewhere in this design. Don't
// default into `decryptFile` without deciding that tradeoff deliberately.
//
// Separately: `react-native-keychain` (also installed) has NO asymmetric crypto API at all —
// it's a secure secret-storage box (setGenericPassword/getGenericPassword/etc.), not a crypto
// library. RSA-OAEP-256 keypair generation and wrap/unwrap (EncryptionDescriptor.wrapAlgorithm)
// needs a different library/native capability; keychain can only store the resulting private
// key once something else produces it. See deviceKeypair.ts.

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
 * The decrypt PRIMITIVE — three raw arguments in, plaintext out, GCM tag verified. This is the
 * building block `decrypt(payload, key)` below (and eventually Ahana's `ContentStore.decryptBook`)
 * is built on. Handed off as the thing Reader/Encryption integration wires against.
 *
 * `ciphertextWithTag` convention: ciphertext with the 16-byte GCM tag APPENDED at the end — the
 * same convention WebCrypto's `crypto.subtle.decrypt('AES-GCM', ...)` uses natively (relevant
 * since content-provider.ts notes the Reader's WebView may call `crypto.subtle.decrypt`
 * directly). Node's `crypto` module needs the tag split out to call `setAuthTag` separately —
 * that split is this function's job, not the caller's.
 *
 * Throws if the GCM authentication tag fails to verify — i.e. `ciphertextWithTag` was corrupted
 * or tampered with, or `nonce`/`key` don't match what it was encrypted under. That failure is
 * intentionally NOT caught/swallowed here; callers must see it (fail-closed).
 *
 * @param ciphertextWithTag - ciphertext bytes with the 16-byte GCM tag appended at the end
 * @param nonce - 12-byte GCM nonce/IV used for the original encryption
 * @param key - 256-bit (32 byte) AES key used for the original encryption
 */
export function decryptBook(ciphertextWithTag: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) {
    throw new Error(`decryptBook: key must be ${KEY_BYTES} bytes (AES-256), got ${key.length}`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`decryptBook: nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }
  if (ciphertextWithTag.length < GCM_TAG_BYTES) {
    throw new Error(
      `decryptBook: ciphertextWithTag too short to contain a ${GCM_TAG_BYTES}-byte tag (got ${ciphertextWithTag.length} bytes)`
    );
  }

  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - GCM_TAG_BYTES);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - GCM_TAG_BYTES);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  // decipher.final() throws if the auth tag doesn't verify (tamper/corruption detection).
  // Deliberately not wrapped in try/catch: that error must propagate to the caller.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return new Uint8Array(plaintext);
}

/**
 * Decrypts a CipherPayload produced by `encrypt` (or anything conforming to the same layout)
 * back into plaintext bytes. Thin wrapper over `decryptBook` — splits `payload.content` into
 * the nonce prefix and the ciphertext+tag remainder, after checking the structural layout
 * invariant (`assertCipherLayout`) that a type system alone can't enforce.
 *
 * @param payload - CipherPayload to decrypt
 * @param key - 256-bit (32 byte) AES key used for the original encryption
 */
export function decrypt(payload: CipherPayload, key: Uint8Array): Uint8Array {
  assertCipherLayout(payload);

  const { content } = payload;
  const nonce = content.subarray(0, NONCE_BYTES);
  const ciphertextWithTag = content.subarray(NONCE_BYTES);

  return decryptBook(ciphertextWithTag, nonce, key);
}
