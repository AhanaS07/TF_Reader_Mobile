// Owner: Reader (Ahana).
//
// Pure offset arithmetic for word-level TTS highlighting. No DOM access anywhere in this file —
// `epubTtsResolver.ts` walks the Range and hands this module plain strings and numbers, the same
// split `ttsSegmentation.ts` already uses for its own predicates.
//
// >>> WHAT PROBLEM THIS SOLVES. <<< A native TTS engine reports word progress as offsets into the
// utterance — which is `TtsSentence.text`, a whitespace-COLLAPSED, TRIMMED projection of a DOM
// Range that may span several text nodes. Offset N in `text` is therefore not offset N in any text
// node, and on a multi-node sentence is not even in the same node as the sentence start. Painting
// a word range needs the inverse map, and `collapseWithMap` is the only place it is built.
//
// The map is built ALONGSIDE the collapse rather than reconstructed from the collapsed string
// afterwards, because the collapse is lossy in exactly the direction that matters: a run of
// whitespace of unknown length becomes one space, and nothing in the output records how long the
// run was.

/** A collapsed string plus, per collapsed character, the half-open raw span that produced it. */
export interface CollapsedMap {
  /** Exactly `raw.replace(/\s+/g, ' ').trim()`. */
  text: string;
  /** `starts[i]` — index into `raw` of the first character behind collapsed character `i`. */
  starts: number[];
  /** `ends[i]` — index into `raw` one past the last character behind collapsed character `i`.
   * Wider than one character only for a collapsed space, which stands in for a whole run. */
  ends: number[];
}

const WHITESPACE_RUN = /\s+/g;

/**
 * Collapse `raw` the way `segmentDocument` does, keeping the provenance of every output character.
 *
 * `text` is pinned by test to equal `raw.replace(/\s+/g, ' ').trim()` — the SAME expression
 * `epubTtsResolver.ts` derives `TtsSentence.text` with. That equality is what makes it safe to
 * compare this module's output against a cached `sentence.text` as a correctness gate: a mismatch
 * means the Range no longer covers the text that was spoken, not that the two collapse differently.
 */
export function collapseWithMap(raw: string): CollapsedMap {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  const keep = (char: string, from: number, to: number): void => {
    chars.push(char);
    starts.push(from);
    ends.push(to);
  };

  const keepLiteralRange = (from: number, to: number): void => {
    for (let i = from; i < to; i++) keep(raw[i], i, i + 1);
  };

  let cursor = 0;
  WHITESPACE_RUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WHITESPACE_RUN.exec(raw)) !== null) {
    keepLiteralRange(cursor, match.index);
    keep(' ', match.index, match.index + match[0].length);
    cursor = match.index + match[0].length;
  }
  keepLiteralRange(cursor, raw.length);

  // `.trim()`'s equivalent. The collapse above already merged every run, so there is at most one
  // leading and one trailing space to drop — no loop needed, and dropping the leading one first
  // keeps the all-whitespace case (a single space, then nothing) correct.
  let from = 0;
  let to = chars.length;
  if (from < to && chars[from] === ' ') from++;
  if (to > from && chars[to - 1] === ' ') to--;

  return {
    text: chars.slice(from, to).join(''),
    starts: starts.slice(from, to),
    ends: ends.slice(from, to),
  };
}

/**
 * Map a half-open span of collapsed offsets onto the half-open raw span behind it.
 *
 * >>> `end` IS CLAMPED, `start` IS NOT. <<< Asymmetric on purpose. A `start` outside the string
 * means we do not know WHICH word is being spoken, so painting anything would be a guess. An `end`
 * past the string has exactly one sensible reading — the word runs to the end of the sentence — so
 * clamping recovers a correct answer rather than discarding one. Android engines over-report `end`
 * on the last word of an utterance, and rejecting there would drop the highlight on the final word
 * of every affected sentence: the most conspicuous place in the sentence to have a gap.
 */
export function rawSpanForCollapsed(
  map: CollapsedMap,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const clampedEnd = Math.min(end, map.text.length);
  if (start < 0 || start >= clampedEnd) return null;
  return { start: map.starts[start], end: map.ends[clampedEnd - 1] };
}

/**
 * Index of the last entry in an ascending offset table that is `<= offset`, or -1 if `offset`
 * precedes the first entry.
 *
 * >>> TAKES AN ACCESSOR, NOT AN ARRAY, AND THAT IS LOAD-BEARING. <<< Both callers hold the offsets
 * as a field on a bigger record (`TextRun.concatStart`, `TextPiece.rawStart`). A `starts: number[]`
 * parameter would oblige each of them to `.map()` one out first — an O(n) allocation to serve an
 * O(log n) search, and `locate()` runs it twice per sentence for every sentence in a section. The
 * accessor reads the field in place and allocates nothing.
 */
export function indexOfOffset(length: number, at: (index: number) => number, offset: number): number {
  let lo = 0;
  let hi = length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}
