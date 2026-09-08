// Regression test for the phrase-adjacency bug Ahana flagged (2026-08-18): adjacency was
// inferred from raw CHARACTER offsets (a MAX_SEP_GAP over CFI/PDF offset), so a phrase was
// silently lost whenever the source XHTML put >2 chars between two adjacent words — newline
// + indentation, routine in pretty-printed EPUBs. Adjacency is now a TOKEN-SEQUENCE property
// (posting.seq): word N is adjacent to word N+1 iff their seq is consecutive in the same
// unit. These cases would FAIL under the old char-offset rule and pass now.

import { queryIndex } from './queryIndex';
import type { BookSearchIndex, Posting } from '@/shared/contracts';

function epub(cfi: string, seq: number, snippet: string): Posting {
  return { chapterId: 'ch1', locator: { type: 'EPUB', cfi }, snippet, seq };
}

describe('queryIndex — token-sequence adjacency (whitespace-independent)', () => {
  it('matches a phrase whose words are far apart in CHARS but consecutive in TOKENS', () => {
    // "the" (seq 0, offset :0) then "book" (seq 1, offset :10) in the SAME text node —
    // a 10-char gap, e.g. a newline + indentation between them. Old rule: 0 hits.
    const index: BookSearchIndex = {
      bookId: 'b',
      format: 'EPUB',
      version: 2,
      index: {
        the: [epub('epubcfi(/6/2[ch1]!/4/4/1:0)', 0, 'the book')],
        book: [epub('epubcfi(/6/2[ch1]!/4/4/1:10)', 1, 'the book')],
      },
    };
    expect(queryIndex(index, 'the book')).toHaveLength(1);
  });

  it('does NOT match when a token sits between them (seq not consecutive)', () => {
    // "the a book": "the" seq 0, "book" seq 2 ("a" was seq 1). "the book" is not a phrase.
    const index: BookSearchIndex = {
      bookId: 'b',
      format: 'EPUB',
      version: 2,
      index: {
        the: [epub('epubcfi(/6/2[ch1]!/4/4/1:0)', 0, 'the a book')],
        book: [epub('epubcfi(/6/2[ch1]!/4/4/1:6)', 2, 'the a book')],
      },
    };
    expect(queryIndex(index, 'the book')).toEqual([]);
  });

  it('does NOT match across a text-node boundary even if seq is consecutive', () => {
    // Book-global seq is consecutive (5, 6) but the words live in different nodes — the end
    // of one block and the start of the next. The unit check keeps that from being a phrase.
    const index: BookSearchIndex = {
      bookId: 'b',
      format: 'EPUB',
      version: 2,
      index: {
        book: [epub('epubcfi(/6/2[ch1]!/4/4/1:20)', 5, 'end book')],
        opening: [epub('epubcfi(/6/2[ch1]!/4/6/1:0)', 6, 'opening line')],
      },
    };
    expect(queryIndex(index, 'book opening')).toEqual([]);
  });

  it('PDF: matches consecutive tokens on the same page regardless of char offset', () => {
    const index: BookSearchIndex = {
      bookId: 'b',
      format: 'PDF',
      version: 2,
      index: {
        sample: [{ chapterId: 'p1', locator: { type: 'PDF', page: 1, offset: 3 }, snippet: 'sample pdf', seq: 0 }],
        pdf: [{ chapterId: 'p1', locator: { type: 'PDF', page: 1, offset: 40 }, snippet: 'sample pdf', seq: 1 }],
      },
    };
    expect(queryIndex(index, 'sample pdf')).toHaveLength(1);
  });

  it('a pre-seq index (v1, no seq) cannot phrase-match, but single-word still works', () => {
    const index: BookSearchIndex = {
      bookId: 'b',
      format: 'EPUB',
      version: 1,
      index: {
        the: [{ chapterId: 'ch1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2[ch1]!/4/4/1:0)' }, snippet: 'the book' }],
        book: [{ chapterId: 'ch1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2[ch1]!/4/4/1:4)' }, snippet: 'the book' }],
      },
    };
    expect(queryIndex(index, 'the book')).toEqual([]); // no seq -> no phrase
    expect(queryIndex(index, 'the')).toHaveLength(1); // single-word unaffected
  });
});
