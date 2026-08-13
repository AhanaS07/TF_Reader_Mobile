// Owner: Search (Vaishnavi). EPUB search prototype proof.
//
// Builds a real inverted index over Ahana's sample EPUB and confirms a query
// returns match LOCATIONS as real EPUB CFIs — the ones her Reader resolves via
// goTo (ITEM 2). The build generates CFIs headlessly (epub.js under jsdom); this
// suite is the in-repo half of the round-trip. The other half — those CFIs
// resolving in the live WebView — is Ahana's fixture test, which can't run in
// jest (the webview is mocked).
//
// The sample's content is known (generateSampleEpub.ts): three chapters, titles
// plus filler prose, one topic phrase per chapter — "Opening the book" (ch1),
// "Turning the page" (ch2), "Finding a chapter" (ch3), and the word "paginated"
// in every paragraph.

import type { BookSearchIndex, Locator } from '@/shared/contracts';
import { createPrototypeBuildIndex } from './buildIndex';
import { epubSampleExtractor } from './extractor';
import { queryIndex } from './queryIndex';

const BOOK_ID = 'sample-plaintext-book';

/** Numeric CFI steps for ordering assertions, e.g. /6/2[ch1]!/4/4/1:113 -> [6,2,4,4,1,113]. */
function steps(loc: Locator): number[] {
  if (loc.type !== 'EPUB') return [];
  return [...loc.cfi.matchAll(/[/:](\d+)/g)].map((m) => Number(m[1]));
}

function lte(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return true;
}

describe('EPUB search prototype — inverted index over the sample book', () => {
  let index: BookSearchIndex;

  beforeAll(async () => {
    index = await createPrototypeBuildIndex(epubSampleExtractor)(BOOK_ID);
  });

  it('builds a BookSearchIndex in the frozen shape, tagged EPUB', () => {
    expect(index.bookId).toBe(BOOK_ID);
    expect(index.format).toBe('EPUB');
    expect(index.version).toBe(1);
    expect(Object.keys(index.index).length).toBeGreaterThan(0);
    expect(index.index.chapter?.length).toBeGreaterThan(3); // shared filler word
  });

  it('a single-word query returns hits with chapterId + a real EPUB CFI + snippet', () => {
    const hits = queryIndex(index, 'opening'); // only in chapter 1

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.bookId).toBe(BOOK_ID);
      expect(hit.chapterId).toBe('ch1');
      expect(hit.locator.type).toBe('EPUB');
      if (hit.locator.type !== 'EPUB') throw new Error('unreachable');
      expect(hit.locator.cfi).toMatch(/^epubcfi\(\/6\/2\[ch1\]!.*\)$/);
      expect(hit.snippet.toLowerCase()).toContain('opening');
    }
  });

  it('returns hits in reading order (CFI order) across chapters', () => {
    const hits = queryIndex(index, 'chapter'); // shared across ch1/ch2/ch3

    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set(['ch1', 'ch2', 'ch3']));
    for (let i = 1; i < hits.length; i++) {
      expect(lte(steps(hits[i - 1].locator), steps(hits[i].locator))).toBe(true);
    }
  });

  it('multi-word query ANDs tokens within a chapter unit', () => {
    // "finding" only in ch3; "chapter" everywhere. AND -> only ch3.
    const hits = queryIndex(index, 'finding chapter');
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((h) => h.chapterId))).toEqual(new Set(['ch3']));
  });

  it('multi-word AND yields nothing when no single chapter holds all tokens', () => {
    // "opening" only in ch1, "turning" only in ch2 — no common chapter.
    expect(queryIndex(index, 'opening turning')).toEqual([]);
  });

  it('returns [] for a word not in the book and for an empty term', () => {
    expect(queryIndex(index, 'zzzznotinthisbook')).toEqual([]);
    expect(queryIndex(index, '   ')).toEqual([]);
  });

  it('is a pure lookup — same input, same output, index untouched', () => {
    const before = JSON.stringify(index);
    expect(queryIndex(index, 'chapter')).toEqual(queryIndex(index, 'chapter'));
    expect(JSON.stringify(index)).toBe(before);
  });

  // --- ITEM 2: generated CFIs match Ahana's real fixtures exactly ----------
  describe("generated CFIs match the Reader's fixtures (round-trip, build side)", () => {
    it('the word "paginated" in ch1 ¶1 -> epubcfi(/6/2[ch1]!/4/4/1:113)', () => {
      // "paginated" is in every paragraph; the first in reading order is ch1 ¶1.
      const first = index.index.paginated?.[0];
      expect(first?.chapterId).toBe('ch1');
      expect(first?.locator).toEqual({ type: 'EPUB', cfi: 'epubcfi(/6/2[ch1]!/4/4/1:113)' });
    });

    it('the start of ch1 ¶1 -> epubcfi(/6/2[ch1]!/4/4/1:0)', () => {
      // ¶1 opens with "Opening" at offset 0 (distinct from the <h1> "Opening").
      const cfis = (index.index.opening ?? []).map((p) =>
        p.locator.type === 'EPUB' ? p.locator.cfi : '',
      );
      expect(cfis).toContain('epubcfi(/6/2[ch1]!/4/4/1:0)');
    });
  });
});
