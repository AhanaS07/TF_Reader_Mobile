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

import type { BookId, Bytes, ContentProvider } from '@/shared/contracts';
import { contentStore } from './contentStore';

export async function getBook(bookId: BookId): Promise<Bytes> {
  await contentStore.openSession(bookId);
  return contentStore.decryptBook(bookId);
}

export const contentProvider: ContentProvider = { getBook };

export async function closeBook(bookId: BookId): Promise<void> {
  return contentStore.close(bookId);
}
