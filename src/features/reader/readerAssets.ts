// Owner: Reader (Ahana).
//
// The only module that knows where the reader's bytes come from. Everything
// above it deals in "a URI to load" and "a base64 string to open" and is
// deliberately ignorant of the source.
//
// The book's bytes come through the ContentProvider seam (getBookBase64 below).
// The sample EPUB that used to live here belongs entirely to devContentSeed.ts.
//
// WHY require() IN A TS FILE: this is Metro's asset pipeline, not Node
// resolution — require() returns a numeric asset handle that expo-asset resolves
// to a real on-device URI, and there is no ESM import form for it.
//
// WHY A RELATIVE PATH AND NOT AN ALIAS: `@` points at ./src and assets live
// outside it. An `@assets` alias would mean editing both halves of the alias map
// (babel.config.js and tsconfig paths, which must mirror each other exactly) for
// a single require().

import { Asset } from 'expo-asset';

import { getBook } from '@/features/encryption/contentProvider';
import { bytesToBase64 } from '@/features/encryption/base64';
import { ensureSeeded } from '@/features/reader/devContentSeed';
import type { BookId } from '@/shared/contracts';

const READER_HTML_MODULE = require('../../../assets/reader/reader.html') as number;

/**
 * Resolve a bundled asset to a local file:// URI.
 *
 * downloadAsync() is required, not optional, and is not a network call for a
 * bundled asset: in release the asset is already in the app, and in dev Metro
 * serves it over the dev-server connection into the cache directory. Skipping it
 * leaves `localUri` null in dev — the classic "works in release, blank in dev"
 * split.
 */
async function localUriFor(assetModule: number, label: string): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error(`Could not resolve a local URI for ${label}.`);
  }
  return uri;
}

/**
 * file:// URI of the generated reader.html. It is self-contained — zero
 * sub-resource requests — which is what lets ReaderWebView lock navigation down
 * as hard as it does.
 */
export async function getReaderHtmlUri(): Promise<string> {
  return localUriFor(READER_HTML_MODULE, 'reader.html');
}

/**
 * Whole-book bytes, decrypted and base64-encoded — the ContentProvider seam.
 *
 * `getBook` is the frozen one-call surface: it opens a ContentStore session,
 * unwraps the BEK and returns the whole book decrypted in RAM. Reader must not
 * reach past it into ContentStore/aesGcm/keyStorage/deviceKeypair — that
 * restriction is contentProvider.ts's entire reason for existing.
 *
 * `ensureSeeded` is TEMPORARY, and goes away with devContentSeed.ts. It stands in
 * for the download pass: without something having called ContentStore.store()
 * first, openSession() throws DECRYPTION_FAILED and getBook() can only reject.
 *
 * TWO CONSTRAINTS:
 *  1. PLAINTEXT NEVER TOUCHES DISK. The route is RAM -> base64 -> bridge. The
 *     only bytes persisted are ciphertext, written by ContentStore.
 *  2. BASE64 OVER injectJavaScript DOES NOT SCALE. Fine for this 3.6KB fixture,
 *     not for a ~20MB book — at that point the TRANSPORT needs replacing, not
 *     this seam. Known and recorded, not accidental.
 *
 * Caller owes a matching closeBook(bookId) when the reader view closes, or the
 * decrypted book stays in RAM. ReaderScreen's unmount effect does that.
 */
export async function getBookBase64(bookId: BookId): Promise<string> {
  await ensureSeeded(bookId);

  const bytes = await getBook(bookId);
  return bytesToBase64(bytes);
}
