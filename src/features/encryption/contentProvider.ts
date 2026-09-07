// Owner: Encryption (Abhinav). Hand-off artifact for Ahana (Reader).
//
// The frozen `ContentProvider` seam (src/shared/contracts/content-provider.ts): "ONE call, whole
// book." Reader codes against `getBook(bookId)` only — never against ContentStore, aesGcm.ts,
// keyStorage.ts, or deviceKeypair.ts directly. Everything below is a thin delegation to
// contentStore.ts, which already does the real work (session lifecycle, key resolution, GCM
// decrypt + tag verification, RAM budget). There is no new logic here on purpose — this file
// exists so Reader has ONE tiny, stable thing to import instead of reaching into Encryption's
// internals.
//
// getBook() is safe to call more than once for the same book (openSession is idempotent,
// decryptBook caches its result per session and de-dupes concurrent in-flight calls) — see
// contentStore.ts's own tests for that behavior; this file doesn't re-test it, only the wiring.
//
// LIFECYCLE, not optional: `closeBook(bookId)` MUST be called when the reader view for that book
// unmounts/closes. It is NOT part of the frozen `ContentProvider` interface (that's
// `ContentStore.close`) — but Reader needs a lifecycle hook, and re-importing ContentStore just
// for that one call would defeat the point of a one-call seam. Exposing it here, alongside
// getBook, is the pragmatic bridge. Skipping it leaves the decrypted book sitting in RAM
// indefinitely — exactly what BuildPlan.md's whole-file-decrypt amendment says "wipe on close"
// exists to prevent.
//
// Usage from Reader (EPUB example — pdf.js is the same shape, .buffer instead for epub.js):
//   const bytes = await getBook(bookId);
//   await book.open(bytes.buffer); // epub.js wants an ArrayBuffer
//   // ... later, when the reader view closes:
//   await closeBook(bookId);
//
// Errors are typed ContentFailure (INTEGRITY_FAILED, LICENCE_EXPIRED, KEYSTORE_UNAVAILABLE, etc.
// — see errors.ts). Fail-closed: render an explicit error state per code, never a blank or
// partial book.
//
// getIndex() — Search's (Vaishnavi's) seam, added per src/features/search/README.md's
// "OPEN ITEM 1": the same one-call pattern as getBook, so Search never has to import
// contentStore.ts directly (that would mean reaching into Encryption's internals, and Search
// must not call keyStorage/aesGcm/deviceKeypair itself — the README's own item 1 says so).
// Same session as getBook: call getBook(bookId) first if you need the book text too — the
// index is decrypted alongside it in the SAME bookId-keyed session (contentStore.ts), and both
// are zeroed together on closeBook(). Returns the raw decrypted index bytes (or null if this
// book has none) — decoding them into a BookSearchIndex and running queryIndex() is Search's
// own job, not Encryption's (see mockSearchIndex.ts's decodeSearchIndex for the shape, used
// there only as a test fixture, not as the real consumer path).
//
//   const indexBytes = await getIndex(bookId); // null if this book has no search index
//   if (indexBytes) { /* Search decodes + queries these bytes */ }
//
// getFormat() — Reader's answer to "which of my (EPUB/PDF/Audio) templates does this book need",
// added per API_CONTRACT_NOTES.md (this directory). Same one-call pattern as getBook/getIndex:
// SessionHandle.format is already frozen (content-provider.ts) and already persisted through
// `store()` into `.meta.json` (contentStore.ts's PersistedMeta.format) — this just exposes a value
// that already exists, the same way getIndex exposes decrypted bytes that already exist. Call it
// BEFORE getBook() so Reader knows which template to mount before paying for the decrypt.
// openSession() only loads persisted metadata; it does not decrypt, so this is cheap even cold.
//
//   const format = await getFormat(bookId); // 'EPUB' | 'PDF' | 'AUDIO'
//   const bytes = await getBook(bookId);     // decrypt, once the template is chosen

import type { BookId, Bytes, ContentFormat, ContentProvider } from '@/shared/contracts';
import { contentStore, decryptSearchIndex, getMimeType as getMimeTypeFromStore } from './contentStore';

export async function getBook(bookId: BookId): Promise<Bytes> {
  await contentStore.openSession(bookId);
  return contentStore.decryptBook(bookId);
}

export async function getIndex(bookId: BookId): Promise<Bytes | null> {
  await contentStore.openSession(bookId);
  return decryptSearchIndex(bookId);
}

export async function getFormat(bookId: BookId): Promise<ContentFormat> {
  const handle = await contentStore.openSession(bookId);
  return handle.format;
}

export async function getMimeType(bookId: BookId): Promise<string> {
  return getMimeTypeFromStore(bookId);
}

export const contentProvider: ContentProvider = { getBook, getMimeType };

export async function closeBook(bookId: BookId): Promise<void> {
  return contentStore.close(bookId);
}
