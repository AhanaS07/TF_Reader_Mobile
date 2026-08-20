// Owner: Reader (Ahana).
//
// >>> TEMPORARY, WITH THE FIXTURE IT GUARDS. <<< Delete alongside
// devContentSeed.ts — see the deletion list in scripts/buildSampleSearchIndex.ts.
//
// Guards the one seam that would break the dev search demo silently. The generated
// index carries a bookId, and queryBookIndex THROWS when it is not the book that was
// asked for (a deliberate guard against handing over the wrong book's ciphertext). So
// if the generator's SAMPLE_BOOK_ID and devContentSeed's DEV_SAMPLE_BOOK_ID ever
// drift, every search in the app stops returning "no matches" and starts erroring —
// with a message about ciphertext, pointing at Encryption rather than at the two
// string literals that actually disagreed.
//
// Nothing here tests the search FEATURE; that is ReaderScreen.test.tsx. This tests
// the fixture wiring only, which is why it dies with the fixture.

import epubIndex from '../../../assets/reader/sample-search-index.json';
import pdfIndex from '../../../assets/reader/sample-pdf-search-index.json';
import {
  DEV_SAMPLE_EPUB_BOOK_ID,
  DEV_SAMPLE_PDF_BOOK_ID,
} from '@/features/reader/devContentSeed';

describe('the dev search index fixtures', () => {
  // ONE INDEX PER FORMAT, and they are not interchangeable: queryBookIndex THROWS when an index's
  // bookId is not the book requested (a guard against handing over the wrong book's ciphertext), so a
  // mismatch here turns every search in the app into an error rather than an empty list. This is the
  // seam that made PDF search look unimplemented for a while — the extractor worked; no PDF book
  // carried an index.
  it.each([
    ['EPUB', () => epubIndex, () => DEV_SAMPLE_EPUB_BOOK_ID, 'EPUB'],
    ['PDF', () => pdfIndex, () => DEV_SAMPLE_PDF_BOOK_ID, 'PDF'],
  ])('the %s index is built for the book devContentSeed seeds it against', (_l, idx, bookId, fmt) => {
    expect(idx().bookId).toBe(bookId());
    expect(idx().format).toBe(fmt);
  });

  it('carries EPUB CFI locators in the EPUB index, which goTo resolves as an href target', () => {
    const postings = Object.values(epubIndex.index).flat();
    expect(postings.length).toBeGreaterThan(0);
    expect(postings.every((posting) => posting.locator.type === 'EPUB')).toBe(true);
  });

  it('carries PDF page locators in the PDF index, which goTo resolves as a page target', () => {
    // These are what makes a PDF hit navigable at all: `targetOf` turns `{type:'PDF', page}` into
    // `{kind:'page', page}`, and a hit with no page could only ever be a dead row.
    const postings = Object.values(pdfIndex.index).flat();
    expect(postings.length).toBeGreaterThan(0);
    for (const posting of postings) {
      expect(posting.locator.type).toBe('PDF');
      expect(Number.isInteger(posting.locator.page)).toBe(true);
      expect(posting.locator.page).toBeGreaterThan(0);
    }
  });

  it('has a word with enough occurrences in each index to demonstrate stepping', () => {
    for (const idx of [epubIndex, pdfIndex]) {
      const counts = Object.values(idx.index).map((postings) => postings.length);
      expect(Math.max(...counts)).toBeGreaterThan(1);
    }
  });

  // The two indexes address different books, so nothing should be able to serve one for the other.
  it('never gives the two fixtures the same bookId', () => {
    expect(epubIndex.bookId).not.toBe(pdfIndex.bookId);
  });
});
