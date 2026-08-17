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

import { getBook, getFormat } from '@/features/encryption/contentProvider';
import { verifyReadingAccess } from '@/features/download/readingSessionClient';
import { ensureSeeded } from '@/features/reader/devContentSeed';
import { logSpan, now } from '@/features/reader/readerTiming';
import type { BookId, ContentFormat } from '@/shared/contracts';

/**
 * One generated shell per content format, keyed by `ContentFormat`.
 *
 * Both are `require()`d unconditionally at module load, which is deliberate: these
 * are Metro asset HANDLES (small integers), not the files themselves, so naming both
 * costs nothing at runtime and a conditional `require()` cannot be statically
 * analysed by Metro and would not be bundled at all.
 *
 * AUDIO is absent on purpose rather than mapped to a placeholder. It is a real
 * member of the frozen enum and never encrypted, so it can reach this reader — and
 * `Partial` is what makes `formatFor()` below have to handle that instead of
 * silently loading an EPUB shell for an audiobook.
 */
const READER_HTML_MODULES: Partial<Record<ContentFormat, number>> = {
  EPUB: require('../../../assets/reader/reader-epub.html') as number,
  PDF: require('../../../assets/reader/reader-pdf.html') as number,
};

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
 * file:// URI of the generated shell for this format. Each is self-contained — zero
 * sub-resource requests — which is what lets ReaderWebView lock navigation down
 * as hard as it does.
 *
 * Throws for a format with no shell (AUDIO). Callers map that to
 * UNSUPPORTED_FORMAT; see ReaderScreen. Throwing rather than falling back to EPUB
 * is the point — an audiobook silently handed to epub.js fails much later and much
 * less legibly.
 */
export async function getReaderHtmlUri(format: ContentFormat): Promise<string> {
  const assetModule = READER_HTML_MODULES[format];
  if (assetModule === undefined) {
    throw new UnsupportedFormatError(format);
  }
  return localUriFor(assetModule, `reader-${format.toLowerCase()}.html`);
}

/**
 * Thrown when a book's format has no renderer in this app.
 *
 * Its own class rather than a bare Error so ReaderScreen can map it to
 * UNSUPPORTED_FORMAT without string-matching a message — the same reason
 * ContentFailure and DownloadFailure carry codes.
 */
export class UnsupportedFormatError extends Error {
  readonly format: ContentFormat;

  constructor(format: ContentFormat) {
    super(`This reader has no renderer for ${format} content.`);
    this.name = 'UnsupportedFormatError';
    this.format = format;
  }
}

/**
 * Seed if needed, then report which format this book is — the value that decides
 * which shell to load and which open command to send.
 *
 * ORDER IS A REAL DEPENDENCY, NOT A STYLE CHOICE. `getFormat` opens a ContentStore
 * session, and `openSession` rejects with DECRYPTION_FAILED if nothing has been
 * stored for this book yet — so the seed has to have run first. Keeping both calls
 * here means the ordering lives in ONE place, and it is the same place that has to
 * be unpicked when `devContentSeed.ts` goes away.
 *
 * `getFormat` is cheap even cold: `openSession` only reads the persisted metadata
 * written by `store()`, it does not decrypt. So this can run before the WebView is
 * mounted without paying for the book.
 *
 * `ensureSeeded` is TEMPORARY and goes away with devContentSeed.ts. It is also
 * called again inside `getBookBase64`, which is not redundant work — it
 * short-circuits on `isAvailableOffline()` plus a seed-version marker, so the second
 * call is a fast no-op.
 */
export async function prepareBook(bookId: BookId): Promise<ContentFormat> {
  const seedStartedAt = now();
  await ensureSeeded(bookId);
  logSpan('seed', seedStartedAt);

  const formatStartedAt = now();
  const format = await getFormat(bookId);
  logSpan('format', formatStartedAt, { format });
  return format;
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
 * `format` is now a PARAMETER rather than a hardcoded `'EPUB'`, supplied by `prepareBook` above
 * from `SessionHandle.format`. That closes the Reader half of finding `B12`
 * (`src/shared/contracts/CONTRACT_ALIGNMENT.md`) but NOT the finding itself: the value is only as
 * true as whatever called `ContentStore.store()`, which today is the dev seed. The real source is
 * wokay's book metadata (`contentType` on the catalogue/OPDS record) and there is still no
 * catalogue client to read it from — `C3`, unowned. So a real book downloaded through
 * `downloadBook()` gets whatever format that call was passed, which itself defaults to `'EPUB'`.
 *
 * When a catalogue client lands, note that `ReadingSessionRequest.format` selects an ASSET format,
 * which wokay distinguishes from the book's own `contentType` — one book can carry a PDF asset
 * beside an EPUB one, so these two must not be conflated into one lookup.
 */
export async function getBookBase64(bookId: BookId, format: ContentFormat): Promise<string> {
  const startedAt = now();

  const verifyStartedAt = now();
  await verifyReadingAccess(bookId, format);
  logSpan('verifyAccess', verifyStartedAt);

  // Idempotent, and a fast no-op after prepareBook's call — see the note there.
  // Kept rather than removed so this function still stands alone: it is the one
  // place that guarantees bytes exist before getBook is asked for them.
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
