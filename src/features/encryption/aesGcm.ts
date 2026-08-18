// Owner: Encryption (Abhinav).
//
// Whole-file AES-256-GCM via `react-native-quick-crypto` (Nitro/JSI) — REPLACES the previous
// `react-native-aes-gcm-crypto`-backed version (see cipherLayout.ts for the `content` byte layout
// this module produces/consumes: nonce | ciphertext | tag).
//
// WHY THIS SWAP (2026-08-18) — the double base64 hop was the remaining lever on peak memory, not
// a rounding difference: `react-native-aes-gcm-crypto`'s native API is STRING-ONLY (base64 in,
// base64 out), so every encrypt/decrypt materialised the WHOLE plaintext/ciphertext as a base64
// STRING on top of the Uint8Array it came from — twice, once per direction. Swapping the base64
// CODEC itself (2026-08-14, `react-native-quick-base64`) made that hop ~100x faster but did not
// remove it: the peak-memory measurement in the repo's own notes stayed flat across both codec
// swaps ("time fell by ~30x, the peak did not move" — CLAUDE.md's known-open-items table) because
// the hop was never about time, it was about materialising an extra full-size copy at all.
// `react-native-quick-crypto` is already a dependency (deviceKeypair.ts's RSA-OAEP), and its
// `createCipheriv`/`createDecipheriv` take/return `Buffer`/`Uint8Array` directly (confirmed by
// reading the installed package's own generated type defs, cipher.d.ts: `update(data: Buffer):
// Buffer`, `getAuthTag(): Buffer`, `setAuthTag(tag: Buffer)`) — no string intermediate at all, so
// this removes the copy rather than speeding it up.
//
// HONEST LIMITATION, not glossed over — same caveat every native-module swap in this codebase
// carries: this has been exercised through the Jest manual mock (__mocks__/react-native-quick-
// crypto.js, real Node `crypto` underneath — genuine AES-256-GCM math, not a fake) and proves the
// ADAPTER logic here (nonce generation, assembly, tag split, error propagation) is correct. It
// does NOT by itself prove the peak-memory number actually drops on a real device — that needs
// the same on-device RUNTIME_TEST + memory-profiler pass the original `react-native-aes-gcm-
// crypto` swap got (CLAUDE.md's known-open-items table), which this change has not yet had.
// `react-native-aes-gcm-crypto` stays an installed dependency (other files' comments and the
// patch-package patch still reference it) — nothing else in this repo imports it after this
// change, but removing the dependency itself is a separate, uneventful cleanup, not bundled here.

import { createCipheriv, createDecipheriv, randomBytes } from 'react-native-quick-crypto';
import { CipherPayload, NONCE_BYTES, GCM_TAG_BYTES, assertCipherLayout } from './cipherLayout';

const KEY_BYTES = 32; // AES-256
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts `plaintext` with AES-256-GCM under `key`, producing a CipherPayload whose `content` is
 * laid out as nonce (12B) || ciphertext (originalLength B) || GCM tag (16B), per cipherLayout.ts.
 *
 * @param plaintext - raw bytes to encrypt (e.g. a whole book file's contents)
 * @param key - 256-bit (32 byte) AES key
 */
export async function encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<CipherPayload> {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encrypt: key must be ${KEY_BYTES} bytes (AES-256), got ${key.length}`);
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: GCM_TAG_BYTES });
  const ciphertextPart = cipher.update(plaintext);
  const finalPart = cipher.final();
  const tag = cipher.getAuthTag();

  if (tag.length !== GCM_TAG_BYTES) {
    throw new Error(`encrypt: cipher returned a ${tag.length}-byte tag, expected ${GCM_TAG_BYTES}`);
  }

  const assembled = new Uint8Array(nonce.length + ciphertextPart.length + finalPart.length + tag.length);
  let offset = 0;
  assembled.set(nonce, offset);
  offset += nonce.length;
  assembled.set(ciphertextPart, offset);
  offset += ciphertextPart.length;
  assembled.set(finalPart, offset);
  offset += finalPart.length;
  assembled.set(tag, offset);

  const payload: CipherPayload = {
    content: assembled,
    cipherLength: assembled.length,
    originalLength: plaintext.length,
  };

  // Sanity-check our own output against the shared layout invariant before returning it.
  assertCipherLayout(payload);

  return payload;
}

/**
 * The decrypt PRIMITIVE — three raw arguments in, plaintext out, GCM tag verified during
 * `final()`. This is the building block `decrypt(payload, key)` below is built on.
 *
 * `ciphertextWithTag` convention: ciphertext with the 16-byte GCM tag appended at the end —
 * matches WebCrypto's `crypto.subtle.decrypt('AES-GCM', ...)` convention. This function does the
 * split into the cipher's separate ciphertext/tag arguments, so callers don't have to.
 *
 * Throws if the GCM authentication tag fails to verify (`final()` throws synchronously on a bad
 * tag — caught by nothing here, so it propagates) — i.e. `ciphertextWithTag` was corrupted/
 * tampered, or `nonce`/`key` don't match. That failure is intentionally NOT caught/swallowed here;
 * callers must see it (fail-closed).
 *
 * @param ciphertextWithTag - ciphertext bytes with the 16-byte GCM tag appended at the end
 * @param nonce - 12-byte GCM nonce/IV used for the original encryption
 * @param key - 256-bit (32 byte) AES key used for the original encryption
 */
export async function decryptBook(
  ciphertextWithTag: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
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

  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: GCM_TAG_BYTES });
  // setAuthTag's declared param type is react-native-quick-crypto's OWN Buffer
  // (@craftzdog/react-native-buffer), not the ambient Node one @types/node puts in scope here —
  // the two are structurally different, so a direct `as Buffer` fails. Deriving the cast target
  // from the method's own signature (rather than importing their Buffer type just for this one
  // line) works regardless of which concrete Buffer implementation is on the other side; `tag` is
  // a real Uint8Array at runtime either way, which is all setAuthTag actually needs.
  decipher.setAuthTag(tag as unknown as Parameters<typeof decipher.setAuthTag>[0]);
  const plaintextPart = decipher.update(ciphertext);
  // Deliberately not wrapped in try/catch: final() rejects/throws on a bad tag (tamper/corruption
  // detection), and that must propagate to the caller, not be swallowed here.
  const finalPart = decipher.final();

  const plaintext = new Uint8Array(plaintextPart.length + finalPart.length);
  plaintext.set(plaintextPart, 0);
  plaintext.set(finalPart, plaintextPart.length);
  return plaintext;
}

/**
 * Decrypts a CipherPayload produced by `encrypt` (or anything conforming to the same layout) back
 * into plaintext bytes. Thin wrapper over `decryptBook` — splits `payload.content` into the nonce
 * prefix and the ciphertext+tag remainder, after checking the structural layout invariant
 * (`assertCipherLayout`) that a type system alone can't enforce.
 *
 * @param payload - CipherPayload to decrypt
 * @param key - 256-bit (32 byte) AES key used for the original encryption
 */
export async function decrypt(payload: CipherPayload, key: Uint8Array): Promise<Uint8Array> {
  assertCipherLayout(payload);

  const { content } = payload;
  const nonce = content.subarray(0, NONCE_BYTES);
  const ciphertextWithTag = content.subarray(NONCE_BYTES);

  return decryptBook(ciphertextWithTag, nonce, key);
}
