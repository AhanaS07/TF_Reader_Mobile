// Documents a latent defect found while auditing the search pipeline: queryIndex.ts's internal
// cfiSteps() (used by readingOrder() to sort multi-hit results) parses a CFI with a flat regex
// that doesn't know about range-CFI syntax (comma-separated parent,start,end). Before the fix in
// queryIndex.ts, this silently concatenated both range endpoints' digits into one nonsense step
// array and sorted wrong — never throwing. extractor.ts never emits range CFIs today (it always
// builds a collapsed point Range), so this was unreachable in the current pipeline, not a live
// bug. Flagged for Vaishnavi (Search) since queryIndex.ts is her file — this only converts the
// failure mode from silent-wrong to loud, it does not add range-CFI support.

import { queryIndex } from './queryIndex';
import type { BookSearchIndex } from '@/shared/contracts';

function indexWith(cfis: string[]): BookSearchIndex {
  return {
    bookId: 'book-1',
    format: 'EPUB',
    version: 1,
    index: {
      hello: cfis.map((cfi, i) => ({
        chapterId: `chapter-${i}`,
        locator: { type: 'EPUB' as const, cfi },
        snippet: 'hello there',
      })),
    },
  };
}

describe('queryIndex — range-CFI guard (readingOrder -> cfiSteps)', () => {
  it('sorts two point-CFI hits without throwing (the only shape extractor.ts produces today)', () => {
    const index = indexWith(['epubcfi(/6/4!/4/10/1:0)', 'epubcfi(/6/2!/4/4/1:0)']);
    const hits = queryIndex(index, 'hello');
    expect(hits.map((h) => h.chapterId)).toEqual(['chapter-1', 'chapter-0']); // reading order
  });

  it('throws a clear error for a range CFI instead of silently sorting wrong', () => {
    const index = indexWith(['epubcfi(/6/4!/4/10/2:3,/1:0,/1:5)', 'epubcfi(/6/2!/4/4/1:0)']);
    expect(() => queryIndex(index, 'hello')).toThrow(/range CFI .* not a supported comparator input/);
  });
});
