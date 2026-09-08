// Owner: Accessibility (Hruthik).
//
// The call site `readEpubA11yMetadata.ts` was built for. That file takes an `EpubEntryReader`
// and deliberately stays agnostic about where the bytes come from (see its own header comment).
// This module supplies the real answer for on-device books: `getBook()` off the frozen
// `ContentProvider` seam (Encryption's), unzipped with `jszip`. No backend involved — everything
// here runs against bytes already decrypted on the device.
//
// FORMAT-GATED BEFORE DECRYPTING. `getFormat()` is cheap (no decrypt); a PDF or audio book has
// no OPF, so there is nothing to gain from paying for a whole-book decrypt just to fail to find
// one. Same ordering `contentProvider.ts` itself documents for Reader.
//
// THE ZIP LOAD IS MEMOIZED, NOT HOISTED. `readEpubA11yMetadata` only ever calls `readEntry` for
// `container.xml` and the one OPF path it resolves from it (two calls, pinned by its own "reads
// only the two entries it needs" test), so building the zip lazily on first call and reusing it
// for the second means exactly one `getBook` + one `JSZip.loadAsync` per book, not two — and zero
// if the format check already returned.
//
// NO NEW ERROR HANDLING. If `getBook` rejects (a `ContentFailure` — expired licence, integrity
// failure, …) or the bytes are not a valid zip, that rejection surfaces from inside `readEntry`,
// which `readEpubA11yMetadata` already contains into a `malformed-xml` issue instead of
// propagating — the same path already exercised by its "contains a rejecting reader" test. A book
// whose accessibility metadata can't be read is still a book.
//
// NO LIFECYCLE MANAGEMENT. This does not call `closeBook()` — session lifecycle is not this
// module's decision; it piggybacks on `getBook()`'s existing idempotent, cached session.

import JSZip from 'jszip';

import {
  type EpubEntryReader,
  readEpubA11yMetadata,
} from '@/features/accessibility/readEpubA11yMetadata';
import {
  type PublicationA11yMetadata,
  createEmptyPublicationA11y,
} from '@/features/accessibility/publicationA11y';
import type { ParseOpfAccessibilityOptions } from '@/features/accessibility/parseOpfAccessibility';
import { getBook, getFormat } from '@/features/encryption/contentProvider';
import type { BookId } from '@/shared/contracts';

/**
 * Reads the accessibility metadata declared in a local book's own OPF package document.
 *
 * Returns the empty model (no issues) for PDF/AUDIO, which have no OPF to read.
 */
export async function getPublicationAccessibility(
  bookId: BookId,
  options?: ParseOpfAccessibilityOptions,
): Promise<PublicationA11yMetadata> {
  const format = await getFormat(bookId);
  if (format !== 'EPUB') {
    return createEmptyPublicationA11y();
  }

  let zipPromise: Promise<JSZip> | null = null;
  const readEntry: EpubEntryReader = async (path) => {
    zipPromise ??= getBook(bookId).then((bytes) => JSZip.loadAsync(bytes));
    const entry = (await zipPromise).file(path);
    return entry ? entry.async('string') : null;
  };

  return readEpubA11yMetadata(readEntry, options);
}
