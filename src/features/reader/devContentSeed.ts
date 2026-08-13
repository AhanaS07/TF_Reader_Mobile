// Owner: Reader (Ahana).
//
// TEMP: stands in for Encryption/Download's download pass, which is what will
// call ContentStore.store() in production. Without something storing a package
// first, openSession() throws DECRYPTION_FAILED and getBook() can never resolve.
//
// Delete this file and assets/reader/sample-plaintext.epub when the real
// download pass lands, then drop the ensureSeeded() call in readerAssets.ts.
// It owns the sample EPUB asset outright, so nothing else breaks when it goes.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { createHash, randomBytes } from 'react-native-quick-crypto';

import { encrypt } from '@/features/encryption/aesGcm';
import { contentStore } from '@/features/encryption/contentStore';
import { generateDeviceKeypair, wrapBek } from '@/features/encryption/deviceKeypair';
import type { BookId, EncryptedPackage, SignedLicence } from '@/shared/contracts';

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset handle; `.epub` resolves via metro.config.js assetExts. */
const SAMPLE_EPUB_MODULE = require('../../../assets/reader/sample-plaintext.epub') as number;

const EPUB_MIME_TYPE = 'application/epub+zip';

/** AES-256. Mirrors KEY_BYTES in aesGcm.ts and BEK_BYTES in deviceKeypair.ts. */
const BEK_BYTES = 32;

/**
 * Absolute path to a large EPUB pushed into the app container, used INSTEAD of the bundled 3.6 KB
 * asset when set. Measurement scaffolding for the whole-book work — unset in every normal run.
 *
 * WHY A PATH AND NOT A BUNDLED ASSET: Metro resolves require() statically at bundle time, so a
 * gitignored 20 MB asset is a hard bundling error rather than a soft miss — a "guarded require" is
 * not possible. And a real book must never be committed (T4_Readme.md: never commit real content,
 * encrypted or not). Reading an absolute path sidesteps Metro entirely, which is the same thing
 * sampleEpubBytes() already does once expo-asset has resolved a URI.
 *
 * LITERAL MEMBER ACCESS, deliberately — see readerTiming.ts's isTimingEnabled() for why a computed
 * process.env lookup silently never gets inlined.
 *
 * >>> THIS PUTS PLAINTEXT IN THE APP CONTAINER BY CONSTRUCTION. <<< The file is an unencrypted
 * EPUB sitting on disk until it is deleted, which is exactly what a storage-leak sweep should flag.
 * Delete it once the ciphertext is stored and BEFORE running any forensic sweep, or the sweep
 * either reports your own fixture as a leak or "passes" while real content sits in the container.
 */
const FIXTURE_PATH = process.env.EXPO_PUBLIC_READER_FIXTURE_PATH;

/**
 * A DISTINCT id when the large fixture is in play, and not cosmetic: ensureSeeded() short-circuits
 * on isAvailableOffline(), so reusing 'dev-sample-epub' would find the small book's stored package
 * and never seed the large one — you would measure the 3.6 KB book and believe it was 20 MB.
 */
export const DEV_SAMPLE_BOOK_ID: BookId = FIXTURE_PATH ? 'dev-fixture-epub' : 'dev-sample-epub';

async function sampleEpubBytes(): Promise<Uint8Array> {
  if (FIXTURE_PATH) {
    const fixture = new File(FIXTURE_PATH);
    if (!fixture.exists) {
      throw new Error(
        `EXPO_PUBLIC_READER_FIXTURE_PATH is set to "${FIXTURE_PATH}" but no file is there. ` +
          `Push it into the container first, e.g. cp <book>.epub "$(xcrun simctl get_app_container ` +
          `booted com.taylorandfrancis.tfreader.dev data)/Documents/dev-fixtures/".`
      );
    }
    return fixture.bytesSync();
  }

  const asset = Asset.fromModule(SAMPLE_EPUB_MODULE);

  // Not a network call for a bundled asset, but required: without it `localUri`
  // is null in dev, the classic "works in release, blank in dev" split.
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error('Could not resolve a local URI for sample-plaintext.epub.');
  }
  return new File(uri).bytesSync();
}

/**
 * Build a real AES-256-GCM package wrapped to THIS device's public key.
 *
 * The BEK is generated locally rather than arriving in a grant, because there is
 * no backend to issue one. Everything downstream of that — the GCM layout, the
 * RSA-OAEP-256 wrap, the licence invariants — is genuine, which is what makes
 * getBook() exercise a real unwrapBek + tag-verified decrypt.
 */
async function buildPackage(bookId: BookId, bytes: Uint8Array): Promise<EncryptedPackage> {
  // Idempotent: reuses the stored keypair rather than orphaning BEKs already
  // wrapped to the old public key.
  const { publicKey } = await generateDeviceKeypair();

  const bek = Uint8Array.from(randomBytes(BEK_BYTES));
  const payload = await encrypt(bytes, bek);
  const wrappedBek = await wrapBek(bek, publicKey);
  const keyFingerprint = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;

  const licence: SignedLicence = {
    licenceId: 'dev-licence-sample-epub',
    // contentStore asserts itemId === bookId and that the two keyFingerprints match.
    itemId: bookId,
    keyFingerprint,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    // true => Subscription: ciphertext persists and is reopenable offline.
    canPersist: true,
    rights: { print: false },
    // Empty on purpose: contentStore does not verify RS256 yet (only expiry), so
    // a value here would be decorative. When verification lands this fixture must
    // start signing for real, or it will correctly stop loading.
    signature: { alg: 'RS256', kid: 'dev-unverified', value: '' },
  };

  return {
    bookId,
    format: 'EPUB',
    content: payload.content, // nonce(12) || ciphertext || tag(16)
    encryption: {
      algorithm: 'AES-256-GCM',
      layout: 'nonce(12) || ciphertext || tag(16)',
      wrappedBek,
      wrapAlgorithm: 'RSA-OAEP-256',
      keyId: 'dev-master-v1',
      keyFingerprint,
    },
    licence,
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: EPUB_MIME_TYPE,
  };
}

/**
 * Put the sample book into ContentStore if it is not already there.
 *
 * Seeds only when absent, so the second launch reads what the first persisted —
 * that is the store's offline-reopen path actually being exercised rather than
 * masked by a re-seed every start.
 *
 * destroy() BEFORE store(), NOT store() alone. Every seed mints a fresh random
 * BEK, but contentStore.resolveRawKey() prefers a keychain-cached BEK over
 * unwrapping the package's wrappedBek. So re-seeding on top of a previous seed
 * decrypts the NEW ciphertext with the OLD cached key and fails
 * INTEGRITY_FAILED, permanently and confusingly. destroy() is what clears that
 * cache (it calls deleteBek) along with any orphaned files. Verified the hard
 * way: expiring the licence makes isAvailableOffline() false, which lands here,
 * and without the destroy() the book never decrypts again.
 *
 * Deliberately NOT a catch-all retry around a failed read: auto-destroying on
 * any failure would also erase a genuine INTEGRITY_FAILED, which errors.ts
 * requires fail loudly.
 */
export async function ensureSeeded(bookId: BookId): Promise<void> {
  if (await contentStore.isAvailableOffline(bookId)) return;

  await contentStore.destroy(bookId);
  await contentStore.store(await buildPackage(bookId, await sampleEpubBytes()));
}
