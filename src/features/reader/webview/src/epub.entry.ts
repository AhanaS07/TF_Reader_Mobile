// Owner: Reader (Ahana).
//
// THE EPUB SHELL'S ENTRY POINT. Compiled by buildReaderHtml.ts (esbuild, one IIFE) and inlined into
// assets/reader/reader-epub.html. Its sibling is pdf.entry.ts; the shared half is bridge.ts, and the
// typographic arithmetic is readerMetrics.ts.
//
// WHAT LIVES HERE vs IN readerMetrics.ts: this file reads the DOM and drives epub.js, so it is not
// unit tested. Everything that is a pure function of its arguments lives next door, where tests can
// call it rather than lift it out of an .html file with `new Function`.
//
// epub.js AND JSZip ARRIVE ON `window`, NOT THROUGH AN IMPORT. They are inlined as classic scripts by
// the generator, so importing either as a VALUE would bundle a second copy into this entry.
// buildReaderHtml.ts enforces that with a hard size ceiling. Types are imported and erased.
//
// LOAD ORDER IS LOAD-BEARING and belongs to the generator, not to this file: JSZip must be defined
// before epub.js runs, because epub.js 0.3.93 ships JSZip as a webpack EXTERNAL read off `window` at
// definition time. With the order swapped, `ePub` is defined with JSZip === undefined and every real
// (archived) EPUB fails deep inside the unzip. The `JSZIP_MISSING` check at the bottom is what turns
// that into a coded error rather than a confusing one.

import type { Book, Contents, Rendition } from 'epubjs';

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type { EpubHighlightPaint } from '@/features/personalization/readerHighlights';
import type { EpubSearchMatch } from '@/features/search/readerSearchMatch';
import type { ReaderSelection } from '@/features/reader/readerBridge';

import {
  base64ToArrayBuffer,
  fail,
  installErrorHandlers,
  post,
  publish,
  type TFReaderApi,
} from './bridge';
import {
  resetTtsState,
  resolveCurrent,
  resolveNext,
  resolveSpokenWordCfi,
} from './epubTtsResolver';
import { cfiSpinePos, expandPointCfi, joinCfiRange, splitCfiRange } from './epubCfiRange';
import { layoutSignature } from './epubLayoutSignature';
import { flattenToc, type NavItem } from './epubOutline';
import { forceReflow } from './epubViewGeometry';
import { anyRectOnScreen, highlightAt, rangesOverlap, type HighlightBox } from './highlightGeometry';
import { diffHighlights, epubHighlights } from './highlightPaint';
import { add as highlightAdd, remove as highlightRemove } from './highlightSeam';
import { highlightFill, matchStroke, spokenWordOpacity } from './selectionTheme';
import { LONG_PRESS_MS, movedBeyondSlop, swipeDirection, type TouchPoint } from './touchGesture';
import {
  baselineCss,
  cappedIndent,
  columnOverrideCss,
  isExcessiveIndent,
  isForcedBreak,
  isMultiColumnCount,
  isPaginated,
  READER_FLOW,
  readerMetrics,
  sanitizeFontDataUri,
  sanitizeFontFamily,
  type AppearanceCssOptions,
  type ReaderFlow,
  type TypographyInput,
} from './readerMetrics';

/** epub.js's factory, as it appears on `window`. */
type EPubFactory = () => Book;

installErrorHandlers();

let book: Book | null = null;
let rendition: Rendition | null = null;

/** Key for OUR <style> node inside each chapter document. Stable, because `addStylesheetCss`
 * replaces the node with this id rather than adding another. */
const STYLESHEET_KEY = 'tf-baseline';

/** The last CSS we built. Read by the content hook for chapters that load later — a book is many
 * documents, and each one needs the sheet inserted again. */
let currentCss = '';

/**
 * The latest `applyAppearance` payload, or null before the first one arrives. The host sends this
 * before `openEpub` (see readerBridge.ts), so in practice this is set before `book.open()` runs —
 * but nothing here may ASSUME that: null falls back to the same DEFAULT_PREFS-derived baseline the
 * reader painted before prefs-application existed.
 */
let currentAppearance: ReaderAppearance | null = null;

/**
 * The flow the CURRENT rendition was actually built with, and whether `openEpub` is still building
 * one. Together they are what makes a flow change safe to act on.
 *
 * >>> WHY NOT JUST COMPARE THE LAST TWO PAYLOADS' `flow` FIELDS <<<
 * `openEpub` assigns `rendition` and then awaits `display()`. An `applyAppearance` landing in that
 * window would find a non-null rendition, destroy it, and leave the in-flight `display()` running
 * against a destroyed object — which rejects, and surfaces as OPEN_FAILED on a book that was opening
 * perfectly well. The window is small but it is reachable: turning a screen reader ON mid-open makes
 * the host re-resolve and re-send with a different flow (readerA11yLayout.ts), and so does touching
 * the layout toggle while the book loads.
 *
 * So a rebuild asks "does what is on screen match what was asked for", not "did the payload change",
 * and it is deferred while an open owns the rendition — `openEpub` re-checks once it is done.
 */
let renditionFlow: ReaderFlow | null = null;
let openInFlight = false;

/** The last reported CFI, kept only to re-display the reading position after a live flow change —
 * the one appearance change that needs epub.js to re-layout rather than just re-style. Also what
 * `requestTtsSentence`'s `current(null)` resolves against: "wherever the reader actually is." */
let lastCfi: string | null = null;

/** The CFI `setSpokenRange` last painted, or null if nothing is currently highlighted. Kept so a
 * flow-triggered rendition rebuild (a new `Annotations` store) can re-paint it, and so `setSpokenRange`
 * itself can remove the previous range before adding the new one — the seam is stateless by design;
 * this is the caller-side state it expects. */
let currentSpokenCfi: string | null = null;

/** The CFI `setSpokenWordRange` last painted — the WORD inside `currentSpokenCfi`'s sentence — or
 * null if nothing is. Same three jobs as its sentence sibling (remove before the next add, re-paint
 * after a rendition rebuild, re-derive the shade when the page changes colour), plus one of its own:
 * it is what `setSpokenRange` clears, because a word is only meaningful inside the sentence it was
 * resolved against.
 *
 * ONLY THE CFI IS KEPT, NEVER THE RANGE OR THE NODES IT CAME FROM. A CFI survives a reflow (it is
 * element indices plus an offset), so every repaint below re-adds this string and lets epub.js
 * resolve a FRESH Range — which is also what re-measures it. Retaining the Range instead would keep
 * Text nodes belonging to a document that may since have been re-rendered; `resolveSpokenWordCfi`'s
 * own header says the same thing about caching, at more length. */
let currentSpokenWordCfi: string | null = null;

/** The CFI last brought on screen by auto-follow's own `display()`, or null. Lets a repeat call for
 * the SAME target skip re-checking geometry — once auto-follow has just displayed it, re-issuing
 * `display()` for it again would fight the manager mid-settle rather than dedupe. See
 * `followSpokenRange`. Reset alongside the other TTS CFI state in `openEpub`. */
let lastAutoFollowedCfi: string | null = null;

/** True while a `followSpokenRange`-triggered `display()` has not yet settled. See
 * `followSpokenRange`'s own note for why a second, overlapping call must wait rather than fire.
 * Reset alongside the other TTS CFI state in `openEpub`. */
let followDisplayInFlight = false;

const TTS_OWNER = 'tts';
const TTS_SPOKEN_VARIANT = 'spoken';
const TTS_SPOKEN_WORD_VARIANT = 'spoken-word';

/** TTS's channel (HIGHLIGHT_LAYERS.md §3): a translucent overlay. SVG presentation attributes, not
 * CSS — marks-pane applies them via `setAttribute`. `0.2`, kept below `user`'s opacity so the two
 * stay visually ordered.
 *
 * A FUNCTION, NOT A CONSTANT, for the same reason `userHighlightStyles` is: `multiply` against a
 * near-black page multiplies towards black, so a fixed blend made the spoken word invisible on the
 * dark theme — the layer that most needs to be seen, since it is what tells the reader where the
 * voice is. Re-derived on every paint and re-applied by `repaintLiveAnnotations` on a theme change. */
const TTS_SPOKEN_COLOR = '#ffd500';

function ttsSpokenStyles(): Record<string, string> {
  const { fill, blend } = highlightFill(TTS_SPOKEN_COLOR, currentAppearance?.bg);
  return { fill, 'fill-opacity': '0.2', 'mix-blend-mode': blend };
}

/** The word inside the spoken sentence: the SAME fill and the SAME blend, at a higher opacity.
 *
 * Not a second colour, and not an outline (that is `search`'s channel — a word-sized box inside a
 * sentence wash reads as a search hit). Sharing one `highlightFill` call is what makes the pair
 * legible on all three themes without a per-theme table: the two layers can never disagree about
 * fill or blend, so more opacity is more prominent on every page. `spokenWordOpacity` picks the
 * number from the blend and carries the whole argument, including which two numbers a device check
 * is actually checking. */
function ttsSpokenWordStyles(): Record<string, string> {
  const { fill, blend } = highlightFill(TTS_SPOKEN_COLOR, currentAppearance?.bg);
  return { fill, 'fill-opacity': spokenWordOpacity(blend), 'mix-blend-mode': blend };
}

const USER_OWNER = 'user';
const USER_SAVED_VARIANT = 'saved';

/** The user layer's channel (HIGHLIGHT_LAYERS.md §3): solid-reading fill via `mix-blend-mode`.
 * `highlightFill` (`selectionTheme.ts`) picks fill/blend per theme — a fixed `multiply` at full
 * opacity was confirmed unreadable on every theme, and even at partial opacity nearly invisible on
 * dark and low-contrast on sepia. */
function userHighlightStyles(color: string): Record<string, string> {
  const { fill, blend } = highlightFill(color, currentAppearance?.bg);
  return { fill, 'fill-opacity': '0.25', 'mix-blend-mode': blend };
}

const SEARCH_OWNER = 'search';
const SEARCH_MATCH_VARIANT = 'match';

/** The range CFI the search match is currently painted at, or null if nothing is. The caller-side
 * "what did I last paint" the seam deliberately does not keep — same shape as `currentSpokenCfi`,
 * and needed for the same three reasons: to remove before the next paint, to re-add after a flow
 * rebuild, and to re-derive the stroke when the page changes colour. */
let currentSearchRange: string | null = null;

/**
 * What one attempt to paint the search match did.
 *
 * `refused` and `pending` are the two that matter and they are NOT the same thing: `refused` means
 * this range will never draw (so say so), `pending` means the chapter it lives in is not on screen
 * yet (so say nothing and try again). Collapsing them into a boolean is what put a notice on screen
 * for every match, since the chapter is normally still loading when the payload arrives.
 *
 * The PDF shell has its own four-valued sibling in `pdfSearchMatch.ts`, differing only in `cued`
 * (a fallback this shell has no equivalent of — an EPUB has no page to outline).
 */
type SearchPaintOutcome = 'cleared' | 'pending' | 'painted' | 'refused';

/** What the host last ASKED for, as opposed to what is painted.
 *
 * Kept because a match usually cannot be painted at the moment it arrives: the host sends
 * `paintSearchMatch` right after `goTo`, and the chapter it addresses is still loading. Rather than
 * file an annotation into a document nobody has checked (see `applySearchMatch`), the paint is
 * deferred and retried when a chapter document lands. */
let pendingSearchMatch: EpubSearchMatch | null = null;

/** What the host was last told about `pendingSearchMatch`, so a deferred retry does not re-say it.
 * Reset when a new payload arrives. */
let reportedSearchPainted: boolean | null = null;

/**
 * Whether a match is still waiting for the navigation it arrived with to finish.
 *
 * >>> "PENDING FOREVER" AND "BROKEN" LOOK IDENTICAL, AND THAT COST A DEVICE SESSION. <<< `pending` is
 * the right answer while a chapter is loading, and the wrong one once the reader has landed — but
 * the first `paintSearchMatch` cannot tell those apart, so it stays silent for both. It stayed
 * silent for a comparison that could never match (see `cfiSpinePos`), and the feature simply did
 * nothing, with no notice and no error, for as long as it took to open a simulator.
 *
 * Set when a match arrives, cleared on the FIRST `relocated` after it — by then `goTo` has settled,
 * so "still cannot find its chapter" is a real failure rather than a race. First-relocated ONLY:
 * that event fires on every page turn, and a reader who simply turns away from the match's chapter
 * must not be told anything.
 */
let awaitingSearchLanding = false;

/** Search's channel (HIGHLIGHT_LAYERS.md §3): an OUTLINE, with no fill at all, so a match sitting
 * inside a user highlight is findable without hiding it. `fill: 'none'` is load-bearing, not a
 * default — epub.js merges its own `fill: yellow, fill-opacity: 0.3` UNDER whatever is passed, so
 * omitting it paints a yellow box and loses the whole point of the channel.
 *
 * SVG PRESENTATION ATTRIBUTES, not CSS declarations — marks-pane applies these with
 * `setAttribute`, so a camelCased property name is silently ignored. `stroke-width`, not
 * `strokeWidth`. A function rather than a constant for the same reason `ttsSpokenStyles` is: the
 * stroke is derived from the page colour. */
function searchMatchStyles(): Record<string, string> {
  return {
    fill: 'none',
    stroke: matchStroke(currentAppearance?.bg),
    'stroke-width': '2',
    'stroke-opacity': '0.9',
    // >>> NAMED EXPLICITLY BECAUSE epub.js MERGES ITS OWN UNDERNEATH US. <<< `IframeView.highlight`
    // does `Object.assign({fill:'yellow','fill-opacity':'0.3','mix-blend-mode':'multiply'}, styles)`,
    // so any key this function omits keeps epub.js's default. Omitting this one left `multiply` on
    // the `<g>` every rect inherits from — and multiply against a near-black page returns the page
    // colour, so on the dark theme the outline was drawn and then composited out of existence. It is
    // the same trap `highlightFill`'s `screen` branch exists to dodge for the FILL channels; an
    // outline has nothing to blend with the glyphs beneath it, so it wants no blending at all.
    'mix-blend-mode': 'normal',
  };
}

/**
 * The user highlights currently painted: id -> the range CFI it was painted at.
 *
 * THE MAP IS WHAT MAKES TAP-TO-DELETE AND UN-PAINTING WORK, and it is why the seam being stateless
 * is not a gap. `paintHighlights` receives the whole authoritative set every time, diffs it against
 * these keys, and paints/un-paints the difference (see highlightPaint.ts's `diffHighlights`). The
 * range is stored because `highlightRemove` needs it — the id alone cannot address epub.js's
 * annotation map.
 */
const paintedUserHighlights = new Map<string, string>();

/**
 * The last payload `paintHighlights` was given, kept for ONE reason: a flow change destroys the
 * rendition, and a new `Rendition` means a brand new `Annotations` store with nothing in it. The
 * spoken range is re-painted from `currentSpokenCfi` for the same reason; this is the user layer's
 * equivalent. Not state the host has to re-send — it already sent it once, and asking for it again
 * would make a local re-layout into a round trip.
 */
let lastUserHighlights: EpubHighlightPaint[] = [];

/** What epub.js's `selected` event last reported. `requestCurrentSelection` forces a fresh
 * `triggerSelectedEvent` before reading this, so it's always current at read time. */
let lastSelection: ReaderSelection | null = null;

function currentTypography(): TypographyInput | undefined {
  if (!currentAppearance) return undefined;
  return {
    fontSizePt: currentAppearance.fontSizePt,
    lineHeight: currentAppearance.lineHeight,
    marginPx: currentAppearance.marginPx,
  };
}

function currentFlow(): ReaderFlow {
  return currentAppearance?.flow ?? READER_FLOW;
}

function appearanceCssOptions(): AppearanceCssOptions {
  if (!currentAppearance) return {};
  const fontFamily = sanitizeFontFamily(currentAppearance.fontFamily);
  const fontFaceDataUri = sanitizeFontDataUri(currentAppearance.customFontUri);
  return {
    fg: currentAppearance.fg,
    bg: currentAppearance.bg,
    link: currentAppearance.link,
    fontFamily,
    letterSpacingPx: currentAppearance.letterSpacingPx,
    // Only meaningful alongside a non-empty fontFamily — baselineCss's @font-face declares itself
    // under that exact name, so a URI with nothing to attach it to is dropped rather than passed.
    ...(fontFamily && fontFaceDataUri ? { fontFaceDataUri } : {}),
  };
}

/** `'single'`/`'double'` -> epub.js's own vocabulary. `'double'` is inert under epub.js's
 * `minSpreadWidth` (800) on phone widths — expected, not a bug to chase. */
function mapSpread(spread: ReaderAppearance['spread']): 'none' | 'auto' {
  return spread === 'double' ? 'auto' : 'none';
}

/**
 * `flow` -> epub.js's MANAGER, which is a separate setting from flow and is NOT what `flow` alone
 * controls.
 *
 * >>> WHY THIS EXISTS: epub.js's DEFAULT manager's 'scrolled' flow only scrolls WITHIN whichever
 * ONE section is currently displayed — moving to the next chapter is still a discrete display()
 * call, exactly like paginated mode, just without page breaks inside that one section. A short
 * section (a cover, a title page) has nothing to scroll within, so continuous scroll looked
 * completely inert on one. True cross-chapter continuous scroll is a DIFFERENT manager
 * (`ContinuousViewManager`), which keeps several sections mounted and virtualises rendering as the
 * user scrolls past them — this is what 'continuous' selects here. <<<
 */
function mapManager(flow: ReaderFlow): 'default' | 'continuous' {
  return flow === 'paginated' ? 'default' : 'continuous';
}

/**
 * Insert our baseline sheet into one chapter document.
 *
 * >>> WHY THE CAST. epub.js's SHIPPED TYPE FOR THIS METHOD IS WRONG. <<<
 * `contents.d.ts:33` declares `addStylesheetCss(css, key): Promise<boolean>`, but the implementation
 * returns a plain boolean synchronously (`contents.js:769-775` — it sets `styleEl.innerHTML` and
 * returns true). Trusting the declaration makes type-aware ESLint demand a `void` on a value that is
 * not a promise, which would document the opposite of what the code does.
 *
 * Found BY the typechecked-WebView conversion: while this logic lived in an untypechecked .html it
 * was correct and unverifiable, and nothing would have told us the declaration disagreed. Narrowed
 * here, once, rather than at both call sites.
 *
 * The cast is on the OBJECT, not the method, on purpose: `addStylesheetCss` reads `this.document`, so
 * pulling the function out to re-type it would unbind `this` and silently no-op.
 */
type AddStylesheetCss = (serializedCss: string, key: string) => boolean;

function insertStylesheet(contents: Contents, css: string): void {
  (contents as unknown as { addStylesheetCss: AddStylesheetCss }).addStylesheetCss(
    css,
    STYLESHEET_KEY,
  );
}

function epubFactory(): EPubFactory | null {
  const candidate = window.ePub;
  return typeof candidate === 'function' ? (candidate as EPubFactory) : null;
}

function viewportSize(): { width: number; height: number } {
  const viewer = document.getElementById('viewer');
  return {
    // Fallbacks matter only if #viewer is somehow unmeasurable; a zero would quantise the column to
    // a single line and look like a broken book.
    width: viewer?.clientWidth || 393,
    height: viewer?.clientHeight || 480,
  };
}

/**
 * Rebuild the stylesheet for the current viewport and push it into every chapter already loaded.
 *
 * Called once before the first display() and again on every rendition resize — rotation changes both
 * the type size and the line-grid remainder, so a sheet built for portrait leaves sliced lines in
 * landscape.
 *
 * This cannot loop: it changes content size, which epub.js answers with a contents resize and a
 * re-format, and neither of those emits the rendition `resized` that got us here (that one comes
 * from the window).
 */
function applyBaselineCss(): void {
  const size = viewportSize();
  currentCss = baselineCss(
    readerMetrics(size.width, size.height, currentTypography(), currentFlow()),
    appearanceCssOptions(),
    currentFlow(),
  );

  if (!rendition) return;

  for (const contents of rendition.getContents() as unknown as Contents[]) {
    insertStylesheet(contents, finalCssFor(contents.document));
  }
}

/**
 * Cap on how many elements we will ask for a computed style. A book that exceeds this gets its later
 * breaks ignored rather than a frozen reader; nothing in the test fixture comes close (its largest
 * chapter is ~2k elements) and no book in the wild should.
 */
const MAX_BREAK_CANDIDATES = 4000;
const BREAK_CANDIDATE_SELECTOR =
  'h1,h2,h3,h4,h5,h6,section,article,div,p,hr,figure,table,blockquote,aside,ol,ul,dl';

/**
 * Honour the book's OWN page breaks in a paginated column layout.
 *
 * When an EPUB says an element starts a new page, it says so as `page-break-before: always` — which
 * is a PAGE-context property, and our pages are CSS columns, so it is not guaranteed to fragment
 * anything. This reads the book's computed value and restates it as the column-context equivalent,
 * which WebKit does act on.
 *
 * Reading the COMPUTED value rather than matching selectors is the whole trick: Calibre-converted
 * books declare these on generated classes, so there is no selector worth guessing. It also means we
 * honour exactly what the book asked for and invent nothing.
 */
function applyAuthoredBreaks(doc: Document | null | undefined): number {
  if (!doc?.body || !doc.defaultView) return 0;

  const win = doc.defaultView;
  const nodes = doc.body.querySelectorAll(BREAK_CANDIDATE_SELECTOR);
  const limit = Math.min(nodes.length, MAX_BREAK_CANDIDATES);
  let applied = 0;

  for (let i = 0; i < limit; i++) {
    const el = nodes[i] as HTMLElement;
    const computed = win.getComputedStyle(el);

    if (isForcedBreak(computed.breakBefore) || isForcedBreak(computed.pageBreakBefore)) {
      el.style.setProperty('-webkit-column-break-before', 'always', 'important');
      applied++;
    }

    if (isForcedBreak(computed.breakAfter) || isForcedBreak(computed.pageBreakAfter)) {
      el.style.setProperty('-webkit-column-break-after', 'always', 'important');
      applied++;
    }
  }

  return applied;
}

/**
 * Cap an authored margin-left/margin-right that exceeds `MAX_INDENT_FRACTION` of the viewport, on
 * any of the same block-level containers `applyAuthoredBreaks` already walks.
 *
 * FLOW-AGNOSTIC, unlike the break walk and the column override: this is about horizontal width,
 * which is scarce in both paginated and scrolled-doc flow, so it runs regardless of `isPaginated()`.
 *
 * Reading the COMPUTED value rather than matching classes, for the same reason `applyAuthoredBreaks`
 * does: these values arrive on Calibre-generated classes, so there is no selector worth guessing.
 */
function capExcessiveIndents(doc: Document | null | undefined, viewportWidthPx: number): void {
  if (!doc?.body || !doc.defaultView) return;

  const win = doc.defaultView;
  const nodes = doc.body.querySelectorAll(BREAK_CANDIDATE_SELECTOR);
  const limit = Math.min(nodes.length, MAX_BREAK_CANDIDATES);

  for (let i = 0; i < limit; i++) {
    const el = nodes[i] as HTMLElement;
    const computed = win.getComputedStyle(el);

    const marginLeft = Number.parseFloat(computed.marginLeft);
    if (isExcessiveIndent(marginLeft, viewportWidthPx)) {
      el.style.setProperty('margin-left', `${cappedIndent(viewportWidthPx)}px`, 'important');
    }

    const marginRight = Number.parseFloat(computed.marginRight);
    if (isExcessiveIndent(marginRight, viewportWidthPx)) {
      el.style.setProperty('margin-right', `${cappedIndent(viewportWidthPx)}px`, 'important');
    }
  }
}

/**
 * Does this chapter author its own multi-column CSS (e.g. `column-count: 2`), on the body or on
 * any of the same block-level containers `applyAuthoredBreaks` already walks?
 *
 * Reads the COMPUTED value, not a selector match, for the reason `applyAuthoredBreaks` gives:
 * Calibre-converted books put such rules on generated classes, so there is no selector worth
 * guessing, and the computed value is what actually reaches WebKit's layout regardless of where
 * the declaration came from.
 */
function hasAuthoredColumns(doc: Document | null | undefined): boolean {
  if (!doc?.body || !doc.defaultView) return false;

  const win = doc.defaultView;
  if (isMultiColumnCount(win.getComputedStyle(doc.body).columnCount)) return true;

  const nodes = doc.body.querySelectorAll(BREAK_CANDIDATE_SELECTOR);
  const limit = Math.min(nodes.length, MAX_BREAK_CANDIDATES);

  for (let i = 0; i < limit; i++) {
    if (isMultiColumnCount(win.getComputedStyle(nodes[i] as HTMLElement).columnCount)) return true;
  }

  return false;
}

/**
 * The stylesheet for ONE chapter document: the shared baseline, plus the column override IF this
 * chapter needs it.
 *
 * Detection runs against the chapter's own document each time, rather than once per book, because
 * a book's chapters are not guaranteed to share a stylesheet — a front-matter page can be plain
 * while a glossary a few spine items later authors two columns. Cheap to re-check: bounded by the
 * same MAX_BREAK_CANDIDATES cap as the break walk, and only reachable in paginated flow, where a
 * nested column context is possible at all.
 */
function finalCssFor(doc: Document | null | undefined): string {
  return isPaginated(currentFlow()) && hasAuthoredColumns(doc)
    ? `${currentCss}\n${columnOverrideCss()}`
    : currentCss;
}

// --- gestures ---------------------------------------------------------------------------------
//
// >>> BOTH READING GESTURES ARE RECOGNISED HERE, IN THE DOCUMENT, AND THAT IS THE POINT. <<<
// Page turns used to be an RN `PanResponder` on an overlay above the WebView, which meant the
// document never saw a `touchstart` while it was mounted — so text could not be selected, and
// highlighting needed a mode switch to take the touches back. Recognising both on this side lets
// them be told apart by SHAPE, which is what the reader already expects: hold still and the text
// selects, drag sideways and the page turns. See touchGesture.ts for the arithmetic and the fuller
// account of why the overlay had to go.

/** Where the finger went down for the gesture in progress, in the CHAPTER document's coordinates,
 * or null between gestures. Deltas are all the swipe test needs, so the iframe's own offset cancels
 * and never has to be applied here — unlike an anchor, which is a position and does. */
let touchOrigin: TouchPoint | null = null;

/** The pending long-press timer, or 0. One at a time: a second finger down restarts the gesture. */
let longPressTimer = 0;

/** Whether the current gesture has already become a long press. A press that has fired must not
 * also turn the page on lift — the reader is selecting, and the drift of a selection handle can
 * easily clear the swipe threshold. */
let longPressFired = false;

/**
 * The painted highlight under the finger, or null — hit-tested at `touchstart` via
 * `highlightIdAtPoint`, not marks-pane's own touch proxy (unreliable here; see that function).
 *
 * THE FALLBACK SIGNAL, NOT THE ANSWER. It records where the finger LANDED, which equals what the
 * reader selected only for a press that neither moved nor was adjusted — see `activeHighlightId`,
 * which asks the selection first and reaches for this only when there is no selection to ask.
 */
let pressedHighlightId: string | null = null;

/**
 * Every painted user highlight's rects in `contents.document`'s own client coordinates — the same
 * space `touch.clientX/clientY` are in, and the same rects marks-pane paints.
 *
 * CACHED PER LAYOUT, because building it is not cheap: resolving a CFI to a `Range` walks the
 * chapter's tree, and `touchstart` fires for every touch including each one of a page-turn swipe.
 * Doing that work N-highlights-deep inside the touch handler is what made a well-highlighted book
 * feel worse than the PDF shell, whose hit test is arithmetic over an array measured once.
 *
 * Invalidated wherever the geometry can move — a relocate, a resize, a re-styled chapter, a repaint
 * — by `invalidateHighlightBoxes()`. A stale box is a press that deletes the wrong highlight, so
 * when in doubt, drop it: rebuilding costs one tree walk, being wrong costs the reader their note.
 */
let highlightBoxCache: { doc: Document; boxes: HighlightBox[] } | null = null;

function invalidateHighlightBoxes(): void {
  highlightBoxCache = null;
}

function highlightBoxes(contents: Contents): HighlightBox[] {
  const cached = highlightBoxCache;
  if (cached && cached.doc === contents.document) return cached.boxes;

  const boxes: HighlightBox[] = [];
  for (const [id, cfiRange] of paintedUserHighlights) {
    // >>> SCOPE TO THIS CHAPTER FIRST. RESOLVING A FOREIGN CFI DOES NOT FAIL — IT LIES. <<<
    // This loop used to rely on `rangeForCfi` returning null for a highlight in another spine
    // document. It does not: `EpubCFI.toRange` walks only the local path after `!` and never looks
    // at the spine component, so a chapter-2 CFI resolves against chapter 1 to whatever happens to
    // sit at the same tree position. Measured on the sample book — 399 of 400 foreign CFIs resolved
    // to a real range, several to different text than they name.
    //
    // The consequence was not cosmetic: these boxes are what a long press is hit-tested against, so
    // a press in chapter 1 could land on a phantom box belonging to a chapter-2 highlight and
    // `confirmDeleteHighlight` would delete THAT one — the wrong highlight, silently, with no undo.
    // Painting was never affected (epub.js checks `sectionIndex === view.index` itself), which is
    // why nothing on screen ever hinted at it — and comparing the same way it does is what this now
    // is. A base-string comparison worked here only by luck: these CFIs are minted by epub.js, so
    // they happened to spell the base the way it does. The search layer's are not, and did not.
    if (cfiSpinePos(cfiRange) !== contents.sectionIndex) continue;

    const range = rangeForCfi(contents, cfiRange);
    if (!range) continue;
    // One rect per line the highlight covers, exactly as marks-pane draws it — so a highlight that
    // wraps is hit anywhere the reader can see it, and nowhere in the empty tail of its last line.
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      boxes.push({ id, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
  }

  highlightBoxCache = { doc: contents.document, boxes };
  return boxes;
}

/** One painted highlight's CFI resolved against THIS chapter, or null.
 *
 * The catch is for a range that is genuinely unresolvable IN THIS DOCUMENT — an end offset past its
 * text node throws `IndexSizeError` out of `EpubCFI.toRange`, which `fixMiss` does not recover.
 *
 * IT IS NOT A CHAPTER FILTER, though it was once documented as one. A CFI from another spine
 * document resolves here rather than failing; callers must scope with `cfiSpinePos` first, and
 * `highlightBoxes` above says what that cost. */
function rangeForCfi(contents: Contents, cfiRange: string): Range | null {
  try {
    return contents.range(cfiRange) ?? null;
  } catch {
    return null;
  }
}

/**
 * Which painted user highlight covers point `(x, y)` in `contents.document`'s own coordinates.
 *
 * GEOMETRY, NOT A TEXT POSITION, and that is a correctness change rather than a tidy-up. This used
 * to convert the touch with `caretRangeFromPoint` and ask `Range.isPointInRange` — but a caret
 * SNAPS to the nearest text position, so a press in a line's trailing whitespace claimed a
 * highlight that was not under the finger, and a press inside a highlighted word whose caret
 * snapped to the neighbouring character missed one that was. `caretRangeFromPoint` can also hand
 * back an ELEMENT container, where `isPointInRange` degrades to a tree-order comparison that has
 * nothing to do with where the reader touched. The PDF shell has always tested boxes; this is the
 * same test, through the same pure `highlightAt`.
 */
function highlightIdAtPoint(contents: Contents, x: number, y: number): string | null {
  return highlightAt(highlightBoxes(contents), x, y);
}

/**
 * Which painted user highlight the given SELECTION overlaps, or null.
 *
 * >>> A SELECTION IS A RANGE, SO A POINT TEST ANSWERS THE WRONG QUESTION. <<< `pressedHighlightId`
 * records where the finger first landed, which is only the same thing as "what did the reader
 * select" when the press neither moved nor was adjusted. Drag a selection from plain text INTO a
 * highlight, or release a handle just outside one, and the point test says "no highlight" — so the
 * menu offered "Highlight", and taking it painted a second annotation over the first. Two ids on
 * the identical range then collide in epub.js's own map (highlightSeam.ts's header), which is what
 * made the duplicate both visibly darker and only half-deletable.
 *
 * Overlap, not containment: touching a highlight at all is enough, per the agreed rule that any
 * selection meeting an existing highlight offers delete and refuses create.
 */
function highlightIdForRange(contents: Contents, selected: Range): string | null {
  for (const [id, cfiRange] of paintedUserHighlights) {
    const range = rangeForCfi(contents, cfiRange);
    if (!range) continue;
    try {
      if (rangesOverlap(selected, range)) return id;
    } catch {
      // Ranges in different documents throw rather than compare — a highlight from another chapter.
      continue;
    }
  }
  return null;
}

/** The live selection in whichever rendered chapter has one, with that chapter's `Contents`. */
function currentSelectionRange(): { contents: Contents; range: Range } | null {
  if (!rendition) return null;
  for (const contents of rendition.getContents() as unknown as Contents[]) {
    const selection = contents.document.defaultView?.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      return { contents, range: selection.getRangeAt(0) };
    }
  }
  return null;
}

/** Which highlight the reader's current gesture is acting on: what the selection overlaps, else
 * what the finger landed on. The selection wins because it is the later, more deliberate signal —
 * `pressedHighlightId` is only the fallback for a press that has not selected anything yet. */
function activeHighlightId(): string | null {
  const selected = currentSelectionRange();
  if (selected) {
    const overlapped = highlightIdForRange(selected.contents, selected.range);
    if (overlapped !== null) return overlapped;
  }
  return pressedHighlightId;
}

function cancelLongPress(): void {
  if (longPressTimer) window.clearTimeout(longPressTimer);
  longPressTimer = 0;
}

/**
 * The long press fired. Only sets the flag `touchend` reads to tell a swipe-release from a
 * press-release — see its own note there. Creating and deleting highlights are both native-menu-
 * driven now (`requestCurrentSelection`, `confirmDeleteHighlight`), decided when a menu item is
 * actually tapped rather than at this timer, so there is nothing else to do here any more.
 */
function onLongPress(): void {
  longPressFired = true;
}

/**
 * Wire one chapter document for touch.
 *
 * Registered from the content hook, so it lands on EVERY chapter — a book is many documents, and
 * listeners on the first one would stop working after the first chapter boundary, the same trap
 * `insertStylesheet` is called from here for.
 */
function watchTouches(contents: Contents): void {
  const doc = contents.document;
  const view = doc.defaultView;
  if (!view) return;

  doc.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      if (!touch) return;

      cancelLongPress();
      touchOrigin = { x: touch.clientX, y: touch.clientY };
      longPressFired = false;

      pressedHighlightId = highlightIdAtPoint(contents, touch.clientX, touch.clientY);
      // Reset only here, never on touchend/touchcancel — see readerBridge.ts's
      // `highlightTouchActive` note (clearing on touchend crashed the app).
      post({ type: 'highlightTouchActive', active: pressedHighlightId !== null });
      longPressTimer = window.setTimeout(onLongPress, LONG_PRESS_MS);
    },
    { passive: true },
  );

  doc.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (!touch || !touchOrigin) return;
      if (movedBeyondSlop(touchOrigin, { x: touch.clientX, y: touch.clientY })) cancelLongPress();
    },
    { passive: true },
  );

  doc.addEventListener(
    'touchend',
    (event) => {
      cancelLongPress();
      const origin = touchOrigin;
      touchOrigin = null;

      const touch = event.changedTouches[0];
      if (!origin || !touch || longPressFired) return;
      // A drag that ends with text selected is a selection being extended, not a page turn — the
      // reader is dragging a handle, and those travel a long way horizontally.
      if (!view.getSelection()?.isCollapsed) return;
      // Discrete pages only. In scrolled flow the reader scrolls, and there is no page to turn.
      if (!isPaginated(currentFlow())) return;

      const direction = swipeDirection(origin, { x: touch.clientX, y: touch.clientY });
      if (direction === null || !rendition) return;

      const turn = direction === 'next' ? rendition.next() : rendition.prev();
      turn.catch((error: unknown) => {
        fail('NAVIGATION_FAILED', error);
      });
    },
    { passive: true },
  );

  doc.addEventListener(
    'touchcancel',
    () => {
      cancelLongPress();
      touchOrigin = null;
    },
    { passive: true },
  );
}

/**
 * Apply one authoritative highlight set to the current rendition.
 *
 * REMOVALS FIRST, THEN ADDITIONS, and the order matters for exactly one case: a highlight deleted
 * and a highlight created at the same range in the same round trip (delete a highlight, immediately
 * re-highlight the same words). epub.js keys its annotation map on the range, so adding before
 * removing would file the new one and then have the removal delete it.
 *
 * An id already painted is left completely alone rather than re-painted — that is what makes a
 * repaint after every add/remove cost one annotation instead of all of them, and it is also why
 * `diffHighlights` compares ids only (highlights are create-and-delete-only; see its own note).
 *
 * >>> RETURNS WHETHER IT ADDED ANYTHING, AND DOES NOT TOUCH THE SEARCH LAYER ITSELF. <<< A new user
 * rect is appended AFTER the search outline, so the outline has to be lifted back on top (§4's
 * z-order) — but by the CALLER, at the end of its own batch. This function used to lift for itself,
 * which meant the two callers that also lift afterwards (`repaintLiveAnnotations` and the flow
 * rebuild's `repaintUserHighlights`) detached and re-attached the outline twice for one refresh.
 * Harmless, since a lift is remove-then-add and ends in the same state either way — but it made a
 * "sync the user layer" function quietly mutate a different owner's, which is the sort of reach a
 * later edit gets wrong. One lift per batch, owned by whoever knows where the batch ends.
 */
function applyUserHighlights(highlights: EpubHighlightPaint[]): boolean {
  if (!rendition) return false;
  const active = rendition;

  const { added, removedIds } = diffHighlights(new Set(paintedUserHighlights.keys()), highlights);

  if (removedIds.length > 0 || added.length > 0) invalidateHighlightBoxes();

  for (const id of removedIds) {
    const cfiRange = paintedUserHighlights.get(id);
    if (cfiRange !== undefined) highlightRemove(active, USER_OWNER, cfiRange);
    paintedUserHighlights.delete(id);
  }

  for (const highlight of added) {
    // Null only when the two ends live in DIFFERENT spine documents, which `highlightStore` cannot
    // currently produce: epub.js mints a selection from ONE contents document (`triggerSelectedEvent`
    // builds a single range CFI), so both stored locators always share a base. Skipped rather than
    // reported because there is no shape of stored data that reaches here — a corrupt or
    // mixed-format row is already set aside host-side by `toPaintable`, and surfaced to the reader
    // as `loadReaderHighlights`'s `skippedIds`.
    const cfiRange = joinCfiRange(highlight.startCfi, highlight.endCfi);
    if (cfiRange === null) continue;

    // >>> THE SAME COLLISION FROM THE OTHER SIDE: THE TRANSIENT LAYER GIVES WAY. <<< The search
    // outline refuses a range the user layer already owns; here the user layer is arriving at a
    // range the outline owns (highlight the word you just searched for). Painting over it would
    // displace the outline's map entry, and the outline's next `remove` would then detach THIS
    // annotation and orphan its rect — the reader's saved work lost to a layer that disappears on
    // the next arrow press. So un-paint the outline first — whichever caller lifts at the end of
    // this batch then has nothing to re-add, and the host is told the match is no longer marked.
    if (currentSearchRange === cfiRange) {
      highlightRemove(active, SEARCH_OWNER, currentSearchRange);
      currentSearchRange = null;
      reportSearchPaint('refused');
    }

    // TWO IDS ON ONE RANGE COLLIDE INSIDE epub.js, so refuse the second rather than paint it.
    // `Annotations` hashes on `encodeURI(cfiRange + type)` (highlightSeam.ts's header), and its
    // `add` overwrites that entry WITHOUT detaching the mark already attached — so the loser stays
    // painted forever, composites darker under the winner, and `remove` can only ever detach one of
    // them. Reported rather than dropped: `highlightIdForRange` now refuses to create a highlight
    // over one that exists, so reaching here means the host and this shell disagree about what is
    // painted, which is worth hearing about even though it should be unreachable.
    const collidingId = [...paintedUserHighlights].find(([, painted]) => painted === cfiRange)?.[0];
    if (collidingId !== undefined) {
      fail(
        'NAVIGATION_FAILED',
        `paintHighlights: ${highlight.id} and ${collidingId} address the same range`,
      );
      continue;
    }

    // No onTap: press-to-delete hit-tests directly now (`highlightIdAtPoint`), not marks-pane's own
    // touch wiring.
    highlightAdd(
      active,
      USER_OWNER,
      cfiRange,
      USER_SAVED_VARIANT,
      userHighlightStyles(highlight.color),
    );
    paintedUserHighlights.set(highlight.id, cfiRange);
  }

  return added.length > 0;
}

/**
 * Whether `cfiRange` is already some OTHER layer's live key.
 *
 * >>> THE INVARIANT THIS BUYS: NO TWO LIVE KEYS ARE EVER EQUAL. <<< epub.js hashes its annotation
 * map on `encodeURI(cfiRange + type)` and every owner here passes the same `type`
 * (`highlightSeam.ts`'s header), so the key is effectively the range string alone. Two layers holding
 * one key is what makes a `remove` ambiguous — it takes whichever was filed last, which may be
 * someone else's paint. Ordering cannot fix that; only refusing to create the second key can. So the
 * word layer checks HERE, at add time, and every `remove` below is unambiguous by construction.
 *
 * WHY THE WORD LAYER IS THE ONE THAT GIVES WAY. Same asymmetry `applySearchMatch` already acts on
 * (HIGHLIGHT_LAYERS.md §1): this layer is transient and moves every few hundred milliseconds, while
 * `user` is the reader's saved work. Nothing is lost visually — whatever kept the range is already
 * marking that exact spot.
 *
 * `resolveSpokenWordCfi` bails on the word-equals-SENTENCE case itself, but it compares against the
 * cfi it was HANDED rather than against what is painted, so the sentence is checked again here.
 */
function spokenWordCollides(cfiRange: string): boolean {
  if (cfiRange === currentSpokenCfi) return true;
  if (cfiRange === currentSearchRange) return true;
  for (const painted of paintedUserHighlights.values()) {
    if (painted === cfiRange) return true;
  }
  return false;
}

/**
 * Un-paint the word wash and forget it.
 *
 * >>> THE REMOVE IS DEFENSIVE, AND THAT IS THE HALF THAT PROTECTS THE READER'S OWN HIGHLIGHTS. <<<
 * The range was collision-free when it was painted; the only way it stops being so is a `user` or
 * `search` `add` landing on that exact range afterwards. When that happens the interloper's `add` has
 * already displaced this layer's map entry WITHOUT detaching its mark, so a blind
 * `remove(thisRange)` would delete THEIR annotation and orphan OUR rect — losing a saved highlight
 * to un-paint a word.
 *
 * So a collision means: leave it. The cost is one orphaned word-sized wash under the new highlight
 * until that chapter is re-rendered (a repaint cannot reach a mark whose map entry is gone). That is
 * bounded and silent-but-harmless; deleting the reader's highlight is neither. The stricter fix — a
 * pre-clear in `paintHighlights`, before the colliding add lands — was considered and declined: it
 * puts word-layer logic in a batch path that runs on every change to the user's highlight set, to
 * turn a harmless artefact into no artefact.
 */
function clearSpokenWord(): void {
  if (currentSpokenWordCfi === null) return;
  if (rendition && !spokenWordCollides(currentSpokenWordCfi)) {
    highlightRemove(rendition, TTS_OWNER, currentSpokenWordCfi);
  }
  currentSpokenWordCfi = null;
}

/**
 * Re-paint the word wash on top of whatever was just painted beneath it.
 *
 * Z-ORDER IS DOM ORDER in marks-pane, so the word has to be added AFTER its sentence or the sentence
 * wash sits over its own refinement. Every caller below adds the sentence first and then calls this.
 * `add` after `remove` is also the re-measure (a fresh `Range` per `addMark`), which is why this is
 * the retint path as well as the repaint path — same reasoning as `liftSearchMatch`.
 *
 * `remove` first for the reason `repaintLiveAnnotations` documents at length: a bare re-add leaves
 * the old-coloured mark attached underneath. `live: false` is the rebuilt-rendition case — a new
 * `Rendition` is a new empty `Annotations` store, so there is nothing to detach and a remove would
 * be aimed at an object that no longer exists.
 */
function repaintSpokenWord(options: { live?: boolean } = {}): void {
  if (!rendition || currentSpokenWordCfi === null) return;
  if (options.live !== false) highlightRemove(rendition, TTS_OWNER, currentSpokenWordCfi);
  highlightAdd(
    rendition,
    TTS_OWNER,
    currentSpokenWordCfi,
    TTS_SPOKEN_WORD_VARIANT,
    ttsSpokenWordStyles(),
  );
}

/**
 * Re-paint every annotation this shell owns against a LIVE rendition — re-measuring its geometry and
 * re-deriving its colour in one pass.
 *
 * >>> IT IS THE RE-MEASURE, NOT JUST THE RE-TINT, AND THAT IS WHY IT IS NOT GATED ON `bg`. <<<
 * A painted highlight is SVG rects that marks-pane measured once, from a `Range` it captured at
 * attach time. It re-measures only when `pane.render()` runs, and epub.js runs that from exactly one
 * place — `View.reframe()`, behind two gates a stylesheet change slips past (see
 * `epubViewGeometry.ts`, which documents both). So after a text-size, font, spacing, margin or
 * spread change the rects keep the coordinates they were given for the old layout and the highlight
 * visibly detaches from its words.
 *
 * Remove-then-add is what repairs that, and it repairs it for free rather than as a second
 * mechanism: `Annotations.add` -> `IframeView.highlight` resolves the CFI to a FRESH `Range` and
 * marks-pane measures it on `addMark`. So the call that re-derives the theme shade is already the
 * call that re-measures, and one path serves both.
 *
 * >>> NOT `repaintUserHighlights()`, AND THE DIFFERENCE IS NOT COSMETIC. <<< That one clears the
 * map first, which leaves `diffHighlights` with nothing in `removedIds` — correct only when the old
 * `Rendition` was destroyed and took its `Annotations` with it. Here the rendition is alive, and
 * epub.js's `Annotations.add` overwrites its map entry WITHOUT detaching the mark already attached,
 * while also pushing a duplicate hash into `_annotationsBySectionIndex`. So a bare re-add would
 * leave the old-coloured rect painted under the new one and attach it twice more on the next
 * `hooks.render`. Remove first, then add.
 *
 * The spoken range rides along: `ttsSpokenStyles()` is theme-derived for the same reason, and it is
 * removed and re-added through the same seam so it keeps its place above the user layer.
 */
function repaintLiveAnnotations(): void {
  if (!rendition) return;
  const active = rendition;

  for (const cfiRange of paintedUserHighlights.values()) {
    highlightRemove(active, USER_OWNER, cfiRange);
  }
  paintedUserHighlights.clear();
  applyUserHighlights(lastUserHighlights);

  // UNCONDITIONAL, and the return value above is deliberately ignored here. Every user rect was just
  // re-added, so the outline needs putting back on top — but it also needs re-deriving even in a
  // book with no user highlights at all, because `matchStroke` is a function of the page colour and
  // the re-add is what re-measures the range. Both reasons hold independently of what the diff did.
  liftSearchMatch();

  if (currentSpokenCfi !== null) {
    highlightRemove(active, TTS_OWNER, currentSpokenCfi);
    highlightAdd(active, TTS_OWNER, currentSpokenCfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
  }
  // AFTER the sentence, always — it is a wash on top of that wash, and re-adding the sentence
  // without re-adding this would leave the word underneath it. Both halves of this function's job
  // apply to it too: `spokenWordOpacity` is derived from the blend, which is derived from the page
  // colour, and the re-add is what re-measures the rects a text-size change invalidated.
  repaintSpokenWord();
}

/** The pending geometry-refresh frame, or 0. */
let geometryRaf = 0;

/** Whether the coalesced refresh should also put the reader back where they were. OR-ed across every
 * request in one frame, so a re-anchoring appearance change is never demoted by a plain contents
 * resize arriving alongside it. */
let geometryReanchor = false;

/**
 * Re-measure everything after the chapter has been re-laid-out.
 *
 * >>> THE EPUB COUNTERPART OF `renderPageSurface` -> `paintPage`. <<< The PDF shell states the
 * invariant outright: every path that re-rasterises a page rebuilds its text layer and repaints it,
 * which is why a PDF highlight tracks through any zoom. This is the same invariant for this shell —
 * every path that re-lays out a chapter re-measures every painted mark — and it has to be explicit
 * here for the reason `epubViewGeometry.ts` documents at length: epub.js will not do it for us when
 * only the stylesheet changed.
 *
 * COALESCED ONTO ONE FRAME, exactly like `pdf.entry.ts`'s `scheduleVirtualize`. A font-size stepper
 * emits an `applyAppearance` per tap and a book's own late reflow (images, a web font) can emit
 * several contents resizes in a row; each one would otherwise detach and re-attach every annotation
 * in the chapter.
 *
 * ORDER IS LOAD-BEARING: the layout must be current BEFORE anything measures against it.
 *  1. `forceReflow` re-runs epub.js's own post-reflow pass, so the column strip's width — which its
 *     page count and every scroll offset derive from — stops describing the old type size.
 *  2. the reader is put back at `lastCfi` when asked, because a reflow leaves them parked at a pixel
 *     offset chosen for the old layout (see the re-anchor note below).
 *  3. `repaintLiveAnnotations` re-measures the user, search and TTS layers.
 *  4. the press hit-test cache is dropped, because it holds pre-reflow rects and a stale one deletes
 *     the wrong highlight.
 *
 * THIS CANNOT LOOP, which is what makes it safe to hang off a contents resize: the marks live in the
 * OUTER document (the view element), not the chapter iframe, so re-adding them cannot move anything
 * the chapter's own `ResizeObserver` is watching.
 */
function scheduleGeometryRefresh(options: { reanchor?: boolean } = {}): void {
  if (options.reanchor === true) geometryReanchor = true;
  if (geometryRaf !== 0) return;

  geometryRaf = window.requestAnimationFrame(() => {
    geometryRaf = 0;
    const reanchor = geometryReanchor;
    geometryReanchor = false;

    if (!rendition) return;
    const active = rendition;

    forceReflow(active);

    const finish = (): void => {
      repaintLiveAnnotations();
      invalidateHighlightBoxes();
    };

    // >>> RE-ANCHORING IS NOT COSMETIC EITHER. <<< A re-flow changes how much text fits on a page,
    // but the manager is still scrolled to the offset that showed the old page 5, so the reader is
    // silently moved to different words. Re-displaying at the last reported CFI is what keeps them
    // on the sentence they were reading, and it is the same anchor `rebuildForFlowIfNeeded` uses for
    // the same reason. Skipped while an open is in flight, because `openEpub` owns the rendition
    // until its first `display()` resolves.
    if (reanchor && lastCfi !== null && !openInFlight) {
      // Re-measured in BOTH settlements rather than only on success: `display()` re-renders the
      // view, so the marks epub.js re-injects are already fresh — but a rejected display leaves the
      // old view standing with the old rects, which is exactly the case that still needs repairing.
      active
        .display(lastCfi)
        .then(finish)
        .catch(() => {
          finish();
        });
      return;
    }

    finish();
  });
}

/**
 * Re-paint the whole user layer onto a freshly built rendition.
 *
 * Called only after a flow change rebuilds the rendition: a new `Rendition` owns a new `Annotations`
 * store, so everything previously painted is gone with the old one. Clearing the map first is what
 * turns the next `applyUserHighlights` into "add all of them" rather than "nothing changed" — the
 * ids are the same, so without it the diff would correctly conclude there is nothing to do, and the
 * user's highlights would silently disappear on a paginated <-> scrolled switch.
 *
 * ONLY FOR A RENDITION THAT WAS JUST REBUILT. Against a live one it leaks the marks it means to
 * replace — use `repaintLiveAnnotations()` there, and see its note for what epub.js does.
 *
 * DOES NOT LIFT THE SEARCH OUTLINE, and its one caller does it directly afterwards — see
 * `liftSearchMatch`'s note on one lift per batch. A second caller would have to do the same.
 */
function repaintUserHighlights(): void {
  paintedUserHighlights.clear();
  applyUserHighlights(lastUserHighlights);
}

/** The loaded chapter document a CFI addresses, or null if that chapter is not on screen.
 *
 * Matched on SPINE POSITION, not by trying to resolve the CFI and seeing whether it works — that
 * read is measurably wrong, and `cfiSpinePos`'s own note has the numbers. It is also not matched on
 * `contents.cfiBase`, which is the version of this that shipped and never matched anything: the
 * search index spells the base `/6/2[ch1]` and epub.js spells it `/6/2`. Same note.
 *
 * `sectionIndex === spinePos` is exactly what epub.js's `Annotations.add` compares before attaching,
 * which is why painting was always scoped correctly while this was not. */
function contentsForCfi(cfi: string): Contents | null {
  if (!rendition) return null;
  const spinePos = cfiSpinePos(cfi);
  if (spinePos === null) return null;

  for (const contents of rendition.getContents() as unknown as Contents[]) {
    if (contents.sectionIndex === spinePos) return contents;
  }
  return null;
}

/** A rect shape both `View.position()` and the manager's `bounds()` return — real `DOMRect`s from
 * `getBoundingClientRect()`, so `left`/`top`/`right`/`bottom` are already there with no width/height
 * arithmetic needed. */
interface EpubRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** epub.js's internal per-view manager surface this file reaches into — NOT in `epubjs`'s published
 * types (`Rendition.manager` has no public type at all; `rendition.js:68/165/229` sets it at
 * runtime). Both the paginated (`DefaultViewManager`) and scrolled-doc (`ContinuousViewManager`,
 * which extends it) managers share this shape, which is why nothing here branches on flow. */
interface EpubRenditionManager {
  views: { find(section: { index: number }): { position(): EpubRectLike } | undefined };
  bounds(): EpubRectLike;
}

function renditionManager(): EpubRenditionManager | null {
  if (!rendition) return null;
  return (rendition as unknown as { manager?: EpubRenditionManager }).manager ?? null;
}

/** Is any rect of `cfi`'s range inside the CURRENTLY SCROLLED/PAGED window, not just somewhere
 * inside its section's rendered content?
 *
 * >>> `contents.window.innerWidth`/`innerHeight` ARE NOT THE VIEWPORT. DO NOT GO BACK TO THEM. <<<
 * They look right and are wrong on the axis that actually matters. epub.js resizes each section's
 * `<iframe>` to its own full content size on whichever axis `IframeView.size()` leaves unlocked —
 * WIDTH in paginated flow (`expand()`'s horizontal branch sizes it to `contents.textWidth()`,
 * however many pages wide the whole chapter is), HEIGHT in scrolled-doc flow
 * (`contents.textHeight()`, the whole chapter's height). The OUTER, fixed-size stage container is
 * what actually clips and scrolls (`container.scrollLeft`/`scrollTop`, `DefaultViewManager.scrollTo`)
 * — so `contents.window`'s own inner dimensions report "how big is this chapter," not "how much of
 * it is on screen right now," on the one axis that would ever change with scroll position. A rect
 * check against them is true for almost the entire chapter regardless of scroll, in BOTH flows.
 *
 * The correct comparison — same one epub.js's own `isVisible()`/`paginatedLocation()`/
 * `scrolledLocation()` use internally (`managers/default/index.js`) — is the RANGE's rect, shifted
 * into the OUTER document's coordinate space by the view's own `position()` (== `element
 * .getBoundingClientRect()`, which DOES move with scroll, since the element sits inside the
 * scrolling container), compared against the manager's `bounds()` (the fixed stage viewport, also a
 * `getBoundingClientRect()`, in the same outer coordinate space already — no further translation
 * needed between the two).
 *
 * False for a different section — `contentsForCfi` returns null for one that is not currently
 * rendered. False for a range or view that fails to resolve. All three "false" paths mean the same
 * thing: cannot be shown to be visible, so treat it as not.
 */
function spokenRangeVisible(cfi: string): boolean {
  const contents = contentsForCfi(cfi);
  if (!contents) return false;
  const range = rangeForCfi(contents, cfi);
  if (!range) return false;
  const manager = renditionManager();
  if (!manager) return false;
  const view = manager.views.find({ index: contents.sectionIndex });
  if (!view) return false;

  const offset = view.position();
  const rects = Array.from(range.getClientRects(), (rect) => ({
    left: rect.left + offset.left,
    top: rect.top + offset.top,
    width: rect.width,
    height: rect.height,
  }));
  return anyRectOnScreen(rects, manager.bounds());
}

/** Bring `cfi` on screen if it is not already — a page turn in paginated flow, a scroll in
 * scrolled-doc (including the screen-reader-forced override, `readerA11yLayout.ts`), via the same
 * `rendition.display()` `goTo` uses. epub.js's manager resolves which of those two it is; there is
 * no separate branch here for flow.
 *
 * Called from BOTH `setSpokenRange` (coarse: a whole new sentence starting off-screen) and
 * `setSpokenWordRange` (precise: THIS word specifically has crossed off-screen, which is what makes
 * a page turn land on the first word of the next page rather than the first word of the next
 * sentence). Both share `lastAutoFollowedCfi` so a sentence-level call and the word-level calls that
 * follow it for the same still-off-screen target don't double up on `display()`.
 *
 * >>> ALSO SKIPS WHILE A PREVIOUS FOLLOW IS STILL IN FLIGHT, EVEN FOR A DIFFERENT CFI. <<< Word
 * ticks arrive roughly every 200-400ms of speech; a `display()` that has to render a freshly-loaded
 * section can take longer than that. Without this guard, a word crossing off-screen mid-transition
 * would read `spokenRangeVisible` against the STILL-OLD page (the new one has not painted yet), see
 * "not visible" again, and issue a SECOND, overlapping `display()` for a different target before the
 * first has settled — competing navigations is exactly the "fight" this feature exists to avoid,
 * just self-inflicted rather than against the reader's own gesture. Skipping here just means the
 * NEXT tick re-evaluates once the current transition's promise settles, so a slow chapter load
 * catches up incrementally rather than never, or twice.
 */
function followSpokenRange(cfi: string): void {
  if (!rendition) return;
  if (followDisplayInFlight) return;
  if (cfi === lastAutoFollowedCfi || spokenRangeVisible(cfi)) return;
  lastAutoFollowedCfi = cfi;
  followDisplayInFlight = true;
  rendition
    .display(cfi)
    .catch(() => {
      // Best-effort, matching setSpokenRange's own contract — a failed follow must not surface.
    })
    .finally(() => {
      followDisplayInFlight = false;
    });
}

/**
 * Paint the ONE active search match, or clear it.
 *
 * REMOVE-THEN-ADD off `currentSearchRange`, exactly like `setSpokenRange`: there is only ever one
 * match, the seam is stateless, and the caller keeps the state. A clear is the same call with
 * `null`, which is why the bridge needs no second command.
 *
 * NOT DIFFED like the user layer. `diffHighlights` earns its keep across a set of durable
 * highlights where most of them are unchanged between repaints; one transient range that moves on
 * every arrow press has nothing to diff against.
 *
 * NO `invalidateHighlightBoxes()`: that cache is built from `paintedUserHighlights` alone (see
 * `highlightBoxes`), and a search outline is not something the reader can press. Dropping it here
 * would throw away a still-valid cache on every step through the results.
 *
 * >>> NOTHING IS FILED UNTIL IT HAS BEEN RESOLVED IN ITS OWN CHAPTER, AND THAT IS NOT CAUTION. <<<
 * A range whose end offset runs past its text node throws `IndexSizeError` out of
 * `EpubCFI.toRange` — confirmed against this repo's sample book; `fixMiss` does not recover it. If
 * that annotation has already been filed, the throw does not come back here: `Annotations.inject`
 * re-attaches every annotation for a section from `hooks.render` WITH NO try/catch, so the next
 * time the reader opens that chapter it throws inside the render chain, which surfaces as
 * `WEBVIEW_UNHANDLED_REJECTION` and the reader's error banner — and repeats on every visit until
 * something removes it. A match that cannot be drawn must cost a quiet notice, not a broken
 * chapter.
 *
 * So `pending` is a real answer and the common one: the host sends this immediately after `goTo`,
 * so the chapter is usually still loading and there is nothing to verify against yet. The retry
 * lives on `hooks.content`, which is where the document arrives.
 */
function applySearchMatch(match: EpubSearchMatch | null): SearchPaintOutcome {
  if (!rendition) {
    // Nothing to paint onto. Forget the range rather than keep it: whatever rendition it was
    // painted into is gone, and a stale value would make the next `remove` address the wrong one.
    currentSearchRange = null;
    return match === null ? 'cleared' : 'pending';
  }
  const active = rendition;

  if (currentSearchRange !== null) {
    highlightRemove(active, SEARCH_OWNER, currentSearchRange);
    currentSearchRange = null;
  }

  pendingSearchMatch = match;
  if (match === null) return 'cleared';

  // Null for a term with no length, a CFI addressing an element rather than a character, or a pair
  // `joinCfiRange` refuses. All three mean "no span here", and none of them are worth an error
  // banner: the `goTo` that preceded this already landed the reader on the right words.
  const cfiRange = expandPointCfi(match.startCfi, match.matchText.length);
  if (cfiRange === null) return 'refused';

  const contents = contentsForCfi(cfiRange);
  if (contents === null) return 'pending';

  // It IS this chapter, and it still does not resolve — so the range is genuinely bad (a phrase
  // running past its text node is the reachable case). Refuse before filing it, per the note above.
  if (rangeForCfi(contents, cfiRange) === null) return 'refused';

  // >>> REFUSE A RANGE THE USER LAYER ALREADY OWNS. <<< epub.js hashes its annotation map on
  // `encodeURI(cfiRange + type)` and every owner passes the same kind now (highlightSeam.ts's
  // header), so painting the identical range string DISPLACES the user's map entry without
  // detaching its mark — and this layer's next `remove` then orphans a rect nothing can ever
  // delete. Reached by highlighting a word and then searching for it, which is not exotic.
  // Refusing costs nothing the reader can see: their own highlight is already marking the spot.
  for (const painted of paintedUserHighlights.values()) {
    if (painted === cfiRange) return 'refused';
  }

  try {
    highlightAdd(active, SEARCH_OWNER, cfiRange, SEARCH_MATCH_VARIANT, searchMatchStyles());
  } catch {
    return 'refused';
  }

  currentSearchRange = cfiRange;
  return 'painted';
}

/** Tell the host the outcome, if it is one worth saying and has not been said. `pending` and
 * `cleared` are silence: a chapter still loading has not failed, and a clear cannot. */
function reportSearchPaint(outcome: SearchPaintOutcome): void {
  if (outcome === 'pending' || outcome === 'cleared') return;
  const painted = outcome === 'painted';
  if (reportedSearchPainted === painted) return;
  reportedSearchPainted = painted;
  post({ type: 'searchMatchPainted', painted });
}

/** Re-attempt a match that could not be painted when it arrived. Called where a chapter document
 * becomes available, which is the one thing that changes the answer. Guarded on nothing being
 * painted, so a page turn inside the chapter the match is already drawn in does not churn it. */
function retrySearchMatch(): void {
  if (pendingSearchMatch === null || currentSearchRange !== null) return;
  reportSearchPaint(applySearchMatch(pendingSearchMatch));
}

/**
 * Re-add the search match ON TOP of whatever was just painted beneath it.
 *
 * Z-ORDER IS DOM ORDER in marks-pane, and HIGHLIGHT_LAYERS.md §4 puts `search` above `user`. A user
 * rect added while a match is showing is appended AFTER the outline and would sit over it, so
 * whatever added it lifts the outline back on top.
 *
 * >>> CALLED ONCE PER BATCH, BY THE CALLER THAT KNOWS WHERE THE BATCH ENDS. <<< Never from inside
 * `applyUserHighlights`, which is where it used to live: `repaintLiveAnnotations` and the flow
 * rebuild both call that AND lift afterwards, so the outline was detached and re-attached twice for
 * one refresh. The three batch boundaries are `paintHighlights` (conditionally, when the diff added
 * something), `repaintLiveAnnotations`, and `rebuildForFlowIfNeeded`.
 *
 * Also the retint path: the stroke is derived from the page colour and the re-add re-resolves the
 * CFI to a fresh `Range`, so this is the re-measure as well as the re-tint. It must REMOVE first for
 * the reason `repaintLiveAnnotations` documents at length (a bare re-add leaves the old-coloured
 * mark attached underneath).
 */
function liftSearchMatch(): void {
  if (!rendition || currentSearchRange === null) return;
  highlightRemove(rendition, SEARCH_OWNER, currentSearchRange);
  highlightAdd(
    rendition,
    SEARCH_OWNER,
    currentSearchRange,
    SEARCH_MATCH_VARIANT,
    searchMatchStyles(),
  );
}

/**
 * Build a rendition against the current appearance's flow/spread, wire its handlers, and set it as
 * THE rendition. Used both by `openEpub` (the first one) and by `applyAppearance` (to rebuild one
 * when a flow change needs a different manager — see `mapManager`'s note).
 *
 * Order matters and mirrors the original inline version: `applyBaselineCss()` BEFORE the content
 * hook is registered, so the first chapter loads already columnised — registering the hook first
 * would flash UA-default styles before the first `resized`/reflow.
 */
/**
 * Rebuild the rendition when the flow on screen is not the flow that was asked for.
 *
 * NOT CALLED WHILE `openInFlight`: `openEpub` owns the rendition until its first `display()`
 * resolves, and destroying it underneath would fail an open that was going fine. It re-checks itself
 * when it is done, so a flow that arrives mid-open is applied a moment later rather than dropped.
 *
 * A flow change is the one appearance change epub.js cannot do in place — crossing the
 * paginated <-> scrolled boundary needs a different MANAGER (see `mapManager`), and there is no
 * public API to hot-swap one.
 */
function rebuildForFlowIfNeeded(): boolean {
  if (!rendition || openInFlight) return false;
  if (renditionFlow === currentFlow()) return false;

  const cfi = lastCfi;
  rendition.destroy();
  createRendition()
    .display(cfi ?? undefined)
    .then(() => {
      // A fresh Rendition means a fresh Annotations store — the old highlight is gone with it.
      // Re-paint rather than silently drop it; setSpokenRange's own remove-then-add would target
      // the wrong (destroyed) rendition if called from here instead.
      if (currentSpokenCfi !== null && rendition) {
        highlightAdd(rendition, TTS_OWNER, currentSpokenCfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
      }
      // The word wash rides with its sentence, immediately after it so it stays on top. `live:
      // false` because this rendition was just built: there is nothing attached to detach, and a
      // remove here would be aimed at the destroyed rendition's `Annotations` — the same distinction
      // `repaintLiveAnnotations` and `repaintUserHighlights` exist to keep apart.
      repaintSpokenWord({ live: false });
      // Same problem, same fix, for the durable layer — and worse if missed: a spoken range
      // reappears on the next sentence, but a user highlight would simply be gone until the
      // book was reopened.
      repaintUserHighlights();
      // And the search outline, THROUGH `liftSearchMatch` rather than a bare `highlightAdd`. The
      // bare add looks right for a rendition that was just built — there is nothing to detach — and
      // is wrong for a reason that is invisible from here: `repaintUserHighlights` above may have
      // already re-added the outline (its own lift fires whenever it adds anything), and a second
      // `Annotations.add` on the same range overwrites the map entry WITHOUT detaching the mark
      // already attached. That is the duplicate-mark defect `repaintLiveAnnotations` documents,
      // arriving by a different route. Remove-then-add is idempotent either way, and epub.js's
      // `remove` tolerates a miss.
      //
      // >>> KNOWN §4 DEVIATION, RECORDED RATHER THAN FIXED HERE. <<< This leaves `search` above the
      // two `tts` layers, where HIGHLIGHT_LAYERS.md §4 puts `tts` on top. It predates the word layer
      // (the sentence has always been added before this line) and the word inherits it unchanged, so
      // nothing regressed — but it is real, and `paintHighlights` has the same shape: it lifts only
      // `search`, so a newly created user highlight is appended above BOTH spoken layers.
      //
      // The fix, when someone takes it: a `liftSpokenLayers()` sibling of `liftSearchMatch` that
      // removes-then-re-adds the sentence AND the word as a PAIR — the pair is the unit, because
      // lifting the sentence alone would put it over its own word — called from the same three batch
      // boundaries `liftSearchMatch` names (`paintHighlights`, `repaintLiveAnnotations`, here), last.
      // It wants a device pass, which is why it is not bundled into a change that lands without one.
      liftSearchMatch();
    })
    .catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });

  return true;
}

function createRendition(): Rendition {
  if (!book) throw new Error('createRendition() called before a book was opened');

  renditionFlow = currentFlow();
  rendition = book.renderTo('viewer', {
    flow: currentFlow(),
    manager: mapManager(currentFlow()),
    // '100%' AS STRINGS, NOT NUMBERS — see the note this carried before extraction: Stage.onResize
    // only attaches a window resize listener when width/height are NOT numeric (stage.js:147-153).
    // Pinned by readerTemplate.test.ts.
    width: '100%',
    height: '100%',
    spread: currentAppearance ? mapSpread(currentAppearance.spread) : 'none',
  });

  applyBaselineCss();

  rendition.hooks.content.register((contents: Contents) => {
    if (isPaginated(currentFlow())) applyAuthoredBreaks(contents.document);
    capExcessiveIndents(contents.document, viewportSize().width);
    insertStylesheet(contents, finalCssFor(contents.document));
    watchTouches(contents);
    // >>> THE REFLOWS NOBODY ANNOUNCES. <<< `applyAppearance` covers every change the READER makes,
    // and the book makes its own: a late image, a web font resolving, a script-free but slow
    // stylesheet. Each re-flows the lines under marks that were measured before it, and none of them
    // arrives as a command. epub.js emits this whenever the chapter's measured text size moves
    // (`Contents.resizeCheck`), so it is the one signal that covers them all. Cheap to over-fire:
    // the handler coalesces onto a frame and a refresh that finds the layout unchanged paints
    // nothing.
    contents.on('resize', () => {
      scheduleGeometryRefresh();
    });
    // A newly loaded chapter is a different document with different geometry, and the cache is
    // keyed on the document it measured — but drop it explicitly rather than leaning on that, so
    // a re-styled reload of the SAME document cannot serve boxes measured before the restyle.
    invalidateHighlightBoxes();
    // THE DEFERRED SEARCH PAINT LANDS HERE. A match arrives while its chapter is still loading
    // (the host sends it straight after `goTo`), and this hook is the moment that stops being
    // true — it is the EPUB counterpart of `renderPageSurface` reporting for the PDF shell.
    retrySearchMatch();
  });

  // Rotation changes the type size AND the line-grid remainder, so a sheet built for portrait
  // leaves sliced lines in landscape. epub.js already re-lays out and re-displays the current CFI
  // on resize; this is the stylesheet half of it.
  rendition.on('resized', () => {
    applyBaselineCss();
    invalidateHighlightBoxes();
    // The sheet this just rebuilt is derived from the viewport, so rotation moves every glyph even
    // though no preference changed, and the marks need re-measuring against it.
    //
    // >>> NO `reanchor` HERE, AND THAT IS NOT AN OVERSIGHT. <<< epub.js re-displays at the current
    // location ITSELF on this event — `Rendition.onResized` emits it and then calls
    // `display(this.location.start.cfi)` on the very next line (`epubjs/lib/rendition.js:463-478`).
    // Asking for a second display would put two of them in flight over one rotation, racing to
    // decide where the reader ends up. `applyAppearance` re-anchors because on that path nothing
    // else does.
    scheduleGeometryRefresh();
  });

  /** Keeps `lastSelection` current, and re-answers the menu toggle now that there is a selection to
   * judge it against. Splits epub.js's range CFI into two point CFIs — `addEpubHighlight` takes two
   * locators.
   *
   * >>> WHY THE TOGGLE IS RE-POSTED FROM HERE AND NOT ONLY FROM `touchstart`. <<< At `touchstart`
   * there is no selection yet, so the only question that can be asked is "is the finger on a
   * highlight" — and the reader's question is "does what I selected meet one". epub.js debounces
   * `selectionchange` by 250ms, so in the ordinary long-press case this lands while the finger is
   * still down, i.e. before `touchend`, which is when WebKit builds the menu. Best-effort display
   * either way: `requestCurrentSelection`/`confirmDeleteHighlight` re-check for themselves, so a
   * late one costs a wrong LABEL and never a wrong action.
   *
   * Still never cleared on `touchend` — see readerBridge.ts's `highlightTouchActive` note. Both
   * menu arrays are one item long (`ReaderWebView.tsx`), so swapping between them cannot reproduce
   * the crash that came from an array shrinking to empty under `tappedMenuItem:`. */
  rendition.on('selected', (cfiRange: string, contents: Contents) => {
    const selection = contents.document.defaultView?.getSelection();
    const overlapped =
      selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? highlightIdForRange(contents, selection.getRangeAt(0))
        : null;
    post({
      type: 'highlightTouchActive',
      active: overlapped !== null || pressedHighlightId !== null,
    });

    const ends = splitCfiRange(cfiRange);
    // Not a range (a collapsed CFI, or a shape this parser does not recognise) is not a selection
    // anyone can highlight. Silent: epub.js emits this on every drag, so a malformed one is noise,
    // not an event worth a coded error.
    if (ends === null) {
      lastSelection = null;
      return;
    }

    lastSelection = { kind: 'cfiRange', startCfi: ends.startCfi, endCfi: ends.endCfi };
  });

  rendition.on(
    'relocated',
    (location: {
      start?: { cfi?: string; href?: string; index?: number };
      atStart?: boolean;
      atEnd?: boolean;
    }) => {
      lastCfi = location?.start?.cfi ?? null;

      // A page turn drops whatever was selected — the view it lived in is no longer on screen, so a
      // later requestCurrentSelection must not answer with words nobody can see any more.
      lastSelection = null;
      invalidateHighlightBoxes();

      // SECOND RETRY SITE, and not redundant with the one in `hooks.content`. That hook runs WHILE a
      // chapter document is being set up, and `rendition.getContents()` — which is how the match
      // finds the document it belongs to — is not guaranteed to list the new view yet. `relocated`
      // fires after `display()` resolves, when it certainly does. Both are guarded on nothing being
      // painted, so whichever gets there first wins and the other is a no-op.
      retrySearchMatch();

      // AND THIS IS WHERE SILENCE STOPS BEING ACCEPTABLE. The navigation the match arrived with has
      // now settled, so a match that still is not painted is not waiting for anything — say so, and
      // let the host's notice explain the absence rather than leaving the reader hunting for a word
      // they were told is on the page. See `awaitingSearchLanding`.
      if (awaitingSearchLanding) {
        awaitingSearchLanding = false;
        if (currentSearchRange === null && pendingSearchMatch !== null)
          reportSearchPaint('refused');
      }

      // epub.js's own location already carries both, so this costs no extra call: `href` is the
      // spine item's and `index` its spine position. Sent whole or not at all — a section with an
      // index and no href cannot be compared against the previous one (see `ReaderSection`), so a
      // partial one would announce a chapter change on every page turn.
      const href = location?.start?.href;
      const index = location?.start?.index;
      const section =
        typeof href === 'string' && href !== '' && typeof index === 'number'
          ? { index, href }
          : null;

      post({
        type: 'relocated',
        // A CFI, not a page: this book is reflowable, so there is no stable page to report. That is
        // the whole reason ReaderPosition is discriminated by format rather than carrying both
        // shapes flat with one of them always null.
        position: { kind: 'cfi', cfi: lastCfi },
        atStart: !!location?.atStart,
        atEnd: !!location?.atEnd,
        section,
      });
    },
  );

  return rendition;
}

const api: TFReaderApi<'openEpub'> = {
  /**
   * Open a whole book from base64-encoded EPUB bytes and paginate it.
   *
   * NAMED openEpub, NOT open, and that is the whole of how format routing crosses this bridge. The
   * host reads ContentFormat in typechecked TS and picks the command NAME; the format value never
   * travels. Same reason goTo carries a bare string instead of a Locator.
   *
   * >>> THE DECRYPTED-CONTENT HANDOFF. THIS IS LIVE. <<<
   * The base64 handed in is a whole book already decrypted in RAM by ContentProvider.getBook(bookId).
   * It never touched disk as plaintext, and it must not start here — nothing below may write, cache
   * or postMessage these bytes back out.
   *
   * No crypto runs in this file; the decrypt already happened host-side. That is a division of
   * labour, NOT an absence of licensed content — ReaderWebView.tsx's navigation lockdown is what
   * contains what lands here, and it is load-bearing for exactly this reason.
   */
  openEpub: (base64) => {
    const ePub = epubFactory();
    if (!ePub) {
      fail('EPUBJS_MISSING', 'epub.js did not load — check the build-html inject step');
      return;
    }

    void (async () => {
      try {
        // A fresh book gets a fresh cache — a stale sectionCache/cfiIndex entry from whatever was
        // open before would answer a request with someone else's CFIs. Also clears the highlight
        // state: a spoken range painted into the previous rendition has nothing to be re-painted onto.
        resetTtsState();
        currentSpokenCfi = null;
        // And the word inside it. Not merely tidiness: `EpubCFI.toRange` ignores the spine
        // component (see `cfiSpinePos`), so a word CFI left over from the previous book would
        // resolve happily against this one's first chapter and be re-painted by the first repaint
        // that came along, over whatever text sits at the same tree position.
        currentSpokenWordCfi = null;
        // A CFI auto-followed in the previous book addresses nothing here either — same
        // cross-book-resolves-anyway hazard, and a stale match would wrongly skip a follow this
        // book's first spoken CFI genuinely needs.
        lastAutoFollowedCfi = null;
        // A follow's display() tied to the previous book's (now-discarded) rendition may never
        // settle its own promise, which would otherwise strand this true forever and silently
        // disable auto-follow for the entire new book.
        followDisplayInFlight = false;

        // Same reasoning one line up, for the user layer: ids and CFIs from the previous book
        // address nothing in this one, and a stale map would make the first `paintHighlights` for
        // the new book diff against the old book's set and skip paints it should make.
        paintedUserHighlights.clear();
        lastUserHighlights = [];
        // Same reasoning again for the search layer, and "resolve somewhere arbitrary" is not a
        // figure of speech here: `EpubCFI.toRange` ignores the spine component, so a CFI from the
        // previous book resolves happily against this one's first chapter (see `cfiSpinePos`).
        currentSearchRange = null;
        pendingSearchMatch = null;
        reportedSearchPainted = null;
        awaitingSearchLanding = false;

        const buffer = base64ToArrayBuffer(base64);
        book = ePub();

        // 'binary' is explicit rather than inferred. epub.js's determineType() would return BINARY
        // for any non-string anyway, but naming it means a future change of input shape fails loudly
        // instead of being silently re-detected as a URL.
        await book.open(buffer, 'binary');

        // Picks up the current appearance's flow/spread if applyAppearance already landed (the host
        // sends it before openEpub), falling back to the pre-payload default otherwise — see
        // currentAppearance's own note. See createRendition()'s own note for why this is factored
        // out: applyAppearance needs to rebuild the same way on a flow change that needs a different
        // manager.
        // CLAIMS THE RENDITION until the first display() resolves. An applyAppearance arriving in
        // this window must not destroy what is being displayed — see `renditionFlow`'s note.
        openInFlight = true;
        const newRendition = createRendition();

        try {
          await newRendition.display();
        } finally {
          openInFlight = false;
        }
        post({ type: 'rendered' });

        // A flow that arrived DURING the open was deferred rather than dropped. Applied now, on the
        // book that is actually on screen — this is the "turned the screen reader on while the book
        // was loading" path, and without it the reader would sit in paginated flow, which is the
        // layout the override exists to get out of.
        void rebuildForFlowIfNeeded();

        const navigation = (await book.loaded.navigation) as { toc?: NavItem[] };
        post({ type: 'toc', items: flattenToc(navigation?.toc ?? [], 0, []) });
      } catch (error) {
        openInFlight = false;
        fail('OPEN_FAILED', error);
      }
    })();
  },

  next: () => {
    if (!rendition) {
      fail('NOT_READY', 'next() before a book was opened');
      return;
    }
    rendition.next().catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });
  },

  prev: () => {
    if (!rendition) {
      fail('NOT_READY', 'prev() before a book was opened');
      return;
    }
    rendition.prev().catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });
  },

  /**
   * Navigate to an EPUB target.
   *
   * NO BRANCH ON WHAT THE `href` IS, on purpose: it is a spine href (from a TOC row) or an EPUB CFI
   * (from a Search hit), and epub.js's `spine.get()` checks `isCfiString()` before its href lookup, so
   * `display()` already routes both correctly.
   *
   * THE FORMAT CHECK IS NEW, and it is what un-overloading the target bought. A PDF target reaching
   * this shell should be impossible — one shell is loaded per book — but the value arrives over JSON
   * from a book's own navigation document, so it is checked. Previously this was unexpressible: any
   * string was a plausible href, so a page number would have been handed to `display()` and resolved
   * to no spine item, failing later and less legibly.
   */
  goTo: (target) => {
    if (!rendition) {
      fail('NOT_READY', 'goTo() before a book was opened');
      return;
    }

    if (target.kind !== 'href') {
      fail('NAVIGATION_FAILED', `goTo: this shell renders EPUB, not ${target.kind}`);
      return;
    }

    rendition.display(target.href).catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });
  },

  /**
   * Apply a resolved appearance. Fire-and-forget, sent before `openEpub` in the normal case (see
   * `currentAppearance`'s note) and again on any live prefs/OS change thereafter — never a reopen.
   *
   * Theme colours ride the SAME `addStylesheetCss` path as typography, not `rendition.themes.*` —
   * see `baselineCss`'s own note on why themes cannot carry this at all for chapters loaded later.
   *
   * `flow` is the one change that needs more than re-styling, and more than `rendition.flow()`
   * alone can give it: a flow change that crosses the `mapManager()` boundary (paginated <->
   * anything else) needs a DIFFERENT epub.js manager, and the manager is fixed at construction —
   * there is no public API to hot-swap it. So instead of calling `rendition.flow()`, this destroys
   * the current rendition and rebuilds one from scratch via `createRendition()`, redisplaying at the
   * last known CFI. Skipped when the flow is unchanged so an unrelated theme-only appearance update
   * never triggers a rebuild. `spread` needs no such guard — `rendition.spread()` is cheap and
   * idempotent, and is not epub.js's manager choice.
   */
  applyAppearance: (appearance) => {
    const previousBg = currentAppearance?.bg;
    // Captured BEFORE `currentAppearance` moves, and against the viewport as it is now — the same
    // two inputs `applyBaselineCss` will feed to `readerMetrics` a few lines down.
    const previousSignature = layoutSignature(currentAppearance, viewportSize());
    currentAppearance = appearance;

    if (!rendition) return;

    // Compares what is RENDERED against what is now wanted, and defers while an open is in flight —
    // see `renditionFlow`'s note for the race that motivates both. A rebuild re-styles on its own,
    // so there is nothing left for the rest of this handler to do.
    if (rebuildForFlowIfNeeded()) return;

    applyBaselineCss();
    rendition.spread(mapSpread(appearance.spread));

    // THE RENDERED SHADE IS A FUNCTION OF THE PAGE, SO A NEW PAGE COLOUR MEANS A NEW SHADE.
    // `userHighlightStyles`/`ttsSpokenStyles` resolve `highlightFill(color, bg)` and hand the result
    // to marks-pane as SVG presentation attributes — baked into the DOM once, at paint time. Nothing
    // else re-derives them: `paintHighlights` diffs on ids only (highlightPaint.ts), so an
    // already-painted id is skipped and a highlight would keep the shade of whatever theme it was
    // created under until the book was reopened. On a light -> dark switch that means `multiply`
    // against a near-black page, which is very nearly invisible.
    //
    // >>> AND THE GEOMETRY IS A FUNCTION OF THE TYPE, SO NEW TYPE MEANS NEW RECTS. <<< This used to
    // be guarded on `bg` ALONE, on the reasoning that a font-size or spread change should not detach
    // and re-attach every annotation for a colour that did not move. The colour half of that is
    // right; the implication that nothing else needs the repaint is what left every highlight
    // stranded on the words it used to cover. epub.js re-measures a mark only inside
    // `View.reframe()`, and a stylesheet change does not reach it — `epubViewGeometry.ts` has both
    // gates. So the guard is now "did anything move", not "did the colour move".
    //
    // `layoutSignature` is the whole of that question and is unit-tested next door, which is also
    // what makes ADDING a typography field to `ReaderAppearance` fail to compile until someone
    // classifies it: silence there is how this defect would come back.
    //
    // Deferred to a frame rather than run inline, because the two triggers coalesce: a stepper emits
    // one payload per tap, and the reflow this handler just caused will emit a contents resize of
    // its own.
    const nextSignature = layoutSignature(appearance, viewportSize());
    if (previousSignature !== nextSignature) {
      scheduleGeometryRefresh({ reanchor: true });
    } else if (previousBg !== appearance.bg) {
      // Colour only. Same repaint, but the reader must not be moved for it — re-displaying on a
      // theme toggle would jump the page for a change that did not shift a single glyph.
      scheduleGeometryRefresh();
    }

    // >>> A CUSTOM FONT LANDS AFTER THIS TURN, NOT DURING IT. <<< `baselineCss` declares the face as
    // an `@font-face` over a data: URI, and the text re-flows only once WebKit has parsed the file —
    // after the refresh scheduled above has already measured. Nothing else brings us back, because
    // the swap arrives as a stylesheet edit rather than as a resize of anything observed. So the
    // font's own readiness is the second trigger. Best-effort: `document.fonts` is not in every
    // engine this could theoretically run in, and a reader whose custom font never resolves is
    // reading in the fallback face, which is not a reason to fail anything.
    if (previousSignature !== nextSignature && appearance.customFontUri !== null) {
      for (const contents of rendition.getContents() as unknown as Contents[]) {
        void contents.document.fonts?.ready.then(() => {
          scheduleGeometryRefresh();
        });
      }
    }
  },

  /**
   * The bridge's FIRST request/reply command. `book`/`rendition` are captured into locals before the
   * async resolve work starts and used throughout it, rather than re-read from the module-locals —
   * if a new `openEpub` reassigns them while this is still resolving, this request keeps operating
   * against the OLD (still functional, just orphaned) book/rendition objects instead of reading a
   * moved-on one mid-computation. Its eventual reply is harmless either way: the host's own
   * per-book provider instance is what actually discards a stale reply, not this shell.
   */
  requestTtsSentence: ({ requestId, from, mode }) => {
    const activeBook = book;
    const activeRendition = rendition;

    if (!activeBook || !activeRendition) {
      post({ type: 'ttsSentence', requestId, result: { status: 'unavailable' } });
      return;
    }

    void (async () => {
      try {
        const result =
          mode === 'current'
            ? await resolveCurrent(activeBook, activeRendition, from, lastCfi)
            : await resolveNext(activeBook, activeRendition, from ?? '');
        post({ type: 'ttsSentence', requestId, result });
      } catch (error) {
        post({
          type: 'ttsSentence',
          requestId,
          result: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })();
  },

  /**
   * Paint the user's saved highlights — the whole set, idempotently. See `ReaderCommand`'s own note
   * for why the host always sends everything rather than a patch.
   *
   * The payload is narrowed on arrival because the command is shared by both shells and its argument
   * is the union of their two shapes (highlightPaint.ts explains why it cannot be discriminated by
   * format). A PDF-shaped entry reaching the EPUB shell means the host chose the wrong array while
   * having correctly chosen `openEpub` — structurally impossible, and reported the same way a
   * wrong-format `goTo` target is rather than quietly dropped, so it cannot hide as "no highlights".
   *
   * `lastUserHighlights` is updated even when there is no rendition yet: `paintHighlights` can
   * legitimately arrive before the book has finished opening (the host sends it after `rendered`,
   * but nothing in the protocol forces that), and the rebuild path re-reads it.
   */
  paintHighlights: (highlights) => {
    const { mine, foreign } = epubHighlights(highlights);
    lastUserHighlights = mine;
    // THE ONLY CALLER THAT HAS TO ASK. The other two (`repaintLiveAnnotations`, and the flow
    // rebuild via `repaintUserHighlights`) lift unconditionally at the end of their own batch. Here
    // the lift is worth skipping when the diff added nothing: a repaint that changed nothing must
    // not detach and re-attach a mark for no reason, and this command is re-sent on every change to
    // the host's highlight state.
    if (applyUserHighlights(mine)) liftSearchMatch();

    if (foreign > 0) {
      fail(
        'NAVIGATION_FAILED',
        `paintHighlights: ${String(foreign)} highlight(s) address pages, and this shell renders EPUB`,
      );
    }
  },

  /**
   * Paint or clear the one active search match. See `ReaderCommand`'s own note for why the payload
   * arrives partitioned rather than tagged, and why the whole object crosses rather than this
   * shell's half of it.
   *
   * A NON-NULL `pdf` SIDE IS A HOST BUG, reported the way `paintHighlights` reports a foreign
   * entry: the host chose `openEpub` for this book, so a PDF-shaped match means it picked the wrong
   * side while having picked the right shell. Structurally impossible, and it must not be able to
   * hide as "no match found".
   */
  paintSearchMatch: (match) => {
    if (match.pdf !== null) {
      fail(
        'NAVIGATION_FAILED',
        'paintSearchMatch: the match addresses a page, and this shell renders EPUB',
      );
      return;
    }

    // A new payload is a new question, so whatever was said about the last one no longer counts.
    reportedSearchPainted = null;
    // Only a paint has a landing to wait for; a clear has nothing to report either way.
    awaitingSearchLanding = match.epub !== null;
    reportSearchPaint(applySearchMatch(match.epub));
  },

  /**
   * Paint or clear the spoken-sentence highlight, through the owner-namespaced seam so this can never
   * collide with another feature's `rendition.annotations` use (see highlightSeam.ts). Fire-and-forget
   * and best-effort, matching `ReaderTextProvider.setSpokenRange`'s own contract: a highlight that
   * cannot be painted must not be able to interrupt speech, so this never posts a message and never
   * throws out of the try.
   *
   * >>> IT CLEARS THE WORD WASH FIRST, AND THAT IS NOT HOUSEKEEPING. <<< A word range is only
   * meaningful inside the sentence it was resolved against, so a sentence that moves invalidates it.
   * The caller cannot be relied on to do this: `useTtsSession` only sends word ranges while
   * `highlightMode === 'word'`, so a reader who turns word mode OFF mid-utterance would otherwise
   * strand the last word wash on screen with nothing left that would ever remove it.
   *
   * It is also the precondition auto-follow needs (`followSpokenRange`, below): a `display()` that
   * re-renders the view while a stale word mark is still attached would carry it into the new view.
   * Clearing before anything else keeps that free — do not move it below the paint.
   */
  setSpokenRange: (cfi) => {
    try {
      if (!rendition) return;
      clearSpokenWord();
      if (currentSpokenCfi !== null) highlightRemove(rendition, TTS_OWNER, currentSpokenCfi);
      currentSpokenCfi = cfi;
      if (cfi !== null) {
        highlightAdd(rendition, TTS_OWNER, cfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
        // Coarse auto-follow: a brand-new sentence starting entirely off-screen. The word-level
        // handler below refines this for a sentence that straddles a page/column break.
        followSpokenRange(cfi);
      } else {
        lastAutoFollowedCfi = null;
      }
    } catch {
      // Best-effort, per the interface's own contract — swallowed rather than reported.
    }
  },

  /**
   * Paint or clear the spoken-WORD highlight — the word inside the sentence `setSpokenRange` is
   * showing. Same contract as its sibling: fire-and-forget, best-effort, never posts, never throws.
   *
   * >>> THE PREVIOUS WORD IS CLEARED BEFORE THE NEW ONE IS RESOLVED, NOT AFTER. <<< That ordering is
   * the whole correctness argument, because `resolveSpokenWordCfi` bails to `null` for a list of
   * ORDINARY reasons — the reader paged away mid-utterance so the section is not rendered, the
   * rendered text no longer matches what was spoken, the sentence is a single word already covered
   * by the sentence wash. A bail means "I do not know where this word is", and a highlight left on
   * the previous word while the voice has moved on is a LIE, whereas no word highlight is merely
   * less information. The sentence wash is on screen throughout either way, so what a bail costs is
   * the refinement, never the "you are here".
   *
   * `!rendition` returns before any of that, exactly as `setSpokenRange` does and for a reason worth
   * naming: this can legitimately arrive before the rendition exists (nothing in the protocol orders
   * the host's commands), and with no rendition there is nothing painted for the state to disagree
   * with — `openEpub` nulls it, and a paint only ever happens with a live rendition.
   *
   * ALSO THE PRECISE HALF OF AUTO-FOLLOW. `followSpokenRange(cfi)` runs on the resolved word CFI
   * regardless of whether the paint above was skipped for colliding with another owner's highlight —
   * the word's position is real even when its paint is suppressed. This is what turns a page turn
   * exactly on the first word to fall off the current one, not before and not a whole sentence late:
   * `useTtsSession` calls this once per `tts-progress` tick while `highlightMode === 'word'`, so a
   * sentence that straddles a page break gets checked word-by-word as speech crosses it, where
   * `setSpokenRange`'s own once-per-sentence call could only check the sentence as a whole.
   */
  setSpokenWordRange: (range) => {
    try {
      if (!rendition) return;

      // Unconditional, and BEFORE the resolve: see the note above.
      clearSpokenWord();
      if (range === null) return;

      const cfi = resolveSpokenWordCfi(rendition, range.cfi, range.start, range.end);
      if (cfi === null) return;
      // The paint side's half of the collision guard — the resolver's own bail only covers the
      // sentence it was handed. See `spokenWordCollides` for why this refuses rather than displaces.
      if (!spokenWordCollides(cfi)) {
        currentSpokenWordCfi = cfi;
        // Added AFTER the sentence in DOM order, which is what puts the word wash on top of it.
        repaintSpokenWord({ live: false });
      }
      followSpokenRange(cfi);
    } catch {
      // Best-effort, per the interface's own contract — swallowed rather than reported.
    }
  },

  /**
   * The reader tapped "Highlight". Forces `triggerSelectedEvent` (epub.js's own CFI computation,
   * `contents.js`) rather than reading `lastSelection` as-is, so a selection extended a moment ago
   * is what gets read.
   *
   * REFUSES (`null`) WHENEVER THE GESTURE ALREADY MEETS A HIGHLIGHT — `activeHighlightId`, which is
   * the SELECTION's overlap first and the pressed point only as a fallback. Refusing on
   * `pressedHighlightId` alone was not enough: a selection dragged into a highlight left it null,
   * so this happily created a second annotation over the first. See `highlightIdForRange`.
   */
  requestCurrentSelection: () => {
    if (activeHighlightId() !== null) {
      post({ type: 'selection', selection: null });
      return;
    }

    const selected = currentSelectionRange();
    if (selected) {
      const view = selected.contents.document.defaultView;
      const selection = view?.getSelection();
      if (selection) {
        (
          selected.contents as unknown as { triggerSelectedEvent: (s: Selection) => void }
        ).triggerSelectedEvent(selection);
        post({ type: 'selection', selection: lastSelection });
        return;
      }
    }

    post({ type: 'selection', selection: null });
  },

  /** The reader tapped "Delete Highlight". Answers with whatever the gesture is acting on —
   * `activeHighlightId`, so a highlight reached by dragging a selection over it deletes just like
   * one reached by pressing it. Silent when neither applies, as before. */
  confirmDeleteHighlight: () => {
    const id = activeHighlightId();
    if (id !== null) {
      post({ type: 'highlightPressed', id });
    }
  },
};

// Announce last, once the API is fully defined — RN waits for `ready` before injecting any command.
if (!epubFactory()) {
  fail('EPUBJS_MISSING', 'epub.js did not load — check the build-html inject step');
} else if (typeof window.JSZip !== 'function') {
  fail('JSZIP_MISSING', 'JSZip did not load — check inject order in the template');
} else {
  publish(api);
}
