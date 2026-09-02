// Owner: Encryption (Abhinav).
//
// Stores/retrieves a book's BEK (the raw AES-256 key `aesGcm.ts` decrypts with) in the device's
// secure keychain/keystore, via `react-native-keychain`'s real API (setGenericPassword /
// getGenericPassword / resetGenericPassword — confirmed by reading the installed package's own
// type definitions, not assumed). One keychain "service" entry per book, namespaced so multiple
// books' BEKs don't collide.
//
// UNLIKE aesGcm.ts's original Node-crypto version, this was always meant to be the real
// production implementation, not a Node stand-in.
//
// FIXED 2026-08-11 (was a real, confirmed bug, not a theoretical one): this originally used
// Node's `Buffer` for base64 encode/decode. Running on an actual iOS Simulator, `storeBek`
// failed immediately with "Property 'Buffer' doesn't exist" — `Buffer` is not a React Native
// global. Swapped to the portable codec in ./base64.ts (already used by aesGcm.ts, cross-checked
// against Node's own Buffer for correctness before either file trusted it).

import * as Keychain from 'react-native-keychain';
import { bytesToBase64, base64ToBytes } from './base64';

const SERVICE_PREFIX = 'tf-reader-bek:';

function serviceFor(bookId: string): string {
  return `${SERVICE_PREFIX}${bookId}`;
}

/**
 * Stores `key` (a book's raw BEK) in the device keychain, namespaced by `bookId`. Overwrites
 * any previously-stored BEK for the same book.
 *
 * @param bookId - which book this key belongs to (used as the keychain service namespace)
 * @param key - raw BEK bytes to store
 * @throws if the keychain rejects the write
 */
export async function storeBek(bookId: string, key: Uint8Array): Promise<void> {
  // THIS_DEVICE_ONLY: a BEK cached without it survives an encrypted backup/restore onto a second
  // device, which can then decrypt this book's ciphertext without ever going through a real
  // download or entitlement check on that device (full-audit-report.md S2).
  const result = await Keychain.setGenericPassword(bookId, bytesToBase64(key), {
    service: serviceFor(bookId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (result === false) {
    throw new Error(`storeBek: keychain rejected storing the BEK for book "${bookId}"`);
  }
}

/**
 * Retrieves the previously-stored BEK for `bookId`.
 *
 * @param bookId - which book's key to retrieve
 * @throws if no BEK is stored for this book
 */
export async function getBek(bookId: string): Promise<Uint8Array> {
  const credentials = await Keychain.getGenericPassword({ service: serviceFor(bookId) });
  if (credentials === false) {
    throw new Error(`getBek: no BEK stored for book "${bookId}"`);
  }
  return base64ToBytes(credentials.password);
}

/**
 * Removes the stored BEK for `bookId` — e.g. when the licence is invalidated on revocation
 * (contentStore.invalidateLicence strips the BEK but leaves ciphertext on disk for potential
 * re-download), when the book is deleted locally (contentStore.destroy), or on key rotation.
 *
 * @param bookId - which book's key to remove
 */
export async function deleteBek(bookId: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: serviceFor(bookId) });
}
