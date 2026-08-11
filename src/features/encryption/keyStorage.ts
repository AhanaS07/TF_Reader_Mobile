// Owner: Encryption (Abhinav).
//
// Stores/retrieves a book's BEK (the raw AES-256 key `aesGcm.ts` decrypts with) in the device's
// secure keychain/keystore, via `react-native-keychain`'s real API (setGenericPassword /
// getGenericPassword / resetGenericPassword — confirmed by reading the installed package's own
// type definitions, not assumed). One keychain "service" entry per book, namespaced so multiple
// books' BEKs don't collide.
//
// UNLIKE aesGcm.ts, this is meant to be the real production implementation, not a Node stand-in
// — react-native-keychain's JS API is the same on-device as it is here. What's NOT verified is
// whether it actually WORKS on a real device/simulator: there is neither available in this
// environment, so these calls have never actually executed against a real Keychain/Keystore.
//
// KNOWN GAP: uses Node's `Buffer` for base64 encode/decode of the raw key bytes. `Buffer` is not
// guaranteed to exist in the React Native JS runtime without a polyfill (unlike Node, where it's
// a global). Flagging rather than silently assuming — swap for a portable base64 helper (or add
// a `buffer` polyfill via Metro config) before this runs on-device.

import * as Keychain from 'react-native-keychain';

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
  const result = await Keychain.setGenericPassword(bookId, Buffer.from(key).toString('base64'), {
    service: serviceFor(bookId),
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
  return new Uint8Array(Buffer.from(credentials.password, 'base64'));
}

/**
 * Removes the stored BEK for `bookId` — e.g. when Sync's offline-lock signal fires
 * (ContentStore.destroy in the canonical contract) or the book is deleted locally.
 *
 * @param bookId - which book's key to remove
 */
export async function deleteBek(bookId: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: serviceFor(bookId) });
}
