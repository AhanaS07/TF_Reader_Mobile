// Owner: Reader (Ahana).
//
// TEMP: an in-memory ReaderTextProvider so Accessibility can build and test a TTS
// session before the real provider exists. Serves canned sentences with synthetic CFIs;
// there is no book, no WebView and no epub.js behind it.
//
// DELETE THIS FILE (and its test) when the real provider lands. The deletion list and
// the trigger are in TTS_PROVIDER.md in this folder — read it before removing anything,
// because the swap is meant to be a one-line import change on the Accessibility side and
// that only holds if nothing has grown a dependency on the helpers below.
//
// WHY A FAKE AND NOT "WAIT FOR THE REAL ONE". The real provider is blocked behind the
// typechecked-WebView conversion (WEBVIEW_BRIDGE.md), which is a Reader task of real
// size. Without this, Accessibility either idles or hand-rolls a stub — and a hand-rolled
// stub is a guess at this interface, so the eventual integration is a rewrite of their
// session rather than a substitution. Exporting the fake from the same folder the real
// provider will live in is what keeps the swap cheap.
//
// WHAT IT IS NOT. It is not a rendering test, not a CFI implementation, and not evidence
// that anything works against a real book. It exercises the SHAPE of the seam — ordering,
// section boundaries, cancellation, teardown — which is the part that is expensive to get
// wrong late.

import type {
  ReaderTextProvider,
  TtsFetchResult,
  TtsInterruption,
  TtsSentence,
} from '@/features/reader/tts/readerTextProvider';
import { TTS_MAX_SENTENCE_CHARS } from '@/features/reader/tts/readerTextProvider';

/**
 * A book, as this fake models one: spine items in reading order, each holding the
 * sentences it would yield.
 *
 * An EMPTY inner array is a spine item with nothing speakable in it, and including one is
 * the point rather than an oversight — see DEFAULT_FAKE_BOOK.
 */
export type FakeBook = readonly (readonly string[])[];

/**
 * The default content. Four spine items, chosen so that each of the four behaviours a
 * caller is most likely to get wrong is reachable without configuring anything:
 *
 *  index 0 — an ordinary section; three sentences, so `lastInSection` is false twice.
 *  index 1 — EMPTY. It never appears in the output, so `spineIndex` jumps 0 → 2 and a
 *            caller that assumed consecutive indices breaks here rather than on a real
 *            book six weeks from now.
 *  index 2 — contains a run of text far past TTS_MAX_SENTENCE_CHARS with no terminal
 *            punctuation, so the cap splits it and a caller sees more sentences than
 *            strings listed here.
 *  index 3 — a single sentence, so its only sentence is also `lastInSection`.
 */
export const DEFAULT_FAKE_BOOK: FakeBook = [
  [
    'The reader had been open for some time before anyone noticed the silence.',
    'It was not the absence of sound so much as the absence of anything worth hearing.',
    'She closed the book and set it down on the table beside her.',
  ],
  [],
  [
    'Morning came in slowly through the shutters.',
    // No terminal punctuation and comfortably past the cap: the provider must split this
    // at a word boundary rather than emit it whole or drop the tail.
    'and then the list continued as such lists do with entry after entry after entry ' +
      'each one indistinguishable from the last and none of them ending in anything a ' +
      'reasonable parser would treat as the close of a sentence which is precisely the ' +
      'condition that reference sections and legal front matter produce in practice and ' +
      'precisely the condition under which a naive segmenter hands back a paragraph and ' +
      'calls it a sentence and leaves the caller to discover the problem on a device',
  ],
  ['Everything after that happened quickly.'],
];

export interface FakeReaderTextProviderOptions {
  /** Content to serve. Defaults to DEFAULT_FAKE_BOOK. */
  book?: FakeBook;
  /**
   * Artificial delay on `current`/`next`, in milliseconds. Default 0.
   *
   * Worth setting to something non-trivial at least once: prefetch and cancellation bugs
   * are invisible when every fetch resolves in the same tick, which is exactly the
   * condition a zero-latency fake creates.
   */
  latencyMs?: number;
  /** Where `current(null)` starts, as a flat sentence index. Default 0. */
  startIndex?: number;
}

/**
 * The fake, plus the handles a test needs to drive it. The extra members are test-only
 * and do NOT exist on ReaderTextProvider — anything written against them has to be
 * deleted with this file, which is the intended pressure.
 */
export interface FakeReaderTextProvider extends ReaderTextProvider {
  /** Every sentence this fake can serve, flattened into reading order. */
  readonly sentences: readonly TtsSentence[];
  /** Every `setSpokenRange` argument, in call order. `null` entries are clears. */
  readonly spokenRanges: readonly (string | null)[];
  /** Every `setSpokenWordRange` argument, in call order. `cfi: null` entries are clears. */
  readonly spokenWordRanges: readonly { cfi: string | null; start: number; end: number }[];
  /** Move the reader's position silently. The resume-position setup. */
  setPosition(index: number): void;
  /** Move the position AND fire `navigated`, as a Contents tap or search hit would. */
  navigate(index: number): void;
  /** Fire an interruption. `closed`/`revoked` are terminal; `navigated` is not. */
  interrupt(reason: TtsInterruption): void;
}

/**
 * Split a run of text so no piece exceeds TTS_MAX_SENTENCE_CHARS, breaking on spaces.
 *
 * Mirrors what the real segmenter must do, and is here rather than in the test so a
 * caller meets the cap under the same conditions it will meet in production. A single
 * word longer than the cap is emitted over-length rather than cut mid-word: a
 * hyphenation-free 400-character token is not real prose, and slicing one would produce a
 * highlight over half a word.
 */
function capSentence(text: string): string[] {
  if (text.length <= TTS_MAX_SENTENCE_CHARS) return [text];

  const pieces: string[] = [];
  let rest = text;

  while (rest.length > TTS_MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, TTS_MAX_SENTENCE_CHARS + 1);
    const breakAt = window.lastIndexOf(' ');
    const cut = breakAt > 0 ? breakAt : TTS_MAX_SENTENCE_CHARS;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

/**
 * A CFI shaped like one epub.js would mint, for a sentence range.
 *
 * `/6/N` is the spine step (N = (index + 1) * 2), `!` enters the section document, and
 * the trailing triple is a range: parent path, then start and end offsets.
 *
 * >>> THESE DO NOT RESOLVE AGAINST ANY BOOK. <<< They are well-formed so that logs and
 * breakpoints read the way they will in production, and for no other reason. Do not
 * compare them with EpubCFI.compare, do not parse them for ordering, and do not persist
 * one. The seam's rule — treat `cfi` as opaque, pass it back verbatim — is what makes the
 * swap to real CFIs a no-op, and it is enforced here only by this comment.
 */
function fakeCfi(spineIndex: number, sentenceIndex: number, text: string): string {
  const spineStep = (spineIndex + 1) * 2;
  const nodeStep = (sentenceIndex + 1) * 2;
  return `epubcfi(/6/${spineStep}!/4/2/${nodeStep},/1:0,/1:${text.length})`;
}

function flatten(book: FakeBook): TtsSentence[] {
  const out: TtsSentence[] = [];

  book.forEach((section, spineIndex) => {
    // Capping BEFORE indexing, not after: `sentenceIndex` counts what is actually
    // emitted, so a split run advances it by two. The real segmenter has the same
    // property, and a test that assumed otherwise would pass here and fail there.
    const pieces = section.flatMap(capSentence);

    pieces.forEach((text, sentenceIndex) => {
      out.push({
        text,
        cfi: fakeCfi(spineIndex, sentenceIndex, text),
        spineIndex,
        sentenceIndex,
        lastInSection: sentenceIndex === pieces.length - 1,
      });
    });
  });

  return out;
}

/**
 * Resolve true if the delay elapsed, false if `signal` aborted first.
 *
 * The listener is removed on the normal path. Without that, a long-lived AbortSignal
 * reused across many sentences accumulates one dead listener per fetch — which is a slow
 * leak in the fake and a warning in the console, neither of which is the caller's bug.
 */
function wait(latencyMs: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(false);
  if (latencyMs <= 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    // Declared before the timer so the abort handler can clear it, assigned after so the
    // timer callback can remove the handler. Neither runs before both exist.
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(false);
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, latencyMs);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const UNAVAILABLE: TtsFetchResult = { status: 'unavailable' };
const INVALID_ANCHOR: TtsFetchResult = { status: 'invalidAnchor' };
const END_OF_BOOK: TtsFetchResult = { status: 'endOfBook' };

export function createFakeReaderTextProvider(
  options: FakeReaderTextProviderOptions = {},
): FakeReaderTextProvider {
  const { book = DEFAULT_FAKE_BOOK, latencyMs = 0, startIndex = 0 } = options;

  const sentences = flatten(book);

  // CFI → flat index. Also the anchor validator: a CFI that is not in here is one this
  // provider never emitted, which is precisely the `invalidAnchor` case. That makes the
  // status reachable in a test by passing any garbage string, with no special mode.
  const indexByCfi = new Map<string, number>(sentences.map((s, i) => [s.cfi, i]));

  const spokenRanges: (string | null)[] = [];
  const spokenWordRanges: { cfi: string | null; start: number; end: number }[] = [];
  const handlers = new Set<(reason: TtsInterruption) => void>();

  let position = startIndex;
  let terminated = false;

  function assertPosition(index: number): void {
    // `sentences.length` is allowed: it is the one-past-the-end position, and it is how a
    // test reaches `endOfBook` from `current(null)` rather than only from `next`.
    if (!Number.isInteger(index) || index < 0 || index > sentences.length) {
      throw new RangeError(
        `Position ${String(index)} is outside 0..${sentences.length} for this fake book.`,
      );
    }
  }

  function fire(reason: TtsInterruption): void {
    // Iterate a copy: a handler that unsubscribes itself during dispatch — the normal
    // thing for a one-shot teardown handler to do — would otherwise mutate the set mid-
    // iteration.
    for (const handler of [...handlers]) {
      try {
        handler(reason);
      } catch {
        // Swallowed, matching what the interface promises and what event-bus.ts requires
        // of `emit`. The real provider fires this from the closeBook effect cleanup; a
        // subscriber that throws must not be able to stop the book being torn down.
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

    async current(from: string | null, signal?: AbortSignal): Promise<TtsFetchResult> {
      if (terminated) return UNAVAILABLE;
      if (!(await wait(latencyMs, signal))) return UNAVAILABLE;
      // Re-checked AFTER the wait, which is the whole point of the flag: this is the
      // in-flight request that teardown has to be able to starve. Without this line a
      // fetch issued before closeBook would still deliver text afterwards.
      if (terminated) return UNAVAILABLE;

      return resolveAt(from === null ? position : indexByCfi.get(from));
    },

    async next(after: string, signal?: AbortSignal): Promise<TtsFetchResult> {
      if (terminated) return UNAVAILABLE;
      if (!(await wait(latencyMs, signal))) return UNAVAILABLE;
      if (terminated) return UNAVAILABLE;

      const from = indexByCfi.get(after);
      if (from === undefined) return INVALID_ANCHOR;
      return resolveAt(from + 1);
    },

    setSpokenRange(cfi: string | null): void {
      // Recorded even when the CFI is unknown, and never validated: the real one paints
      // nothing and reports nothing in that case, so throwing here would train a caller
      // against a guarantee it will not get.
      if (terminated) return;
      spokenRanges.push(cfi);
    },

    setSpokenWordRange(cfi: string | null, start: number, end: number): void {
      // Same recording contract as setSpokenRange, for the same reason.
      if (terminated) return;
      spokenWordRanges.push({ cfi, start, end });
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
      if (terminated) return; // idempotent, like ContentStore.close()
      // Set BEFORE firing, so a handler that reacts by calling current() gets the
      // `unavailable` it would get in production rather than a sentence.
      if (reason !== 'navigated') terminated = true;
      fire(reason);
    },
  };
}
