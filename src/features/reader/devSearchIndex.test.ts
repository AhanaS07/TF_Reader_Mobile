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

import index from '../../../assets/reader/sample-search-index.json';
import { DEV_SAMPLE_BOOK_ID } from '@/features/reader/devContentSeed';

describe('the dev search index fixture', () => {
  it('is built for the book devContentSeed actually seeds', () => {
    // DEV_SAMPLE_BOOK_ID switches to 'dev-fixture-epub' when
    // EXPO_PUBLIC_READER_FIXTURE_PATH is set — and in that case devContentSeed
    // deliberately attaches NO index, because this one is the wrong book's. Only the
    // bundled-sample path is asserted here, for the same reason.
    expect(process.env.EXPO_PUBLIC_READER_FIXTURE_PATH).toBeUndefined();
    expect(index.bookId).toBe(DEV_SAMPLE_BOOK_ID);
  });

  it('carries EPUB CFI locators, which is what goTo can resolve', () => {
    // A PDF-locator index would list results the reader can only render as disabled
    // rows, which looks like a broken feature rather than a wrong fixture.
    expect(index.format).toBe('EPUB');

    const postings = Object.values(index.index).flat();
    expect(postings.length).toBeGreaterThan(0);
    expect(postings.every((posting) => posting.locator.type === 'EPUB')).toBe(true);
  });

  it('has a word with enough occurrences to demonstrate stepping', () => {
    // "chapter" spans ch1/ch2/ch3 in the sample. If a regenerated sample ever loses
    // that, the next/prev arrows have nothing meaningful to walk on the simulator.
    const chapterPostings = index.index.chapter ?? [];
    expect(chapterPostings.length).toBeGreaterThan(1);
    expect(new Set(chapterPostings.map((posting) => posting.chapterId)).size).toBeGreaterThan(1);
  });
});
