// Owner: Encryption (Abhinav).
//
// Whole-file AES-256-GCM via the REAL native module `react-native-aes-gcm-crypto` — this is
// production code meant to run on-device (we're building against expo-dev-client, which
// supports real native modules, unlike Expo Go), not a Node stand-in. See cipherLayout.ts for
// the `content` byte layout (nonce | ciphertext | tag) this module produces and consumes.
//
// CONFIRMED 2026-08-11 by actually bundling through Metro (temporarily wired into App.tsx,
// requested the real bundle, reverted): the previous Node-`crypto`-backed version of this file
// failed with "Unable to resolve module crypto" — Metro doesn't polyfill it. This version
// bundles clean. What's still unverified (no simulator/device in this environment): the actual
// native AES-GCM execution at runtime. See src/features/encryption/aesGcm.test.ts, which
// exercises this file's real code against a Jest manual mock of the native module
// (__mocks__/react-native-aes-gcm-crypto.js, Node-crypto-backed) — that proves the adapter
// logic (base64/hex conversion, nonce/ciphertext/tag assembly) is correct; it does not prove
// the native module's own AES-GCM implementation is correct, which is Metro's/the library's
// job, not ours.
//
// Native API (react-native-aes-gcm-crypto, confirmed by reading its installed type defs):
//   encrypt(plainText: string, inBinary: boolean, key: string): Promise<{iv, tag, content}>
//   decrypt(ciphertext: string, key: string, iv: string, tag: string, isBinary: boolean): Promise<string>
// `key`/`content`/decrypted-output are base64; `iv`/`tag` are HEX (confirmed against the
// package's own README example, cross-checked byte lengths: 12-byte iv = 24 hex chars, 16-byte
// tag = 32 hex chars). This module's job is entirely the adapter between that shape and our
// concatenated nonce|ciphertext|tag CipherPayload.content layout.
//
// No Buffer: this file runs in the RN JS runtime, which doesn't have Node's Buffer without a
// polyfill (unlike the Node-only scripts under scripts/, which still use Buffer deliberately —
// see their own headers). Hex codec (needed only here, for iv/tag) is portable Uint8Array
// arithmetic below — iv/tag are 12/16 bytes, far too small for a codec choice to matter.
//
// CONFIRMED on-device 2026-08-11: this file's encrypt/decrypt round-trip actually works at
// runtime (not just "compiles") — logged RUNTIME_TEST: aesGcm roundTripOk= true from a real
// iOS Simulator run. keyStorage.ts's ORIGINAL Buffer-based version failed at the same time with
// "Property 'Buffer' doesn't exist" — which is exactly why this file never used Buffer to begin
// with, and why keyStorage.ts was fixed to use ./base64.ts too.
//
// BASE64 CODEC (changed 2026-08-14): the native module's string-only API means every call here
// round-trips the WHOLE plaintext/ciphertext through base64 twice — once to encode the input,
// once to decode the output — and for a whole-book payload that pair dominates this file's own
// cost. `readerAssets.ts` already proved (measured, not assumed) that swapping the portable JS
// codec (./base64.ts) for `react-native-quick-base64`'s native (C++/JSI) one cut its OWN transport
// encode from ~1820ms to ~18ms on Hermes for a 20MB payload — ~100x, not a rounding difference.
// This file is the OTHER half of that same round trip (readerAssets.ts's own header: "~93% [of a
// warm open] is inside getBook, which base64-ENCODES the ciphertext and DECODES the plaintext
// around a string-only native module... it belongs to Encryption, not here" — this IS that fix,
// on Encryption's side). `./base64.ts` remains correct and is kept as the portable fallback for
// callers that must not depend on a native module (see its own header) — this file already
// requires one (`react-native-aes-gcm-crypto`), so adding a second native codec dependency here
// costs nothing architecturally. `key`/`iv`/`tag` stay on the same codec as the payload rather
// than mixing two, for one code path to reason about.

import AesGcmCrypto from 'react-native-aes-gcm-crypto';
import { fromByteArray, toByteArray } from 'react-native-quick-base64';
import { CipherPayload, NONCE_BYTES, GCM_TAG_BYTES, assertCipherLayout } from './cipherLayout';

const KEY_BYTES = 32; // AES-256

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `key` via the native module, producing a
 * CipherPayload whose `content` is laid out as nonce (12B) || ciphertext (originalLength B) ||
 * GCM tag (16B), per cipherLayout.ts.
 *
 * @param plaintext - raw bytes to encrypt (e.g. a whole book file's contents)
 * @param key - 256-bit (32 byte) AES key
 */
export async function encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<CipherPayload> {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encrypt: key must be ${KEY_BYTES} bytes (AES-256), got ${key.length}`);
  }

  const { iv, tag, content } = await AesGcmCrypto.encrypt(fromByteArray(plaintext), true, fromByteArray(key));

  const nonce = hexToBytes(iv);
  const ciphertext = toByteArray(content);
  const tagBytes = hexToBytes(tag);

  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`encrypt: native module returned a ${nonce.length}-byte iv, expected ${NONCE_BYTES}`);
  }
  if (tagBytes.length !== GCM_TAG_BYTES) {
    throw new Error(`encrypt: native module returned a ${tagBytes.length}-byte tag, expected ${GCM_TAG_BYTES}`);
  }

  const assembled = new Uint8Array(nonce.length + ciphertext.length + tagBytes.length);
  assembled.set(nonce, 0);
  assembled.set(ciphertext, nonce.length);
  assembled.set(tagBytes, nonce.length + ciphertext.length);

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
 * The decrypt PRIMITIVE — three raw arguments in, plaintext out, GCM tag verified by the
 * native module. This is the building block `decrypt(payload, key)` below (and eventually
 * Ahana's `ContentStore.decryptBook`) is built on.
 *
 * `ciphertextWithTag` convention: ciphertext with the 16-byte GCM tag appended at the end —
 * matches WebCrypto's `crypto.subtle.decrypt('AES-GCM', ...)` convention. This function does
 * the split into native's separate ciphertext/tag arguments, so callers don't have to.
 *
 * Throws if the GCM authentication tag fails to verify (rejects, since this is now async) —
 * i.e. `ciphertextWithTag` was corrupted/tampered, or `nonce`/`key` don't match. That failure
 * is intentionally NOT caught/swallowed here; callers must see it (fail-closed).
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

  // decrypt() rejects if the auth tag doesn't verify (tamper/corruption detection). Deliberately
  // not wrapped in try/catch: that rejection must propagate to the caller.
  const decryptedBase64 = await AesGcmCrypto.decrypt(
    fromByteArray(ciphertext),
    fromByteArray(key),
    bytesToHex(nonce),
    bytesToHex(tag),
    true // isBinary: return decrypted data as base64, since our plaintext is arbitrary bytes
  );

  return toByteArray(decryptedBase64);
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
export async function decrypt(payload: CipherPayload, key: Uint8Array): Promise<Uint8Array> {
  assertCipherLayout(payload);

  const { content } = payload;
  const nonce = content.subarray(0, NONCE_BYTES);
  const ciphertextWithTag = content.subarray(NONCE_BYTES);

  return decryptBook(ciphertextWithTag, nonce, key);
}
