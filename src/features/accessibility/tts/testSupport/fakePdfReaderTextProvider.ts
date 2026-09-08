// Owner: Accessibility (Hruthik).
//
// A second ReaderTextProvider test double, deliberately NOT EPUB-shaped — its anchors look
// nothing like a CFI. It exists only to back a claim made in PDF_TTS_HANDOFF.md: useTtsSession
// and ttsEngine never parse `TtsSentence.cfi`, they only ever pass it back to the provider
// verbatim (`source.next(sentence.cfi)`, `source.setSpokenRange(currentlySpeaking.cfi)`), so
// nothing on this side of the seam has to change for a real PDF provider to start working.
//
// See `fakeReaderTextProvider.ts` for the full-featured EPUB-shaped fake this session's other
// tests use (empty-section skipping, the 400-char split, etc.) — that coverage is not
// duplicated here. This file's job is narrower: run the same CLASS of session scenario
// (ordering, a section/page boundary, an interruption) against an anchor shape that would break
// immediately if `useTtsSession` ever started assuming CFI structure.
//
// "pdf#page=<n>&sentence=<n>" is not a format the real PDF provider is committed to — see
// PDF_TTS_HANDOFF.md's open `TtsAnchor` design question. It only has to be non-CFI-shaped here.

import type {
  ReaderTextProvider,
  SpokenWordRange,
  TtsFetchResult,
  TtsInterruption,
  TtsSentence,
} from '@/features/reader/tts/readerTextProvider';

/** A book, as this fake models one: pages in reading order, each holding its sentences. */
export type FakePdfPage = readonly string[];
export type FakePdfBook = readonly FakePdfPage[];

/**
 * Three pages, chosen to reach the same class of boundary the EPUB fake reaches:
 *
 *  page 0 — two sentences, so `lastInSection` is false once and true once.
 *  page 1 — EMPTY, the PDF analogue of a blank plate or a page pdf.js found no text layer on.
 *           It never appears in the output, so `spineIndex` jumps 0 → 2.
 *  page 2 — a single sentence, also `lastInSection`.
 */
export const DEFAULT_FAKE_PDF_BOOK: FakePdfBook = [
  ['Chapter openings rarely announce themselves.', 'This one certainly did not.'],
  [],
  ['By the third page the pattern was obvious.'],
];

export interface FakePdfReaderTextProviderOptions {
  /** Content to serve. Defaults to DEFAULT_FAKE_PDF_BOOK. */
  book?: FakePdfBook;
  /** Where `current(null)` starts, as a flat sentence index. Default 0. */
  startIndex?: number;
}

/**
 * The fake, plus the handles a test needs to drive it — same shape as
 * `FakeReaderTextProvider`, and deliberately absent from `ReaderTextProvider` itself.
 */
export interface FakePdfReaderTextProvider extends ReaderTextProvider {
  readonly sentences: readonly TtsSentence[];
  readonly spokenRanges: readonly (string | null)[];
  /** Every `setSpokenWordRange` argument, in call order. `null` entries are clears. */
  readonly spokenWordRanges: readonly (SpokenWordRange | null)[];
  setPosition(index: number): void;
  navigate(index: number): void;
  interrupt(reason: TtsInterruption): void;
}

function fakePdfAnchor(page: number, sentenceIndex: number): string {
  return `pdf#page=${page}&sentence=${sentenceIndex}`;
}

function flatten(book: FakePdfBook): TtsSentence[] {
  const out: TtsSentence[] = [];

  book.forEach((page, pageIndex) => {
    page.forEach((text, sentenceIndex) => {
      out.push({
        text,
        cfi: fakePdfAnchor(pageIndex, sentenceIndex),
        spineIndex: pageIndex,
        sentenceIndex,
        lastInSection: sentenceIndex === page.length - 1,
      });
    });
  });

  return out;
}

const UNAVAILABLE: TtsFetchResult = { status: 'unavailable' };
const INVALID_ANCHOR: TtsFetchResult = { status: 'invalidAnchor' };
const END_OF_BOOK: TtsFetchResult = { status: 'endOfBook' };

export function createFakePdfReaderTextProvider(
  options: FakePdfReaderTextProviderOptions = {},
): FakePdfReaderTextProvider {
  const { book = DEFAULT_FAKE_PDF_BOOK, startIndex = 0 } = options;

  const sentences = flatten(book);
  const indexByAnchor = new Map<string, number>(sentences.map((s, i) => [s.cfi, i]));

  const spokenRanges: (string | null)[] = [];
  const spokenWordRanges: (SpokenWordRange | null)[] = [];
  const handlers = new Set<(reason: TtsInterruption) => void>();

  let position = startIndex;
  let terminated = false;

  function assertPosition(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > sentences.length) {
      throw new RangeError(
        `Position ${String(index)} is outside 0..${sentences.length} for this fake book.`,
      );
    }
  }

  function fire(reason: TtsInterruption): void {
    for (const handler of [...handlers]) {
      try {
        handler(reason);
      } catch {
        // Swallowed, matching the interface's own contract for onInterrupted handlers.
      }
    }
  }

  function resolveAt(index: number | undefined): TtsFetchResult {
    if (index === undefined) return INVALID_ANCHOR;
    const sentence = sentences[index];
    if (sentence === undefined) return END_OF_BOOK;
    return { status: 'ok', sentence };
  }

  return {
    sentences,
    spokenRanges,
    spokenWordRanges,

    async current(from: string | null): Promise<TtsFetchResult> {
      if (terminated) return UNAVAILABLE;
      return resolveAt(from === null ? position : indexByAnchor.get(from));
    },

    async next(after: string): Promise<TtsFetchResult> {
      if (terminated) return UNAVAILABLE;
      const from = indexByAnchor.get(after);
      if (from === undefined) return INVALID_ANCHOR;
      return resolveAt(from + 1);
    },

    setSpokenRange(anchor: string | null): void {
      if (terminated) return;
      spokenRanges.push(anchor);
    },

    setSpokenWordRange(range: SpokenWordRange | null): void {
      // Recorded the same way fakeReaderTextProvider.ts's does — useTtsSession's tts-progress
      // wiring is the real caller, and this fixture's whole point is proving that wiring doesn't
      // care that `range.cfi` is a "pdf#..." anchor rather than a CFI.
      if (terminated) return;
      spokenWordRanges.push(range);
    },

    onInterrupted(handler: (reason: TtsInterruption) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    setPosition(index: number): void {
      assertPosition(index);
      position = index;
    },

    navigate(index: number): void {
      assertPosition(index);
      position = index;
      if (terminated) return;
      fire('navigated');
    },

    interrupt(reason: TtsInterruption): void {
      if (terminated) return;
      if (reason !== 'navigated') terminated = true;
      fire(reason);
    },
  };
}
