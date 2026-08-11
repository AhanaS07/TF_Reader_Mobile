// Owner: Encryption (Abhinav).
//
// Proves "store a book's key -> retrieve it -> decrypt the entire book" end to end, using the
// REAL decryptBook primitive from ../aesGcm (not a duplicate). This is the hand-off artifact for
// Ahana: decryptBook is real and proven here; the keychain storage step is honestly split into
// what's real (keyStorage.ts, calling the actual react-native-keychain API) and what's a
// documented substitute (this sandbox cannot run react-native's native bridge at all).
//
// Run: npx tsx src/features/encryption/scripts/proveStoreAndDecrypt.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { encrypt, decryptBook } from '../aesGcm';
import { NONCE_BYTES } from '../cipherLayout';

const BOOK_ID = 'proof-book-001';
const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', '..', 'samples');

const BOOK_TEXT = Buffer.from(
  Array.from(
    { length: 25 },
    (_, i) => `Proof-of-store-and-decrypt line ${i + 1}: whole-file AES-256-GCM, one nonce/tag, no manifest.\n`
  ).join(''),
  'utf8'
);

/**
 * Minimal store/get interface — the same shape keyStorage.ts's storeBek/getBek expose, so
 * swapping this substitute for the real keychain-backed implementation is a one-line change
 * (see step 1 below, where the real one is attempted first).
 */
interface KeyStore {
  store(bookId: string, key: Uint8Array): Promise<void>;
  get(bookId: string): Promise<Uint8Array>;
}

/**
 * NOT for production use. In-memory-only, Node-safe substitute for keyStorage.ts's real
 * react-native-keychain-backed store/get, used ONLY because this sandbox cannot load
 * react-native's native bridge at all (confirmed below, not assumed) — see the attempt in
 * main() and BuildPlan.md/docs/build-status.md for why. Exists purely so this proof script can
 * demonstrate the store->retrieve->decrypt WIRING and the real decryptBook crypto, which is the
 * part that actually matters and IS fully real.
 */
class InMemoryKeyStoreSubstitute implements KeyStore {
  private map = new Map<string, Uint8Array>();
  async store(bookId: string, key: Uint8Array): Promise<void> {
    this.map.set(bookId, key);
  }
  async get(bookId: string): Promise<Uint8Array> {
    const key = this.map.get(bookId);
    if (!key) throw new Error(`no key stored for ${bookId}`);
    return key;
  }
}

async function attemptRealKeychainStore(key: Uint8Array): Promise<'succeeded' | { failedWith: string }> {
  try {
    // Dynamic import so a load-time failure (confirmed below) doesn't crash the whole script
    // before we get to report it cleanly.
    const keyStorage = await import('../keyStorage');
    await keyStorage.storeBek(BOOK_ID, key);
    return 'succeeded';
  } catch (e) {
    return { failedWith: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Encrypt the whole book (real, production encrypt()) ---
  const bek = crypto.randomBytes(32);
  const payload = encrypt(new Uint8Array(BOOK_TEXT), bek);

  const outPath = path.join(OUTPUT_DIR, 'proof-book.epub.enc');
  fs.writeFileSync(outPath, Buffer.from(payload.content));
  console.log(`Encrypted book written to ${outPath} (${payload.content.length} bytes)`);

  // --- Step 1: attempt the REAL keychain store, report exactly what happens (don't assume) ---
  const realAttempt = await attemptRealKeychainStore(bek);
  if (realAttempt === 'succeeded') {
    console.log('REAL react-native-keychain store succeeded (unexpected in this environment).');
  } else {
    console.log(
      'REAL react-native-keychain store failed, as expected outside a linked RN app:\n ',
      realAttempt.failedWith
    );
  }

  // --- Step 2: complete the proof with the Node-safe substitute (documented above) ---
  const store: KeyStore = new InMemoryKeyStoreSubstitute();
  await store.store(BOOK_ID, bek);
  console.log(`Stored BEK for "${BOOK_ID}" via the in-memory substitute (keyStorage.ts's real shape).`);

  const retrievedKey = await store.get(BOOK_ID);

  // --- Step 3: decrypt the ENTIRE book, read fresh from disk, via the real decryptBook primitive ---
  const onDiskContent = new Uint8Array(fs.readFileSync(outPath));
  const nonce = onDiskContent.subarray(0, NONCE_BYTES);
  const ciphertextWithTag = onDiskContent.subarray(NONCE_BYTES);

  const decrypted = decryptBook(ciphertextWithTag, nonce, retrievedKey);

  if (Buffer.compare(Buffer.from(decrypted), BOOK_TEXT) !== 0) {
    throw new Error('PROOF FAILED: decrypted book does not match the original plaintext');
  }
  console.log('PROOF PASSED: store -> retrieve -> decryptBook reproduces the entire book, byte-for-byte.');

  // --- Step 4: tamper check on the SAME primitive being handed off ---
  const tampered = new Uint8Array(ciphertextWithTag);
  tampered[tampered.length - 1] ^= 0xff;
  let threw = false;
  try {
    decryptBook(tampered, nonce, retrievedKey);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('PROOF FAILED: tampered ciphertext did not throw on decryptBook');
  console.log('PROOF PASSED: tampering the stored ciphertext correctly fails GCM tag verification.');
}

main();
