// Owner: Reader (Ahana).
//
// The pure sentence-boundary splitter and DOM skip-predicates, executed against fixtures that mirror
// `fakeReaderTextProvider.ts`'s `DEFAULT_FAKE_BOOK` — same shapes, same guarantees, now against a
// real (if manual) segmenter rather than pre-split canned strings.

import {
  isSkippableByAttributes,
  isSkippableTagName,
  splitIntoSentences,
} from '@/features/reader/webview/src/ttsSegmentation';
import { TTS_MAX_SENTENCE_CHARS } from '@/features/reader/tts/readerTextProvider';

function spansOf(text: string): string[] {
  return splitIntoSentences(text).map(({ start, end }) => text.slice(start, end));
}

describe('splitIntoSentences', () => {
  it('splits ordinary prose at terminal punctuation', () => {
    const text =
      'The reader had been open for some time before anyone noticed the silence. ' +
      'It was not the absence of sound so much as the absence of anything worth hearing. ' +
      'She closed the book and set it down on the table beside her.';

    expect(spansOf(text)).toEqual([
      'The reader had been open for some time before anyone noticed the silence.',
      'It was not the absence of sound so much as the absence of anything worth hearing.',
      'She closed the book and set it down on the table beside her.',
    ]);
  });

  it('keeps closing quotes and brackets with the sentence they end', () => {
    const text = 'She said "it is late." He agreed (reluctantly). Then they left.';
    expect(spansOf(text)).toEqual([
      'She said "it is late."',
      'He agreed (reluctantly).',
      'Then they left.',
    ]);
  });

  it('returns no spans for empty or whitespace-only input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   \n\t  ')).toEqual([]);
  });

  it('caps a run with no terminal punctuation at a word boundary, never mid-word', () => {
    // Mirrors DEFAULT_FAKE_BOOK[2]'s reference-list fixture: no sentence-terminal punctuation for
    // pages at a time, comfortably past the cap.
    const text =
      'and then the list continued as such lists do with entry after entry after entry ' +
      'each one indistinguishable from the last and none of them ending in anything a ' +
      'reasonable parser would treat as the close of a sentence which is precisely the ' +
      'condition that reference sections and legal front matter produce in practice and ' +
      'precisely the condition under which a naive segmenter hands back a paragraph and ' +
      'calls it a sentence and leaves the caller to discover the problem on a device';

    const spans = spansOf(text);
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) {
      expect(span.length).toBeLessThanOrEqual(TTS_MAX_SENTENCE_CHARS);
      expect(span.startsWith(' ')).toBe(false);
      expect(span.endsWith(' ')).toBe(false);
    }
    // Reassembling with single spaces reproduces the source: nothing was dropped or duplicated.
    expect(spans.join(' ')).toBe(text);
  });

  it('caps a single space-free token at exactly the limit, same as capSentence', () => {
    // No space anywhere to break on, so this mirrors fakeReaderTextProvider's own capSentence:
    // cut at the cap length itself rather than emit one over-length piece. Documented behaviour,
    // not a rare-in-practice concern this segmenter needs to solve differently from the fake.
    const longToken = 'a'.repeat(TTS_MAX_SENTENCE_CHARS + 50);
    const spans = spansOf(`${longToken}.`);
    expect(spans).toEqual([
      'a'.repeat(TTS_MAX_SENTENCE_CHARS),
      `${'a'.repeat(50)}.`,
    ]);
    for (const span of spans) {
      expect(span.length).toBeLessThanOrEqual(TTS_MAX_SENTENCE_CHARS);
    }
  });

  it('never exceeds the cap even when a natural boundary lands far past it', () => {
    const text = `${'word '.repeat(200).trim()}.`;
    const spans = spansOf(text);
    for (const span of spans) {
      expect(span.length).toBeLessThanOrEqual(TTS_MAX_SENTENCE_CHARS);
    }
  });
});

describe('isSkippableTagName', () => {
  it.each(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'script', 'style'])(
    'is true for %s',
    (tagName) => {
      expect(isSkippableTagName(tagName)).toBe(true);
    },
  );

  it.each(['P', 'SPAN', 'DIV', 'EM'])('is false for %s', (tagName) => {
    expect(isSkippableTagName(tagName)).toBe(false);
  });
});

describe('isSkippableByAttributes', () => {
  it('is true when aria-hidden is "true"', () => {
    expect(isSkippableByAttributes('true', null)).toBe(true);
  });

  it('is false when aria-hidden is "false" or absent', () => {
    expect(isSkippableByAttributes('false', null)).toBe(false);
    expect(isSkippableByAttributes(null, null)).toBe(false);
  });

  it.each(['presentation', 'none', 'doc-pagebreak'])('is true for role=%s', (role) => {
    expect(isSkippableByAttributes(null, role)).toBe(true);
  });

  it('is false for an ordinary role', () => {
    expect(isSkippableByAttributes(null, 'doc-chapter')).toBe(false);
  });
});
