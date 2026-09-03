// Owner: Reader (Ahana).
//
// The offset arithmetic behind word-level TTS highlighting. Pure — no DOM here; the Range walking
// this feeds is exercised in `epubTtsResolver.test.ts`.

import { collapseWithMap, indexOfOffset, rawSpanForCollapsed } from './ttsWordOffsets';

/** Built rather than pasted: a literal NBSP is indistinguishable from a space in a diff, and an
 * editor that normalises it would quietly delete the case this fixture exists to cover. */
const NBSP = String.fromCharCode(160);

const CORPUS = [
  'plain words here',
  '  leading whitespace',
  'trailing whitespace   ',
  '\n\t  both  \t\n',
  'internal    runs   collapsed',
  'line\nbreak\tand\r\nreturn',
  // \s matches NBSP. A book that separates words with one is not a special case, and the map must
  // not diverge from the collapse `segmentDocument` applies.
  `non${NBSP}breaking${NBSP}spaces`,
  '   ',
  '',
  'x',
  ' x ',
];

describe('collapseWithMap', () => {
  // The load-bearing property: `segmentDocument` derives `TtsSentence.text` with exactly this
  // expression, and `resolveSpokenWordCfi` compares this module's output against that string as a
  // correctness gate. If the two ever collapse differently, every word highlight silently stops.
  it.each(CORPUS)('produces the same string as replace+trim: %j', (raw) => {
    expect(collapseWithMap(raw).text).toBe(raw.replace(/\s+/g, ' ').trim());
  });

  it.each(CORPUS)('emits one raw span per collapsed character: %j', (raw) => {
    const map = collapseWithMap(raw);
    expect(map.starts).toHaveLength(map.text.length);
    expect(map.ends).toHaveLength(map.text.length);
  });

  it.each(CORPUS)('names a raw span that collapses back to its own character: %j', (raw) => {
    const map = collapseWithMap(raw);
    for (let i = 0; i < map.text.length; i++) {
      const slice = raw.slice(map.starts[i], map.ends[i]);
      expect(slice.replace(/\s+/g, ' ')).toBe(map.text[i]);
    }
  });

  it.each(CORPUS)('names strictly ascending, non-overlapping raw spans: %j', (raw) => {
    const map = collapseWithMap(raw);
    for (let i = 0; i < map.text.length; i++) {
      expect(map.ends[i]).toBeGreaterThan(map.starts[i]);
      if (i > 0) expect(map.starts[i]).toBeGreaterThanOrEqual(map.ends[i - 1]);
    }
  });

  it('maps a collapsed space to the WHOLE whitespace run behind it', () => {
    // The lossy direction: the collapsed output records one space whether the run was one
    // character or twelve, so the span has to carry the length the output threw away.
    const map = collapseWithMap('a \n\t  b');
    expect(map.text).toBe('a b');
    expect(map.starts[1]).toBe(1);
    expect(map.ends[1]).toBe(6);
  });

  it('skips the trimmed edges rather than mapping through them', () => {
    const map = collapseWithMap('   word   ');
    expect(map.text).toBe('word');
    expect(map.starts[0]).toBe(3);
    expect(map.ends[3]).toBe(7);
  });
});

describe('rawSpanForCollapsed', () => {
  // raw:       "The  quick brown"  (16 chars, a DOUBLE space after "The")
  // collapsed: "The quick brown"   (15 chars)
  const map = collapseWithMap('The  quick brown');

  it('maps a word the collapse has shifted', () => {
    expect(rawSpanForCollapsed(map, 4, 9)).toEqual({ start: 5, end: 10 });
  });

  it('maps the first word, whose raw and collapsed offsets happen to agree', () => {
    expect(rawSpanForCollapsed(map, 0, 3)).toEqual({ start: 0, end: 3 });
  });

  // CLAMPS the end, REJECTS a bad start — asymmetric on purpose. A bad `start` means we do not know
  // WHICH word is being spoken, so painting would be a guess. An `end` past the string has exactly
  // one sensible reading: the word runs to the end of the sentence. Android engines over-report
  // `end` on the last word of an utterance, so rejecting it would drop the highlight on the final
  // word of every affected sentence — the most conspicuous place in the sentence to have a gap.
  it('CLAMPS an end past the utterance to the sentence end', () => {
    expect(rawSpanForCollapsed(map, 10, 999)).toEqual({ start: 11, end: 16 });
  });

  it('clamps down to a single character when only the last one is in range', () => {
    expect(rawSpanForCollapsed(map, 14, 40)).toEqual({ start: 15, end: 16 });
  });

  it('rejects a negative start', () => {
    expect(rawSpanForCollapsed(map, -1, 4)).toBeNull();
  });

  it('rejects an empty or inverted span', () => {
    expect(rawSpanForCollapsed(map, 4, 4)).toBeNull();
    expect(rawSpanForCollapsed(map, 9, 4)).toBeNull();
  });

  it('rejects a start at or past the end of the string, after clamping', () => {
    expect(rawSpanForCollapsed(map, 15, 20)).toBeNull();
    expect(rawSpanForCollapsed(map, 99, 120)).toBeNull();
  });

  it('rejects everything against an empty collapsed string', () => {
    expect(rawSpanForCollapsed(collapseWithMap('   '), 0, 1)).toBeNull();
  });
});

describe('indexOfOffset', () => {
  const starts = [0, 4, 9, 15];
  const at = (index: number): number => starts[index];
  const find = (offset: number): number => indexOfOffset(starts.length, at, offset);

  it('finds the entry an offset falls inside', () => {
    expect(find(0)).toBe(0);
    expect(find(3)).toBe(0);
    expect(find(4)).toBe(1);
    expect(find(14)).toBe(2);
    expect(find(15)).toBe(3);
  });

  it('returns the last entry for an offset past the end of the table', () => {
    expect(find(999)).toBe(3);
  });

  it('returns -1 for an offset before the first entry', () => {
    expect(find(-1)).toBe(-1);
  });

  it('returns -1 for an empty table', () => {
    expect(indexOfOffset(0, at, 0)).toBe(-1);
  });
});
