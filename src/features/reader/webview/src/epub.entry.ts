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
import type { ReaderAnchor } from '@/features/reader/readerBridge';

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
import { diffHighlights, epubHighlights } from './highlightPaint';
import { add as highlightAdd, remove as highlightRemove } from './highlightSeam';
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

/**
 * TTS's channel from HIGHLIGHT_LAYERS.md §3: a TRANSLUCENT overlay, so a user highlight and a search
 * box beneath it stay legible while a word is being spoken.
 *
 * SVG PRESENTATION ATTRIBUTES, not CSS declarations — this used to read
 * `{ backgroundColor: 'rgba(255, 213, 0, 0.4)' }`, which marks-pane applies as
 * `setAttribute('backgroundColor', ...)` on an `<svg><g>` and which therefore did nothing at all.
 * See highlightSeam.ts's header for the other half of why nothing was painted.
 */
const TTS_SPOKEN_STYLES: Record<string, string> = {
  fill: '#ffd500',
  'fill-opacity': '0.4',
  'mix-blend-mode': 'multiply',
};

const USER_OWNER = 'user';
const USER_SAVED_VARIANT = 'saved';

/**
 * The user layer's channel from HIGHLIGHT_LAYERS.md §3: a SOLID fill in the highlight's own colour.
 *
 * `fill-opacity: 1` with `mix-blend-mode: multiply` is what makes "solid" and "the text is still
 * readable" the same thing — multiply darkens the page towards the fill colour instead of covering
 * the glyphs, which is how a physical highlighter behaves and why epub.js's own default uses it.
 * A flat opaque rect over the text would be solid and unreadable.
 *
 * `fill` is filled in per highlight from its stored colour; everything else is fixed.
 */
function userHighlightStyles(color: string): Record<string, string> {
  return { fill: color, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' };
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
 * The painted highlight under the finger for the CURRENT gesture, set by the seam's press callback
 * (epub.js wires it to `touchstart`, and marks-pane hit-tests the touch point against each mark's
 * own rects — so this is already "is the finger inside the highlight", one word's worth included).
 *
 * Read only by the long-press timer, and cleared at every `touchstart`, so a stale id from an
 * earlier gesture can never be what a later press deletes.
 */
let pressedHighlightId: string | null = null;

/**
 * Set once a long press has claimed the gesture for DELETE, suppressing the create offer for the
 * rest of it.
 *
 * Needed because WebKit does two things at once on a long press over highlighted text: it selects
 * the word (which epub.js reports as `selected` 250ms later) AND the press lands inside a painted
 * highlight. Both are true, but only one menu can be right, and the reader pressing on something
 * they already highlighted means the highlight — offering to create a second one over the top of it
 * would be a menu that cannot do the thing they asked for.
 */
let suppressSelectionOffer = false;

/** A chapter document's own client coordinates -> the WebView viewport's.
 *
 * The chapter lives in an iframe, so everything the inner document measures is relative to the
 * iframe's box. The host places its menu in the WebView's viewport, which is the OUTER document's —
 * so an anchor has to cross that boundary, and a selection near the bottom of a chapter would
 * otherwise anchor a menu near the top of the screen. */
function frameOffset(view: Window): { left: number; top: number } {
  const rect = view.frameElement?.getBoundingClientRect();
  return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
}

/** The current selection's bounding box in WebView viewport coordinates, or null if there is none. */
function selectionAnchor(contents: Contents): ReaderAnchor | null {
  const view = contents.document.defaultView;
  const selection = view?.getSelection();
  if (!view || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const offset = frameOffset(view);
  return {
    x: rect.left + offset.left,
    y: rect.top + offset.top,
    width: rect.width,
    height: rect.height,
  };
}

function cancelLongPress(): void {
  if (longPressTimer) window.clearTimeout(longPressTimer);
  longPressTimer = 0;
}

/**
 * The long press fired: if the finger is on a painted highlight, offer to delete it.
 *
 * NOTHING TO DO IN THE OTHER CASE, and that is deliberate rather than an omission — over plain text
 * WebKit's own selection is what the press produces, and epub.js reports it as `selected` a moment
 * later. Racing it with a synthetic selection of our own would give the reader two different ideas
 * of what they had selected.
 */
function onLongPress(view: Window): void {
  longPressFired = true;
  if (pressedHighlightId === null || !touchOrigin) return;

  suppressSelectionOffer = true;
  const offset = frameOffset(view);
  post({
    type: 'highlightPressed',
    id: pressedHighlightId,
    // A zero-sized box AT THE FINGER, not the highlight's own rect: a highlight can run several
    // lines and start off screen, so its bounding box is a poor thing to point a menu at, where the
    // touch is exactly where the reader is looking.
    anchor: { x: touchOrigin.x + offset.left, y: touchOrigin.y + offset.top, width: 0, height: 0 },
  });
}

/**
 * Wire one chapter document for touch.
 *
 * Registered from the content hook, so it lands on EVERY chapter — a book is many documents, and
 * listeners on the first one would stop working after the first chapter boundary, the same trap
 * `insertStylesheet` is called from here for.
 *
 * REGISTERED BEFORE marks-pane's OWN `touchstart` LISTENER, and that ordering is load-bearing:
 * marks-pane attaches its proxy when the first highlight is painted, which is always after a chapter
 * has loaded, so `touchstart` here always runs first and clears `pressedHighlightId` before the seam
 * callback sets it for this gesture.
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
      suppressSelectionOffer = false;
      pressedHighlightId = null;
      longPressTimer = window.setTimeout(() => {
        onLongPress(view);
      }, LONG_PRESS_MS);
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

  /**
   * Report when a chapter's selection goes away.
   *
   * >>> WHY epub.js's OWN EVENT IS NOT ENOUGH. <<< `rendition.on('selected')` fires only for a
   * non-collapsed selection, so it says "something is selected" and never "nothing is any more". The
   * host needs both: the menu it puts on screen has to disappear the moment the reader taps
   * elsewhere, or it will offer to highlight text that is no longer selected.
   */
  doc.addEventListener(
    'selectionchange',
    () => {
      const selection = view.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        post({ type: 'selection', selection: null, anchor: null });
      }
      // A non-collapsed selection is deliberately NOT reported from here — epub.js's own debounced
      // `selected` event is what carries it, and posting from both would race: this listener fires
      // on every drag frame, its rival fires 250ms later, and the host would flicker.
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

    highlightAdd(
      active,
      USER_OWNER,
      cfiRange,
      USER_SAVED_VARIANT,
      userHighlightStyles(highlight.color),
      // PRESS-TO-DELETE, BY STORED ID. epub.js wires this to `touchstart`, and marks-pane only
      // dispatches it when the touch point is inside one of THIS mark's own rects — so it is already
      // "the finger is in this highlight", one word's worth included. It records rather than posts:
      // a touch is not yet a press, and the long-press timer decides (`onLongPress`). The id is
      // closed over from the payload that painted this rect, so nothing has to re-match a range
      // against a selection afterwards — the fragile thing READER_HIGHLIGHTS_WIRING.md rules out.
      //
      // Guarded on a gesture actually being in progress: the same callback is wired to `click`, and
      // a click with no touch behind it would otherwise leave an id set for a later press to find.
      () => {
        if (touchOrigin !== null) pressedHighlightId = highlight.id;
      },
    );
    paintedUserHighlights.set(highlight.id, cfiRange);
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
  });

  // Rotation changes the type size AND the line-grid remainder, so a sheet built for portrait
  // leaves sliced lines in landscape. epub.js already re-lays out and re-displays the current CFI
  // on resize; this is the stylesheet half of it.
  rendition.on('resized', () => {
    applyBaselineCss();
  });

  /**
   * The user finished making a selection.
   *
   * epub.js reports it as ONE range CFI and fires only for a NON-COLLAPSED selection (its `Contents`
   * debounces `selectionchange` by 250ms and drops collapsed ranges) — so this event is the "there
   * is something to highlight" half only, and `watchSelectionClears` below is the other half.
   *
   * Split into two point CFIs here rather than host-side because the range form is epub.js's dialect
   * and nothing outside this shell should have to know it: `addEpubHighlight` takes two locators.
   * See epubCfiRange.ts.
   */
  rendition.on('selected', (cfiRange: string, contents: Contents) => {
    // The gesture already claimed a highlight to DELETE — see `suppressSelectionOffer`. WebKit
    // selected the word as well, but only one menu can be right.
    if (suppressSelectionOffer) return;

    const ends = splitCfiRange(cfiRange);
    // Not a range (a collapsed CFI, or a shape this parser does not recognise) is not a selection
    // anyone can highlight. Silent: epub.js emits this on every drag, so a malformed one is noise,
    // not an event worth a coded error.
    if (ends === null) return;

    const anchor = selectionAnchor(contents);
    // No measurable box means nothing to point a menu at, and the host refuses a selection without
    // one (see `parseReaderMessage`). Dropped here rather than sent to be dropped there.
    if (anchor === null) return;

    post({
      type: 'selection',
      selection: { kind: 'cfiRange', startCfi: ends.startCfi, endCfi: ends.endCfi },
      anchor,
    });
  });

  rendition.on('relocated', (location: { start?: { cfi?: string }; atStart?: boolean; atEnd?: boolean }) => {
    lastCfi = location?.start?.cfi ?? null;

    // A page turn drops whatever was selected — the view it lived in is no longer on screen. Told
    // explicitly rather than left to the host to infer from the navigation, so the "Highlight"
    // affordance can never outlive the words it would act on.
    post({ type: 'selection', selection: null, anchor: null });

    post({
      type: 'relocated',
      // A CFI, not a page: this book is reflowable, so there is no stable page to report. That is
      // the whole reason ReaderPosition is discriminated by format rather than carrying both shapes
      // flat with one of them always null.
      position: { kind: 'cfi', cfi: lastCfi },
      atStart: !!location?.atStart,
      atEnd: !!location?.atEnd,
    });
  });

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
            highlightAdd(rendition, TTS_OWNER, currentSpokenCfi, TTS_SPOKEN_VARIANT, TTS_SPOKEN_STYLES);
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
      if (cfi !== null) highlightAdd(rendition, TTS_OWNER, cfi, TTS_SPOKEN_VARIANT, TTS_SPOKEN_STYLES);
    } catch {
      // Best-effort, per the interface's own contract — swallowed rather than reported.
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
