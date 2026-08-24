// Owner: Reader (Ahana).
//
// Segmentation and CFI-minting against a REAL epub.js book — the DOM/library-touching half of the
// TTS seam. Not unit-tested, same tier as `epub.entry.ts`: it walks live DOM and calls epub.js
// instance methods, neither of which a Jest/jsdom test can stand in for meaningfully. The PURE
// splitting/skip logic lives in `ttsSegmentation.ts`, which is tested.
//
// >>> THREE SHIPPED epub.js TYPES ARE WRONG, in the same way `addStylesheetCss`'s already documented
// in epub.entry.ts. Each is narrowed ONCE, here, with a local cast — never assumed at a call site. <<<
//
//   1. `Section.load()` is declared `Document`, synchronous. section.js's real implementation
//      returns a `defer().promise` — genuinely async, resolving once the section's XML has been
//      fetched and parsed. Awaited, then `section.document` (a public property, set as a side effect
//      before the promise resolves) is read directly rather than trusted as the resolved value.
//   2. `Spine.get()` is declared to return a non-null `Section`. spine.js's real implementation is
//      `return this.spineItems[index] || null` — reachable for any index past the end of a real
//      book's spine, which is exactly how this module detects end-of-book.
//   3. `Rendition.getRange()` is declared to return a non-optional `Range`. rendition.js's real
//      implementation returns `undefined` when no currently-visible view matches the CFI's spine
//      position — reachable whenever `current(null)`'s anchor names a spine position that, for
//      whatever reason, is not on screen.
//
// >>> WHY MINTING AGAINST AN OFFLINE `section.load()` PARSE IS TRUSTED. <<< A section not currently
// rendered has no live iframe document — segmenting it means parsing its XML directly, which is a
// DIFFERENT parse (XHTML) than what the rendered iframe holds (HTML, from `section.render()`'s
// serialize-then-reparse). `src/features/search/extractor.ts`'s `chapterEntriesChecked` already
// established, and empirically validated against this app's real books, that CFIs minted from that
// offline parse resolve correctly once the section is later rendered. This module relies on that same
// precedent rather than re-establishing it. Revisit only on an observed real-book divergence, not as
// a precaution — same accepted-until-a-real-complaint posture WEBVIEW_BRIDGE.md already documents for
// the pre-paginated cover-pairing gap.

import type { Book, Contents, Rendition } from 'epubjs';

import type { TtsFetchResult, TtsSentence } from '@/features/reader/tts/readerTextProvider';

import { isSkippableByAttributes, isSkippableTagName, splitIntoSentences } from './ttsSegmentation';

/** Structural alias for epub.js's un-exported `Section` class — `Book`/`Spine`'s own declarations
 * reference it internally, so it needs no import; only naming it publicly would. */
type EpubSection = NonNullable<ReturnType<Book['spine']['get']>>;

type LoadSection = (request?: (...args: unknown[]) => unknown) => Promise<Document>;

async function loadSectionDocument(section: EpubSection): Promise<Document> {
  await (section as unknown as { load: LoadSection }).load();
  return section.document;
}

type SpineGet = (target?: string | number) => EpubSection | null;

function spineGet(book: Book, target: string | number | undefined): EpubSection | null {
  return (book.spine as unknown as { get: SpineGet }).get(target);
}

type GetRange = (cfi: string, ignoreClass?: string) => Range | undefined;

function renditionGetRange(rendition: Rendition, cfi: string): Range | undefined {
  return (rendition as unknown as { getRange: GetRange }).getRange(cfi);
}

function findRenderedContents(rendition: Rendition, spineIndex: number): Contents | null {
  const all = rendition.getContents() as unknown as Contents[];
  return all.find((contents) => contents.sectionIndex === spineIndex) ?? null;
}

function isTextNodeSpeakable(node: Text): boolean {
  let el = node.parentElement;
  while (el) {
    if (isSkippableTagName(el.tagName)) return false;
    if (isSkippableByAttributes(el.getAttribute('aria-hidden'), el.getAttribute('role'))) return false;
    el = el.parentElement;
  }
  return true;
}

interface TextRun {
  node: Text;
  text: string;
  concatStart: number;
}

/**
 * Walk `root`'s text nodes into one run list, joined by a single space between nodes (so
 * `<span>foo</span><span>bar</span>` reads "foo bar", not "foobar") — plus the concatenated string
 * `splitIntoSentences` scans. Runs keep their ORIGINAL (uncollapsed) text; `segmentDocument` collapses
 * whitespace only on the final `range.toString()` output, so a span's char count here is a safe
 * over-estimate of what the cap will see, never an under-estimate.
 */
function buildRuns(root: Node): { runs: TextRun[]; concatenated: string } {
  const runs: TextRun[] = [];
  let concatenated = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const text = node as Text;
      if (text.data.trim().length === 0) return NodeFilter.FILTER_REJECT;
      return isTextNodeSpeakable(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    if (runs.length > 0) concatenated += ' ';
    runs.push({ node: textNode, text: textNode.data, concatStart: concatenated.length });
    concatenated += textNode.data;
    current = walker.nextNode();
  }

  return { runs, concatenated };
}

/** Map one offset in the concatenated string back to a (node, localOffset) DOM position, via binary
 * search over `runs` (sorted by `concatStart` by construction). */
function locate(runs: TextRun[], globalOffset: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = runs.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid].concatStart <= globalOffset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (found === -1) return null;
  const run = runs[found];
  const localOffset = globalOffset - run.concatStart;
  if (localOffset <= run.text.length) return { node: run.node, offset: localOffset };

  // Offset falls in the single-space separator this module inserted between runs, not in the
  // original text — land on the boundary it's closest to.
  const next = runs[found + 1];
  return next ? { node: next.node, offset: 0 } : { node: run.node, offset: run.text.length };
}

function rangeForSpan(
  doc: Document,
  runs: TextRun[],
  span: { start: number; end: number },
): Range | null {
  const start = locate(runs, span.start);
  const end = locate(runs, span.end);
  if (!start || !end) return null;

  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

interface CachedSentence {
  text: string;
  cfi: string;
  sentenceIndex: number;
  lastInSection: boolean;
}

interface CachedSection {
  sentences: CachedSentence[];
}

/**
 * Segment one section's document into sentences. `mintCfi` is the section's or the live contents'
 * `cfiFromRange` — whichever the caller resolved — so this stays ignorant of which path it's on.
 *
 * `text` comes from `range.toString()`, not from slicing the pure module's concatenated string: that
 * is what makes "text and cfi are two projections of one Range" literally true, per
 * `readerTextProvider.ts`'s own invariant, rather than merely intended. Whitespace is collapsed on
 * this final string only — the cap (`splitIntoSentences`, applied to the uncollapsed concatenation)
 * already guarantees the pre-collapse length is within bounds, and collapsing only ever shortens a
 * string, so the emitted `text` cannot exceed the cap either.
 */
function segmentDocument(doc: Document, mintCfi: (range: Range) => string): CachedSentence[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];

  const { runs, concatenated } = buildRuns(root);
  if (runs.length === 0) return [];

  const sentences: CachedSentence[] = [];

  for (const span of splitIntoSentences(concatenated)) {
    const range = rangeForSpan(doc, runs, span);
    if (!range) continue;

    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;

    sentences.push({
      text,
      cfi: mintCfi(range),
      sentenceIndex: sentences.length,
      lastInSection: false,
    });
  }

  const last = sentences[sentences.length - 1];
  if (last) last.lastInSection = true;

  return sentences;
}

// spineIndex -> segmented sentences. `null` is never stored; a section that yields nothing
// speakable, or is non-linear, is cached as `{ sentences: [] }` so callers skip it without
// re-segmenting on every request that passes through it.
const sectionCache = new Map<number, CachedSection>();

// Reverse lookup: a CFI this module has emitted -> where it came from. This is what makes `next()`/
// `current(exactCfi)` an exact map lookup rather than a re-derivation from the CFI string, and what
// makes an unrecognised CFI (`invalidAnchor`) detectable at all.
const cfiIndex = new Map<string, { spineIndex: number; sentenceIndex: number }>();

/** Reset all cached segmentation. Call this once, at the top of `openEpub`, before `book`/`rendition`
 * are reassigned — a stale cache entry from a previous book would answer with someone else's CFIs. */
export function resetTtsState(): void {
  sectionCache.clear();
  cfiIndex.clear();
}

async function resolveSection(
  book: Book,
  rendition: Rendition,
  spineIndex: number,
): Promise<CachedSection | null> {
  const cached = sectionCache.get(spineIndex);
  if (cached) return cached;

  const section = spineGet(book, spineIndex);
  if (!section) return null; // past the end of the spine

  if (!section.linear) {
    const empty: CachedSection = { sentences: [] };
    sectionCache.set(spineIndex, empty);
    return empty;
  }

  const renderedContents = findRenderedContents(rendition, spineIndex);
  const doc = renderedContents ? renderedContents.document : await loadSectionDocument(section);
  const mintCfi = renderedContents
    ? (range: Range): string => renderedContents.cfiFromRange(range)
    : (range: Range): string => section.cfiFromRange(range);

  const sentences = segmentDocument(doc, mintCfi);
  const result: CachedSection = { sentences };
  sectionCache.set(spineIndex, result);

  for (const sentence of sentences) {
    cfiIndex.set(sentence.cfi, { spineIndex, sentenceIndex: sentence.sentenceIndex });
  }

  return result;
}

interface Found {
  spineIndex: number;
  sentence: CachedSentence;
}

/** The shared forward-walk: the first speakable sentence at or after `(spineIndex, sentenceIndex)`,
 * skipping empty and non-linear sections. `null` means the spine ran out — `endOfBook`. */
async function firstSentenceFrom(
  book: Book,
  rendition: Rendition,
  spineIndex: number,
  sentenceIndex: number,
): Promise<Found | null> {
  const section = await resolveSection(book, rendition, spineIndex);
  if (section === null) return null;

  const sentence = section.sentences[sentenceIndex];
  if (sentence) return { spineIndex, sentence };

  return firstSentenceFrom(book, rendition, spineIndex + 1, 0);
}

function toTtsSentence(found: Found): TtsSentence {
  return {
    text: found.sentence.text,
    cfi: found.sentence.cfi,
    spineIndex: found.spineIndex,
    sentenceIndex: found.sentence.sentenceIndex,
    lastInSection: found.sentence.lastInSection,
  };
}

function ok(found: Found): TtsFetchResult {
  return { status: 'ok', sentence: toTtsSentence(found) };
}

/**
 * "Wherever the reader actually is" — `lastCfi` is `epub.entry.ts`'s own tracked point CFI from the
 * most recent `relocated` event, which is by construction the currently-VISIBLE section, so this
 * always takes `resolveSection`'s live-rendered-document path, never the offline-parse one. That is
 * what makes comparing `pointRange` against each cached sentence's range safe: both come from the
 * same document.
 */
async function resolveFromLivePosition(
  book: Book,
  rendition: Rendition,
  lastCfi: string | null,
): Promise<TtsFetchResult> {
  if (lastCfi === null) {
    const found = await firstSentenceFrom(book, rendition, 0, 0);
    return found ? ok(found) : { status: 'endOfBook' };
  }

  const anchorSection = spineGet(book, lastCfi);
  if (!anchorSection || !anchorSection.linear) {
    const startIndex = anchorSection ? anchorSection.index + 1 : 0;
    const found = await firstSentenceFrom(book, rendition, startIndex, 0);
    return found ? ok(found) : { status: 'endOfBook' };
  }

  const cached = await resolveSection(book, rendition, anchorSection.index);
  if (!cached || cached.sentences.length === 0) {
    const found = await firstSentenceFrom(book, rendition, anchorSection.index + 1, 0);
    return found ? ok(found) : { status: 'endOfBook' };
  }

  const pointRange = renditionGetRange(rendition, lastCfi);
  if (!pointRange) {
    // The live position isn't (or is no longer) resolvable against the current view — the reader is
    // still somewhere in this section, so start it from the top rather than failing the request.
    return ok({ spineIndex: anchorSection.index, sentence: cached.sentences[0] });
  }

  for (const sentence of cached.sentences) {
    const sentenceRange = renditionGetRange(rendition, sentence.cfi);
    if (!sentenceRange) continue;
    // A single comparePoint handles both "mid-sentence" and "between sentences": the first sentence
    // whose range is not entirely before the point is the containing-or-next one.
    if (sentenceRange.comparePoint(pointRange.startContainer, pointRange.startOffset) !== 1) {
      return ok({ spineIndex: anchorSection.index, sentence });
    }
  }

  const found = await firstSentenceFrom(book, rendition, anchorSection.index + 1, 0);
  return found ? ok(found) : { status: 'endOfBook' };
}

/** `ReaderTextProvider.current`'s WebView-side counterpart. `from === null` resolves the live
 * position; otherwise `from` must be a CFI this module previously emitted. */
export async function resolveCurrent(
  book: Book,
  rendition: Rendition,
  from: string | null,
  lastCfi: string | null,
): Promise<TtsFetchResult> {
  if (from === null) return resolveFromLivePosition(book, rendition, lastCfi);

  const anchor = cfiIndex.get(from);
  if (!anchor) return { status: 'invalidAnchor' };

  const section = await resolveSection(book, rendition, anchor.spineIndex);
  const sentence = section?.sentences[anchor.sentenceIndex];
  return sentence ? ok({ spineIndex: anchor.spineIndex, sentence }) : { status: 'invalidAnchor' };
}

/** `ReaderTextProvider.next`'s WebView-side counterpart. `after` must be a CFI this module
 * previously emitted. */
export async function resolveNext(book: Book, rendition: Rendition, after: string): Promise<TtsFetchResult> {
  const anchor = cfiIndex.get(after);
  if (!anchor) return { status: 'invalidAnchor' };

  const section = await resolveSection(book, rendition, anchor.spineIndex);
  const nextInSection = section?.sentences[anchor.sentenceIndex + 1];
  if (nextInSection) return ok({ spineIndex: anchor.spineIndex, sentence: nextInSection });

  const found = await firstSentenceFrom(book, rendition, anchor.spineIndex + 1, 0);
  return found ? ok(found) : { status: 'endOfBook' };
}
