// Owner: Reader (Ahana).
//
// Pure sentence-boundary splitting and DOM skip-predicates for the TTS seam. No DOM access anywhere
// in this file — `epubTtsResolver.ts` does the DOM walking and hands this module plain strings and
// already-extracted attribute values, the same split `readerMetrics.ts` uses for its own predicates
// (e.g. `isForcedBreak(breakBefore: string)`).
//
// >>> NO Intl.Segmenter. <<< buildReaderHtml.ts's esbuild config targets `safari15`; Intl.Segmenter
// shipped in Safari 16.4. Relying on it would silently degrade (or throw) on real devices this app
// still supports, so sentence boundaries are found with a manual punctuation scan instead.

import { TTS_MAX_SENTENCE_CHARS } from '@/features/reader/tts/readerTextProvider';

/** A half-open [start, end) span into the string `splitIntoSentences` was called with. */
export interface SentenceSpan {
  start: number;
  end: number;
}

const SENTENCE_BOUNDARY = /[.!?]+["')\]]*(?=\s|$)/g;

function isWhitespaceChar(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * Split one span of text into `TTS_MAX_SENTENCE_CHARS`-capped pieces, breaking on the last space
 * within the cap rather than mid-word. Mirrors `fakeReaderTextProvider.ts`'s `capSentence` exactly,
 * so a caller that already validated behaviour against the fake sees the same splitting rule against
 * a real book: a single token longer than the cap is emitted over-length rather than cut mid-word.
 */
function pushCapped(text: string, start: number, end: number, into: SentenceSpan[]): void {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && isWhitespaceChar(text[trimmedStart])) trimmedStart++;
  while (trimmedEnd > trimmedStart && isWhitespaceChar(text[trimmedEnd - 1])) trimmedEnd--;
  if (trimmedEnd <= trimmedStart) return;

  let pieceStart = trimmedStart;
  while (trimmedEnd - pieceStart > TTS_MAX_SENTENCE_CHARS) {
    const windowEnd = Math.min(pieceStart + TTS_MAX_SENTENCE_CHARS + 1, trimmedEnd);
    const window = text.slice(pieceStart, windowEnd);
    const lastSpace = window.lastIndexOf(' ');
    const cut = lastSpace > 0 ? pieceStart + lastSpace : pieceStart + TTS_MAX_SENTENCE_CHARS;

    // Trim trailing whitespace at the cut independently of how the next piece's leading
    // whitespace is skipped below — robust to runs of more than one space, unlike trusting `cut`
    // itself to land exactly one character after the piece's real end.
    let pieceEnd = cut;
    while (pieceEnd > pieceStart && isWhitespaceChar(text[pieceEnd - 1])) pieceEnd--;
    into.push({ start: pieceStart, end: pieceEnd });

    let next = cut;
    while (next < trimmedEnd && isWhitespaceChar(text[next])) next++;
    pieceStart = next;
  }

  if (trimmedEnd > pieceStart) into.push({ start: pieceStart, end: trimmedEnd });
}

/**
 * Sentence-boundary spans over `text`, capped at `TTS_MAX_SENTENCE_CHARS` on a word boundary.
 *
 * Boundary detection is deliberately imprecise (an abbreviation like "Mr." reads as a sentence end)
 * — `readerTextProvider.ts`'s own contract accepts that; what it does not accept is exceeding the cap
 * or splitting mid-word, both of which this guarantees regardless of where the punctuation scan
 * lands. Content with no terminal punctuation for pages at a time (reference lists, tables rendered
 * as running text) falls entirely to the cap-splitting path — see the reference-list fixture this
 * mirrors in `fakeReaderTextProvider.ts`'s `DEFAULT_FAKE_BOOK[2]`.
 */
export function splitIntoSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let cursor = 0;

  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(text)) !== null) {
    const boundaryEnd = match.index + match[0].length;
    pushCapped(text, cursor, boundaryEnd, spans);
    cursor = boundaryEnd;
  }

  if (cursor < text.length) pushCapped(text, cursor, text.length, spans);

  return spans;
}

const SKIPPABLE_TAG_NAMES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/** Elements whose text is never speakable, regardless of attributes. */
export function isSkippableTagName(tagName: string): boolean {
  return SKIPPABLE_TAG_NAMES.has(tagName.toUpperCase());
}

const SKIPPABLE_ROLES = new Set(['presentation', 'none', 'doc-pagebreak']);

/** `aria-hidden="true"` or a presentation/pagebreak role — content marked not to be perceived. */
export function isSkippableByAttributes(ariaHidden: string | null, role: string | null): boolean {
  if (ariaHidden === 'true') return true;
  return role !== null && SKIPPABLE_ROLES.has(role);
}
