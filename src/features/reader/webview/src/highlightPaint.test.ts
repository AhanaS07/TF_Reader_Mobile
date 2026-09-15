// Owner: Reader (Ahana).
//
// The two things `paintHighlights` has to get right before it touches a renderer: which entries in a
// shared payload belong to this shell, and what one repaint actually has to change. Both are pure,
// so both are testable — which matters most for the diff, because its failure mode is invisible
// (highlights that quietly stop being painted, or a delete that leaves its paint behind).

import { diffHighlights, epubHighlights, pdfHighlights } from './highlightPaint';

const EPUB_A = {
  id: 'a',
  startCfi: 'epubcfi(/6/4!/4/2/1:0)',
  endCfi: 'epubcfi(/6/4!/4/2/1:9)',
  color: 'yellow',
};
const EPUB_B = { ...EPUB_A, id: 'b' };
const PDF_A = { id: 'p', page: 3, startOffset: 10, endOffset: 25, color: 'yellow' };

describe('narrowing a shared payload to the shell that received it', () => {
  it('keeps this shell\'s shape and counts the other\'s', () => {
    expect(epubHighlights([EPUB_A, PDF_A, EPUB_B])).toEqual({ mine: [EPUB_A, EPUB_B], foreign: 1 });
    expect(pdfHighlights([EPUB_A, PDF_A, EPUB_B])).toEqual({ mine: [PDF_A], foreign: 2 });
  });

  it('discriminates on a FIELD, never on a format value', () => {
    // The whole reason this function exists rather than a `format` check. WEBVIEW_BRIDGE.md forbids
    // a ContentFormat literal on the wire, so the payload carries none — and a highlight that
    // somehow arrived with one must still be routed by its locator fields, not by the stray tag.
    const tagged = { ...PDF_A, format: 'EPUB' } as unknown as typeof PDF_A;
    expect(pdfHighlights([tagged]).mine).toEqual([tagged]);
    expect(epubHighlights([tagged]).foreign).toBe(1);
  });

  it('treats an empty payload as an empty set, not as a mismatch', () => {
    // "Clear everything" is a legitimate payload — it is what the host sends after the last
    // highlight is deleted — so it must not look like a routing failure.
    expect(epubHighlights([])).toEqual({ mine: [], foreign: 0 });
    expect(pdfHighlights([])).toEqual({ mine: [], foreign: 0 });
  });
});

describe('what one repaint has to change', () => {
  it('paints only what is new', () => {
    expect(diffHighlights(new Set(['a']), [EPUB_A, EPUB_B])).toEqual({
      added: [EPUB_B],
      removedIds: [],
    });
  });

  it('un-paints what fell out of the set — which is how DELETE works', () => {
    // There is no `unpaintHighlight` command and there must not be one: a deleted highlight is
    // simply absent from the next authoritative set, and that absence IS the removal instruction.
    expect(diffHighlights(new Set(['a', 'b']), [EPUB_A])).toEqual({ added: [], removedIds: ['b'] });
  });

  it('does nothing at all when the set is unchanged', () => {
    // The property that makes re-sending after every add, delete and re-render cheap rather than a
    // full repaint each time.
    expect(diffHighlights(new Set(['a', 'b']), [EPUB_A, EPUB_B])).toEqual({
      added: [],
      removedIds: [],
    });
  });

  it('handles a set emptied completely', () => {
    expect(diffHighlights(new Set(['a', 'b']), [])).toEqual({ added: [], removedIds: ['a', 'b'] });
  });

  it('handles the first paint, where nothing is painted yet', () => {
    expect(diffHighlights(new Set(), [EPUB_A, EPUB_B])).toEqual({
      added: [EPUB_A, EPUB_B],
      removedIds: [],
    });
  });

  it('compares ids only, which is sound ONLY because there is no edit op', () => {
    // Pinning the assumption rather than the behaviour: highlights are create-and-delete-only, so an
    // unchanged id means unchanged paint. If a recolour op ever lands, this test is the one that
    // should be changed first — a same-id, different-colour entry must then count as changed.
    const recoloured = { ...EPUB_A, color: 'green' };
    expect(diffHighlights(new Set(['a']), [recoloured])).toEqual({ added: [], removedIds: [] });
  });
});
