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
import type { ReaderSelection } from '@/features/reader/readerBridge';

import {
  base64ToArrayBuffer,
  fail,
  installErrorHandlers,
  post,
  publish,
  type TFReaderApi,
} from './bridge';
import { resetTtsState, resolveCurrent, resolveNext } from './epubTtsResolver';
import { joinCfiRange, splitCfiRange } from './epubCfiRange';
import { flattenToc, type NavItem } from './epubOutline';
import { highlightAt, rangesOverlap, type HighlightBox } from './highlightGeometry';
import { diffHighlights, epubHighlights } from './highlightPaint';
import { add as highlightAdd, remove as highlightRemove } from './highlightSeam';
import { highlightFill } from './selectionTheme';
import {
  LONG_PRESS_MS,
  movedBeyondSlop,
  swipeDirection,
  type TouchPoint,
} from './touchGesture';
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

/** The last reported CFI, kept only to re-display the reading position after a live flow change —
 * the one appearance change that needs epub.js to re-layout rather than just re-style. Also what
 * `requestTtsSentence`'s `current(null)` resolves against: "wherever the reader actually is." */
let lastCfi: string | null = null;

/** The CFI `setSpokenRange` last painted, or null if nothing is currently highlighted. Kept so a
 * flow-triggered rendition rebuild (a new `Annotations` store) can re-paint it, and so `setSpokenRange`
 * itself can remove the previous range before adding the new one — the seam is stateless by design;
 * this is the caller-side state it expects. */
let currentSpokenCfi: string | null = null;

const TTS_OWNER = 'tts';
const TTS_SPOKEN_VARIANT = 'spoken';

/** TTS's channel (HIGHLIGHT_LAYERS.md §3): a translucent overlay. SVG presentation attributes, not
 * CSS — marks-pane applies them via `setAttribute`. `0.2`, kept below `user`'s opacity so the two
 * stay visually ordered.
 *
 * A FUNCTION, NOT A CONSTANT, for the same reason `userHighlightStyles` is: `multiply` against a
 * near-black page multiplies towards black, so a fixed blend made the spoken word invisible on the
 * dark theme — the layer that most needs to be seen, since it is what tells the reader where the
 * voice is. Re-derived on every paint and re-applied by `retintUserHighlights` on a theme change. */
const TTS_SPOKEN_COLOR = '#ffd500';

function ttsSpokenStyles(): Record<string, string> {
  const { fill, blend } = highlightFill(TTS_SPOKEN_COLOR, currentAppearance?.bg);
  return { fill, 'fill-opacity': '0.2', 'mix-blend-mode': blend };
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

/** One painted highlight's CFI resolved against THIS chapter, or null. The map is not
 * chapter-scoped, so a CFI belonging to another spine document simply fails to resolve — epub.js
 * signals that by throwing as often as by returning nothing, hence the catch. */
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
 */
function applyUserHighlights(highlights: EpubHighlightPaint[]): void {
  if (!rendition) return;
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

    // TWO IDS ON ONE RANGE COLLIDE INSIDE epub.js, so refuse the second rather than paint it.
    // `Annotations` hashes on `encodeURI(cfiRange + type)` (highlightSeam.ts's header), and its
    // `add` overwrites that entry WITHOUT detaching the mark already attached — so the loser stays
    // painted forever, composites darker under the winner, and `remove` can only ever detach one of
    // them. Reported rather than dropped: `highlightIdForRange` now refuses to create a highlight
    // over one that exists, so reaching here means the host and this shell disagree about what is
    // painted, which is worth hearing about even though it should be unreachable.
    const collidingId = [...paintedUserHighlights].find(
      ([, painted]) => painted === cfiRange,
    )?.[0];
    if (collidingId !== undefined) {
      fail(
        'NAVIGATION_FAILED',
        `paintHighlights: ${highlight.id} and ${collidingId} address the same range`,
      );
      continue;
    }

    // No onTap: press-to-delete hit-tests directly now (`highlightIdAtPoint`), not marks-pane's own
    // touch wiring.
    highlightAdd(active, USER_OWNER, cfiRange, USER_SAVED_VARIANT, userHighlightStyles(highlight.color));
    paintedUserHighlights.set(highlight.id, cfiRange);
  }
}

/**
 * Re-tint every painted highlight for the CURRENT theme, against a LIVE rendition.
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
function retintUserHighlights(): void {
  if (!rendition) return;
  const active = rendition;

  for (const cfiRange of paintedUserHighlights.values()) {
    highlightRemove(active, USER_OWNER, cfiRange);
  }
  paintedUserHighlights.clear();
  applyUserHighlights(lastUserHighlights);

  if (currentSpokenCfi !== null) {
    highlightRemove(active, TTS_OWNER, currentSpokenCfi);
    highlightAdd(active, TTS_OWNER, currentSpokenCfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
  }
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
 * replace — use `retintUserHighlights()` there, and see its note for what epub.js does.
 */
function repaintUserHighlights(): void {
  paintedUserHighlights.clear();
  applyUserHighlights(lastUserHighlights);
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
function createRendition(): Rendition {
  if (!book) throw new Error('createRendition() called before a book was opened');

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
    // A newly loaded chapter is a different document with different geometry, and the cache is
    // keyed on the document it measured — but drop it explicitly rather than leaning on that, so
    // a re-styled reload of the SAME document cannot serve boxes measured before the restyle.
    invalidateHighlightBoxes();
  });

  // Rotation changes the type size AND the line-grid remainder, so a sheet built for portrait
  // leaves sliced lines in landscape. epub.js already re-lays out and re-displays the current CFI
  // on resize; this is the stylesheet half of it.
  rendition.on('resized', () => {
    applyBaselineCss();
    invalidateHighlightBoxes();
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

        // Same reasoning one line up, for the user layer: ids and CFIs from the previous book
        // address nothing in this one, and a stale map would make the first `paintHighlights` for
        // the new book diff against the old book's set and skip paints it should make.
        paintedUserHighlights.clear();
        lastUserHighlights = [];

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
        const newRendition = createRendition();

        await newRendition.display();
        post({ type: 'rendered' });

        const navigation = (await book.loaded.navigation) as { toc?: NavItem[] };
        post({ type: 'toc', items: flattenToc(navigation?.toc ?? [], 0, []) });
      } catch (error) {
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
    const previousFlow = currentAppearance?.flow;
    const previousBg = currentAppearance?.bg;
    currentAppearance = appearance;

    if (!rendition) return;

    if (previousFlow !== undefined && previousFlow !== appearance.flow) {
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
          // Same problem, same fix, for the durable layer — and worse if missed: a spoken range
          // reappears on the next sentence, but a user highlight would simply be gone until the
          // book was reopened.
          repaintUserHighlights();
        })
        .catch((error: unknown) => {
          fail('NAVIGATION_FAILED', error);
        });
      return;
    }

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
    // Guarded on `bg` so a font-size or spread change does not detach and re-attach every
    // annotation in the chapter for a colour that did not move. The PDF shell needs no guard — its
    // repaint is a `replaceChildren` over a handful of divs it re-measures anyway.
    if (previousBg !== appearance.bg) retintUserHighlights();
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
          result: { status: 'error', message: error instanceof Error ? error.message : String(error) },
        });
      }
    })();
  },

  /**
   * Paint or clear the spoken-sentence highlight, through the owner-namespaced seam so this can never
   * collide with another feature's `rendition.annotations` use (see highlightSeam.ts). Fire-and-forget
   * and best-effort, matching `ReaderTextProvider.setSpokenRange`'s own contract: a highlight that
   * cannot be painted must not be able to interrupt speech, so this never posts a message and never
   * throws out of the try.
   */
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
    applyUserHighlights(mine);

    if (foreign > 0) {
      fail(
        'NAVIGATION_FAILED',
        `paintHighlights: ${String(foreign)} highlight(s) address pages, and this shell renders EPUB`,
      );
    }
  },

  setSpokenRange: (cfi) => {
    try {
      if (!rendition) return;
      if (currentSpokenCfi !== null) highlightRemove(rendition, TTS_OWNER, currentSpokenCfi);
      currentSpokenCfi = cfi;
      if (cfi !== null) highlightAdd(rendition, TTS_OWNER, cfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
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
