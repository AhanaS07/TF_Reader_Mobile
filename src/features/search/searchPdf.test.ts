// Owner: Search (Vaishnavi). PDF search prototype proof.
//
// The PDF counterpart of search.test.ts. Builds a real inverted index over the sample
// PDF (assets/reader/sample-plaintext.pdf) through the SAME extractor → buildIndex →
// queryIndex pipeline as EPUB, and confirms a query returns match LOCATIONS as PDF
// locators — { type:'PDF', page, offset } — which the Reader's PDF template resolves via
// goTo(page). The whole pipeline below the extractor is format-agnostic; this suite is
// the proof that the PDF extractor completes it.
//
// The sample's content is known (generateSamplePdf.ts): three near-identical pages, each
//   "TF Reader sample PDF - page N of 3 / This file is GENERATED. ... / with real content:
//    it stands in for a licensed book so the pdf.js / path can be exercised offline. /
//    Use Next and Previous to page through all 3 pages."
// so "generated", "sample", "page" recur on every page and the phrase "sample pdf" is
// adjacent on every page while "sample offline" is co-located but never adjacent.

import type { BookSearchIndex, Locator } from '@/shared/contracts';
import { createPrototypeBuildIndex } from './buildIndex';
import { pdfSampleExtractor } from './extractor';
import { queryIndex } from './queryIndex';

const BOOK_ID = 'sample-plaintext-pdf';

/** (page, offset) for ordering assertions; [] for a non-PDF locator (should not occur here). */
function pos(loc: Locator): [number, number] {
  return loc.type === 'PDF' ? [loc.page, loc.offset ?? 0] : [0, 0];
}

function lte(a: [number, number], b: [number, number]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] <= b[1];
}

describe('PDF search prototype — inverted index over the sample PDF', () => {
  let index: BookSearchIndex;

  beforeAll(async () => {
    index = await createPrototypeBuildIndex(pdfSampleExtractor)(BOOK_ID);
  });

  it('builds a BookSearchIndex in the frozen shape, tagged PDF', () => {
    expect(index.bookId).toBe(BOOK_ID);
    expect(index.format).toBe('PDF');
    expect(index.version).toBe(1);
    expect(Object.keys(index.index).length).toBeGreaterThan(0);
    expect(index.index.page?.length).toBeGreaterThan(2); // recurs on every page
  });

  it('a single-word query returns hits with page chapterId + a PDF locator + snippet', () => {
    const hits = queryIndex(index, 'generated'); // on every page

    expect(hits.length).toBe(3);
    for (const hit of hits) {
      expect(hit.bookId).toBe(BOOK_ID);
      expect(hit.chapterId).toMatch(/^p[123]$/);
      expect(hit.locator.type).toBe('PDF');
      if (hit.locator.type !== 'PDF') throw new Error('unreachable');
      expect(hit.locator.page).toBeGreaterThanOrEqual(1);
      expect(hit.locator.page).toBeLessThanOrEqual(3);
      expect(typeof hit.locator.offset).toBe('number');
      expect(hit.snippet.toLowerCase()).toContain('generated');
    }
  });

  it('chapterId matches the hit page — p<N> is the page', () => {
    for (const hit of queryIndex(index, 'generated')) {
      if (hit.locator.type !== 'PDF') throw new Error('unreachable');
      expect(hit.chapterId).toBe(`p${hit.locator.page}`);
    }
  });

  it('returns hits in reading order — (page, offset) non-decreasing', () => {
    const hits = queryIndex(index, 'page'); // multiple per page, across all pages
    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set(['p1', 'p2', 'p3']));
    for (let i = 1; i < hits.length; i++) {
      expect(lte(pos(hits[i - 1].locator), pos(hits[i].locator))).toBe(true);
    }
  });

  it('a multi-word query matches only words side by side (phrase), once per page', () => {
    // "TF Reader sample PDF" -> "sample" then "pdf" adjacent, on every page.
    const hits = queryIndex(index, 'sample pdf');
    expect(hits.length).toBe(3);
    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set(['p1', 'p2', 'p3']));
    for (const hit of hits) expect(hit.snippet.toLowerCase()).toContain('sample pdf');
  });

  it('co-occurrence on a page is NOT enough — the words must be adjacent', () => {
    // "sample" (line 1) and "offline" (line 4) share every page but are never adjacent.
    expect(queryIndex(index, 'sample offline')).toEqual([]);
  });

  it('order matters — a reversed phrase does not match', () => {
    expect(queryIndex(index, 'pdf sample')).toEqual([]);
  });

  it('returns [] for a word not in the book and for an empty term', () => {
    expect(queryIndex(index, 'zzzznotinthisbook')).toEqual([]);
    expect(queryIndex(index, '   ')).toEqual([]);
  });

  it('is a pure lookup — same input, same output, index untouched', () => {
    const before = JSON.stringify(index);
    expect(queryIndex(index, 'page')).toEqual(queryIndex(index, 'page'));
    expect(JSON.stringify(index)).toBe(before);
  });
});
