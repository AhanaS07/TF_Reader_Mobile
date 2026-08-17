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

import { fromByteArray } from 'react-native-quick-base64';

import { getBook } from '@/features/encryption/contentProvider';
import { verifyReadingAccess } from '@/features/download/readingSessionClient';
import { ensureSeeded } from '@/features/reader/devContentSeed';
import { logSpan, now } from '@/features/reader/readerTiming';
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
 *  2. BASE64 OVER injectJavaScript SCALES — MEASURED, not assumed. A real 20MB
 *     EPUB (20,951,889 bytes -> 27,935,852 base64 chars, iPhone 17 Pro simulator)
 *     crosses and renders in ~330ms, ~5% of a warm open. The transport does not
 *     need replacing; the cost is the CODEC on either side of it. Do not "fix" the
 *     transport for a slow open — WEBVIEW_BRIDGE.md records the measurement and
 *     why replacing it would needlessly fire the typechecked-build trigger.
 *
 * WHERE THE TIME ACTUALLY GOES — warm open, ciphertext already stored:
 *
 *     decrypt  ~4.9s   getBook: Encryption's base64 round-trip (aesGcm.ts:140-148)
 *     encode    ~18ms  this file, since the react-native-quick-base64 swap below
 *     render   ~330ms  transport + JSZip + epub.js
 *
 * That is ~93% inside getBook, which base64-ENCODES the ciphertext and DECODES the
 * plaintext around a string-only native module. It belongs to Encryption, not here
 * — do not try to work around it from this side; the seam exists so this file
 * cannot. Before the swap, `encode` was 1820ms (Hermes) / 574ms (V8), so Reader's
 * own half of the codec cost went from ~26% of a warm open to ~0.3%.
 *
 * MEMORY, so nobody re-derives it: the swap bought TIME, not MEMORY. App-side peak
 * stayed at 609MB because peak tracks the NUMBER of full-size copies (~6), not the
 * cost of building each one, and this swap changed only the latter. Removing copies
 * means removing Encryption's double hop — again, not this file's call.
 *
 * Caller owes a matching closeBook(bookId) when the reader view closes, or the
 * decrypted book stays in RAM. ReaderScreen's unmount effect does that.
 *
 * PER-OPEN ACCESS RE-VERIFICATION (added 2026-08-14): real flambeau backend re-checks entitlement
 * on EVERY book open, not just at download time (Download's `readingSessionClient.ts` — "a
 * subscription can lapse between borrow and read"). `verifyReadingAccess` is Download's call, not
 * a new decrypt dependency — it FAILS OPEN on a network failure or an unconfirmable state (see its
 * own doc comment for the exact policy), so this does not turn "I'm offline" into "I lost my
 * books" for content already sitting on the device. It only ever rejects for an EXPLICIT
 * revocation, which is deliberately fatal to opening the book — same as any other error below,
 * caught by ReaderScreen's existing catch-and-raiseError.
 *
 * Hardcoded to `'EPUB'`: this Reader implementation is EPUB-only today (the WebView template is
 * epub.js-specific, and devContentSeed.ts's own header says the same) — not a new limitation this
 * introduces, just the first place that format needs to be named explicitly rather than implied.
 * It is also BLOCKED, not merely unfinished: the contract's intended source for the real value is
 * wokay's book metadata (`contentType` on the catalogue/OPDS record), and this app has no
 * catalogue client at all, so there is nowhere to read it from. See B12/C3 in
 * `src/shared/contracts/CONTRACT_ALIGNMENT.md`. When one lands, note that
 * `ReadingSessionRequest.format` selects an ASSET format, which wokay distinguishes from the
 * book's own `contentType` — one book can carry a PDF asset beside an EPUB one.
 */
export async function getBookBase64(bookId: BookId): Promise<string> {
  const startedAt = now();

  const verifyStartedAt = now();
  await verifyReadingAccess(bookId, 'EPUB');
  logSpan('verifyAccess', verifyStartedAt);

  const seedStartedAt = now();
  await ensureSeeded(bookId);
  logSpan('seed', seedStartedAt);

  // Split from the encode below so the two costs can be attributed separately: getBook is
  // Encryption's decrypt (which itself base64s twice around a string-only native API — see
  // aesGcm.ts:140-148), while the encode below is Reader's own transport encode. Keeping them
  // apart is what showed the remaining cost is entirely on Encryption's side, not this one.
  const decryptStartedAt = now();
  const bytes = await getBook(bookId);
  logSpan('decrypt', decryptStartedAt, { bytes: bytes.length });

  // C++-backed, NOT the portable JS codec in encryption/base64.ts. Measured 2026-08-13: that
  // codec's per-3-byte loop with four string appends cost 1820ms on Hermes for this book (574ms on
  // V8), which was ~26% of a warm open. `react-native-quick-base64` is already a direct dependency
  // and already pod-linked as a peer of react-native-quick-crypto, so this needed no prebuild.
  //
  // base64.ts remains correct and is still the right thing for small payloads and for anything that
  // must not depend on a native module — it is the portable fallback shape, not dead code.
  const encodeStartedAt = now();
  const base64 = fromByteArray(bytes);
  logSpan('encode', encodeStartedAt, { chars: base64.length });

  logSpan('getBookBase64 TOTAL', startedAt, { bytes: bytes.length });
  return base64;
}
