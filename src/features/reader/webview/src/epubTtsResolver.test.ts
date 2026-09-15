/**
 * @jest-environment jsdom
 */
// Owner: Reader (Ahana).
//
// The DOM-walking half of the TTS resolver. jsdom for the same reason `highlightGeometry.test.ts`
// uses it: a Range's text content and its tree order are real DOM behaviour with no layout
// involved, so jsdom answers them exactly as WebKit does, and reimplementing them in a fake would
// be testing the fake.
//
// >>> WHAT IS AND IS NOT ASSERTED. <<< The assertion is always `subRange.toString()` — the text the
// resolved range actually covers. NEVER the minted CFI string: `cfiFromRange` is faked here, and
// asserting on its output would test the fake rather than the offset arithmetic. `cfiFromRange` is
// trusted exactly as much as it already is for every sentence CFI this module emits.
//
// >>> ENTRY POINT IS `resolveCurrent`. <<< `buildRuns`, `segmentDocument` and `resolveSection` are
// module-private; `resolveCurrent(book, rendition, null, null)` is what populates `cfiIndex` and
// `sectionCache` as a side effect, so it is what drives the real segmentation pipeline without
// reaching past this module's own surface.

import type { Book, Rendition } from 'epubjs';

import { collectTextPieces, resetTtsState, resolveCurrent, resolveSpokenWordCfi } from './epubTtsResolver';

/**
 * A distinct, deterministic string per range.
 *
 * >>> THIS MUST BE INJECTIVE, AND IT IS NOT DECORATION. <<< A constant would break three things at
 * once: `cfiIndex` collapses to one entry so `resolveCurrent`/`resolveNext` answer with the wrong
 * sentence; and `resolveSpokenWordCfi`'s "the word range equals the sentence range" guard fires on
 * every call, so the `subRange.toString()` assertion is never reached — and it fails as a silent
 * `null`, which looks exactly like the bug these tests exist to catch. It does not need to be a
 * spec-valid CFI: nothing here parses it back.
 */
function fakeCfiFromRange(range: Range): string {
  const path = (node: Node): string => {
    const steps: number[] = [];
    let current: Node | null = node;
    while (current && current.parentNode) {
      steps.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
      current = current.parentNode;
    }
    return steps.join('/');
  };
  const { startContainer, startOffset, endContainer, endOffset } = range;
  return `epubcfi(/fake!${path(startContainer)}:${startOffset},${path(endContainer)}:${endOffset})`;
}

/** One-section book + rendition, duck-typed to the four members this module actually calls. */
function mount(html: string): { book: Book; rendition: Rendition; doc: Document } {
  const doc = document.implementation.createHTMLDocument('fixture');
  doc.body.innerHTML = html;

  const section = { linear: true, index: 0, document: doc, cfiFromRange: fakeCfiFromRange };
  const contents = { sectionIndex: 0, document: doc, cfiFromRange: fakeCfiFromRange };

  const book = {
    spine: { get: (target: string | number) => (target === 0 ? section : null) },
  } as unknown as Book;

  const rendition = {
    getContents: () => [contents],
    // Real jsdom Ranges, rebuilt from the fake CFI's own offsets — which is what makes them
    // round-trip: `resolveSpokenWordCfi` re-resolves the sentence range from its CFI exactly the
    // way the shell does, rather than being handed the object segmentation already had.
    getRange: (cfi: string): Range | undefined => {
      const match = /^epubcfi\(\/fake!([\d/]*):(\d+),([\d/]*):(\d+)\)$/.exec(cfi);
      if (!match) return undefined;
      const resolve = (steps: string): Node => {
        let node: Node = doc;
        for (const step of steps.split('/')) node = node.childNodes[Number(step)];
        return node;
      };
      const range = doc.createRange();
      range.setStart(resolve(match[1]), Number(match[2]));
      range.setEnd(resolve(match[3]), Number(match[4]));
      return range;
    },
  } as unknown as Rendition;

  return { book, rendition, doc };
}

async function firstSentence(book: Book, rendition: Rendition): Promise<{ text: string; cfi: string }> {
  const result = await resolveCurrent(book, rendition, null, null);
  if (result.status !== 'ok') throw new Error(`expected a sentence, got ${result.status}`);
  return result.sentence;
}

/** Resolve a word BY ITS TEXT, so each case says what it expects rather than restating arithmetic
 * the module under test is the thing being checked on. */
function offsetsOf(text: string, word: string): { start: number; end: number } {
  const start = text.indexOf(word);
  if (start === -1) throw new Error(`fixture does not contain ${word}`);
  return { start, end: start + word.length };
}

// `sectionCache` and `cfiIndex` are MODULE-LEVEL singletons — without this, one fixture's CFIs stay
// resolvable in the next test and answer for a document that is no longer mounted.
beforeEach(() => {
  resetTtsState();
});

describe('collectTextPieces', () => {
  const raw = (range: Range): string => collectTextPieces(range).raw;

  it('matches Range.toString() for a range inside ONE text node', () => {
    // The walk-root case. `commonAncestorContainer` is the text node itself, and a TreeWalker never
    // yields its own root — rooting there walks nothing and every word highlight in the commonest
    // shape of paragraph silently fails to paint.
    const { doc } = mount('<p>A single unbroken paragraph.</p>');
    const text = doc.querySelector('p')!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 8);

    expect(raw(range)).toBe(range.toString());
    expect(raw(range)).toBe('single');
  });

  it('matches Range.toString() across element boundaries', () => {
    const { doc } = mount('<p><span>one</span><em>two</em>three</p>');
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);

    expect(raw(range)).toBe(range.toString());
    expect(raw(range)).toBe('onetwothree');
  });

  it('matches Range.toString() with both endpoints mid-node', () => {
    const { doc } = mount('<p><span>alpha</span> middle <span>omega</span></p>');
    const p = doc.querySelector('p')!;
    const range = doc.createRange();
    range.setStart(p.firstChild!.firstChild as Text, 2);
    range.setEnd(p.lastChild!.firstChild as Text, 3);

    expect(raw(range)).toBe(range.toString());
    expect(raw(range)).toBe('pha middle ome');
  });

  it('matches Range.toString() through nested inline markup', () => {
    const { doc } = mount('<p>a<b>b<i>c</i>d</b>e</p>');
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);

    expect(raw(range)).toBe(range.toString());
    expect(raw(range)).toBe('abcde');
  });

  it('records pieces whose raw offsets ascend and account for every character', () => {
    const { doc } = mount('<p><span>one</span><em>two</em>three</p>');
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);

    const { raw: assembled, pieces } = collectTextPieces(range);
    expect(pieces.map((piece) => piece.rawStart)).toEqual([0, 3, 6]);
    expect(pieces.reduce((total, piece) => total + piece.length, 0)).toBe(assembled.length);
  });
});

describe('resolveSpokenWordCfi', () => {
  it('resolves a word in a single-text-node sentence', async () => {
    const { book, rendition } = mount('<p>The quick brown fox jumps.</p>');
    const sentence = await firstSentence(book, rendition);
    const { start, end } = offsetsOf(sentence.text, 'brown');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
    expect(cfi).not.toBeNull();
    expect(rendition.getRange(cfi!)!.toString()).toBe('brown');
  });

  it('resolves a word in a sentence spanning several text nodes', async () => {
    const { book, rendition } = mount('<p>The <span>quick</span> brown <em>fox</em> jumps.</p>');
    const sentence = await firstSentence(book, rendition);
    const { start, end } = offsetsOf(sentence.text, 'fox');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
    expect(rendition.getRange(cfi!)!.toString()).toBe('fox');
  });

  it('resolves a word that itself STARTS a new text node', async () => {
    // The offset lands exactly on a piece boundary at the start — the case a naive map that assumed
    // one node per sentence gets subtly wrong rather than loudly.
    const { book, rendition } = mount('<p>The <span>quick</span> brown fox.</p>');
    const sentence = await firstSentence(book, rendition);
    const { start, end } = offsetsOf(sentence.text, 'quick');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
    expect(rendition.getRange(cfi!)!.toString()).toBe('quick');
  });

  it('ends a word on the PREVIOUS piece when the offset lands on a node boundary', async () => {
    const { book, rendition } = mount('<p>The <span>quick</span> brown fox.</p>');
    const sentence = await firstSentence(book, rendition);
    const { start, end } = offsetsOf(sentence.text, 'quick');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end)!;
    const range = rendition.getRange(cfi)!;
    // Ending at offset 0 of the FOLLOWING node stringifies the same but mints a different CFI and
    // leaves marks-pane a zero-width box at the head of that node.
    expect(range.endContainer).toBe(range.startContainer);
    expect(range.toString()).toBe('quick');
  });

  it('resolves the FIRST and LAST word of a sentence', async () => {
    const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
    const sentence = await firstSentence(book, rendition);

    const first = offsetsOf(sentence.text, 'Alpha');
    const last = offsetsOf(sentence.text, 'gamma');
    expect(rendition.getRange(resolveSpokenWordCfi(rendition, sentence.cfi, first.start, first.end)!)!.toString()).toBe('Alpha');
    expect(rendition.getRange(resolveSpokenWordCfi(rendition, sentence.cfi, last.start, last.end)!)!.toString()).toBe('gamma');
  });

  it('resolves through collapsed whitespace between words', async () => {
    const { book, rendition } = mount('<p>Widely\n\n   spaced    words here.</p>');
    const sentence = await firstSentence(book, rendition);
    expect(sentence.text).toBe('Widely spaced words here.');
    const { start, end } = offsetsOf(sentence.text, 'words');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
    expect(rendition.getRange(cfi!)!.toString()).toBe('words');
  });

  it('CLAMPS an end past the utterance to the last word rather than bailing', async () => {
    // Android engines over-report `end` on the final word. Rejecting would drop the highlight in
    // the most conspicuous place in the sentence.
    const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
    const sentence = await firstSentence(book, rendition);
    const start = sentence.text.indexOf('gamma');

    const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, sentence.text.length + 40);
    expect(rendition.getRange(cfi!)!.toString()).toBe('gamma.');
  });

  describe('the text/CFI divergence buildRuns creates', () => {
    // `sentence.text` is `range.toString()`, which includes text nodes buildRuns' TreeWalker
    // REJECTED. So the spoken string contains them, and the offsets index that string — the mapping
    // has to stay correct straight through content that segmentation deliberately ignored.
    it('maps correctly across a mid-sentence aria-hidden span', async () => {
      const { book, rendition } = mount('<p>Alpha <span aria-hidden="true">HIDDEN</span> omega here.</p>');
      const sentence = await firstSentence(book, rendition);
      expect(sentence.text).toContain('HIDDEN');
      const { start, end } = offsetsOf(sentence.text, 'omega');

      const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
      expect(rendition.getRange(cfi!)!.toString()).toBe('omega');
    });

    it('maps correctly across a pagebreak marker', async () => {
      const { book, rendition } = mount('<p>Alpha <span role="doc-pagebreak">12</span> omega here.</p>');
      const sentence = await firstSentence(book, rendition);
      const { start, end } = offsetsOf(sentence.text, 'omega');

      const cfi = resolveSpokenWordCfi(rendition, sentence.cfi, start, end);
      expect(rendition.getRange(cfi!)!.toString()).toBe('omega');
    });
  });

  describe('bail paths — silent null, never a throw', () => {
    it('returns null for a CFI this module never emitted', async () => {
      const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
      await firstSentence(book, rendition);

      expect(resolveSpokenWordCfi(rendition, 'epubcfi(/fake!0/0:0,0/0:1)', 0, 3)).toBeNull();
    });

    it('returns null when getRange finds no visible view', async () => {
      // Documented in the module header: `Rendition.getRange` is typed non-optional and really
      // returns undefined. Reachable when the reader pages away mid-utterance.
      const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
      const sentence = await firstSentence(book, rendition);
      const blinded = { ...rendition, getRange: () => undefined } as unknown as Rendition;

      expect(resolveSpokenWordCfi(blinded, sentence.cfi, 0, 5)).toBeNull();
    });

    it('returns null when the section is not currently rendered', async () => {
      const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
      const sentence = await firstSentence(book, rendition);
      const unrendered = { ...rendition, getContents: () => [] } as unknown as Rendition;

      expect(resolveSpokenWordCfi(unrendered, sentence.cfi, 0, 5)).toBeNull();
    });

    it('returns null for an empty or inverted word span', async () => {
      const { book, rendition } = mount('<p>Alpha beta gamma.</p>');
      const sentence = await firstSentence(book, rendition);

      expect(resolveSpokenWordCfi(rendition, sentence.cfi, 4, 4)).toBeNull();
      expect(resolveSpokenWordCfi(rendition, sentence.cfi, 9, 2)).toBeNull();
      expect(resolveSpokenWordCfi(rendition, sentence.cfi, -1, 5)).toBeNull();
    });

    it('returns null when the word range covers the WHOLE sentence', async () => {
      // `highlightSeam.ts` keys epub.js's annotation map on the cfiRange alone, so an identical
      // string would displace the sentence highlight it sits inside.
      const { book, rendition } = mount('<p>Solo.</p>');
      const sentence = await firstSentence(book, rendition);

      expect(resolveSpokenWordCfi(rendition, sentence.cfi, 0, sentence.text.length)).toBeNull();
    });

    it('returns null rather than throwing when the document has moved on', async () => {
      const { book, rendition, doc } = mount('<p>Alpha beta gamma.</p>');
      const sentence = await firstSentence(book, rendition);
      doc.body.innerHTML = '<p>Something else entirely now.</p>';

      expect(resolveSpokenWordCfi(rendition, sentence.cfi, 0, 5)).toBeNull();
    });
  });
});
