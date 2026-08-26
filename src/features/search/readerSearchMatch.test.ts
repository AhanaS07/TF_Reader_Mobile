// Tests for readerSearchMatch.ts — the active-hit -> format-free paint payload resolver and the
// pure call/clear decision.
//
// This is the host "writes" half of search-match painting, and the only executable coverage it gets
// before the `paintSearchMatch` bridge command exists to carry its output. Every case pins a DECISION
// (the format discriminant never crosses the wire; PDF carries `page` so paint is spread-routable;
// one active match at a time so a new hit clears the previous; -1/out-of-range = clear), so it doubles
// as the checklist the Reader's apply half must satisfy once wired.

import type { SearchHit } from '@/shared/contracts';

import {
  NO_SEARCH_MATCH,
  searchMatchFor,
  toReaderSearchMatch,
} from './readerSearchMatch';

const EPUB_HIT: SearchHit = {
  bookId: 'book-1',
  chapterId: 'ch1',
  locator: { type: 'EPUB', cfi: 'epubcfi(/6/2[ch1]!/4/4/1:113)' },
  snippet: '…a single point of contact…',
};

const PDF_HIT: SearchHit = {
  bookId: 'book-1',
  chapterId: 'p7',
  locator: { type: 'PDF', page: 7, offset: 340 },
  snippet: '…adjusting and separating map colors…',
};

describe('toReaderSearchMatch', () => {
  it('maps an EPUB hit to the epub side, carrying the point CFI and the term', () => {
    const match = toReaderSearchMatch(EPUB_HIT, ' map ');
    expect(match.pdf).toBeNull();
    expect(match.epub).toEqual({ startCfi: 'epubcfi(/6/2[ch1]!/4/4/1:113)', matchText: 'map' });
  });

  it('maps a PDF hit to the pdf side, carrying page (spread-routing) + offset + term', () => {
    const match = toReaderSearchMatch(PDF_HIT, 'map colors');
    expect(match.epub).toBeNull();
    expect(match.pdf).toEqual({ page: 7, startOffset: 340, matchText: 'map colors' });
  });

  it('defaults a missing PDF offset to 0 rather than emitting undefined', () => {
    const hit: SearchHit = { ...PDF_HIT, locator: { type: 'PDF', page: 3 } };
    expect(toReaderSearchMatch(hit, 'x').pdf).toEqual({ page: 3, startOffset: 0, matchText: 'x' });
  });

  it('never lets a ContentFormat value (type/format) into the payload — the bridge rule', () => {
    for (const hit of [EPUB_HIT, PDF_HIT]) {
      const serialized = JSON.stringify(toReaderSearchMatch(hit, 'map'));
      expect(serialized).not.toContain('"type"');
      expect(serialized).not.toContain('"format"');
      expect(serialized).not.toContain('EPUB');
      expect(serialized).not.toContain('PDF');
    }
  });
});

describe('searchMatchFor — call/clear', () => {
  const hits = [EPUB_HIT, PDF_HIT];

  it('paints the active hit', () => {
    expect(searchMatchFor(hits, 0, 'map')).toEqual(toReaderSearchMatch(EPUB_HIT, 'map'));
    expect(searchMatchFor(hits, 1, 'map')).toEqual(toReaderSearchMatch(PDF_HIT, 'map'));
  });

  it('clears when nothing is selected (activeIndex -1)', () => {
    expect(searchMatchFor(hits, -1, 'map')).toBe(NO_SEARCH_MATCH);
  });

  it('clears for an out-of-range index (results swapping) rather than throwing', () => {
    expect(searchMatchFor(hits, 5, 'map')).toBe(NO_SEARCH_MATCH);
    expect(searchMatchFor([], 0, 'map')).toBe(NO_SEARCH_MATCH);
  });
});
