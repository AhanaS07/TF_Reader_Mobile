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

import {
  base64ToArrayBuffer,
  fail,
  installErrorHandlers,
  post,
  publish,
  type TFReaderApi,
} from './bridge';
import { flattenToc, type NavItem } from './epubOutline';
import {
  baselineCss,
  columnOverrideCss,
  isForcedBreak,
  isMultiColumnCount,
  isPaginated,
  READER_FLOW,
  readerMetrics,
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
 * the one appearance change that needs epub.js to re-layout rather than just re-style. */
let lastCfi: string | null = null;

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
  return {
    fg: currentAppearance.fg,
    bg: currentAppearance.bg,
    link: currentAppearance.link,
    fontFamily: sanitizeFontFamily(currentAppearance.fontFamily),
    letterSpacingPx: currentAppearance.letterSpacingPx,
  };
}

/** `'single'`/`'double'` -> epub.js's own vocabulary. `'double'` is inert under epub.js's
 * `minSpreadWidth` (800) on phone widths — expected, not a bug to chase. */
function mapSpread(spread: ReaderAppearance['spread']): 'none' | 'auto' {
  return spread === 'double' ? 'auto' : 'none';
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
  return isPaginated() && hasAuthoredColumns(doc)
    ? `${currentCss}\n${columnOverrideCss()}`
    : currentCss;
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
        const buffer = base64ToArrayBuffer(base64);
        book = ePub();

        // 'binary' is explicit rather than inferred. epub.js's determineType() would return BINARY
        // for any non-string anyway, but naming it means a future change of input shape fails loudly
        // instead of being silently re-detected as a URL.
        await book.open(buffer, 'binary');

        rendition = book.renderTo('viewer', {
          // The current appearance's flow/spread if applyAppearance already landed (the host sends
          // it before openEpub), falling back to the pre-payload default otherwise — see
          // currentAppearance's own note.
          flow: currentFlow(),
          // '100%' AS STRINGS, NOT NUMBERS — this is what makes the reader survive a rotation.
          // Stage.onResize only attaches a window resize listener when width/height are NOT numeric
          // (stage.js:147-153), and that listener is the whole of our resize handling: it lands in
          // Rendition.onResized, which re-lays out and re-displays the current CFI
          // (rendition.js:479-481). Pass pixel numbers here and rotation silently stops re-flowing.
          // Pinned by readerTemplate.test.ts.
          width: '100%',
          height: '100%',
          // 'none' (single) keeps one page per screen; the default ('auto') shows two side-by-side
          // on wide screens, which makes next/prev look like it is skipping pages. Prefs-driven once
          // currentAppearance exists.
          spread: currentAppearance ? mapSpread(currentAppearance.spread) : 'none',
        });

        // BEFORE display(), deliberately. The hook is what inserts the stylesheet into each chapter
        // document as it loads, so registering it first means the first chapter is columnised with
        // the baseline already applied. Register it after and the first page paints at UA defaults
        // and then re-flows — a visible flash of the exact bug this fixes.
        //
        // One hook, both jobs, because both need the chapter's document and both must run for every
        // chapter rather than once per book.
        applyBaselineCss();
        rendition.hooks.content.register((contents: Contents) => {
          if (isPaginated()) applyAuthoredBreaks(contents.document);
          insertStylesheet(contents, finalCssFor(contents.document));
        });

        // Rotation changes the type size AND the line-grid remainder, so a sheet built for portrait
        // leaves sliced lines in landscape. epub.js already re-lays out and re-displays the current
        // CFI on resize; this is the stylesheet half of it.
        rendition.on('resized', () => {
          applyBaselineCss();
        });

        rendition.on('relocated', (location: { start?: { cfi?: string }; atStart?: boolean; atEnd?: boolean }) => {
          lastCfi = location?.start?.cfi ?? null;
          post({
            type: 'relocated',
            // A CFI, not a page: this book is reflowable, so there is no stable page to report. That
            // is the whole reason ReaderPosition is discriminated by format rather than carrying both
            // shapes flat with one of them always null.
            position: { kind: 'cfi', cfi: lastCfi },
            atStart: !!location?.atStart,
            atEnd: !!location?.atEnd,
          });
        });

        await rendition.display();
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
   * `flow` is the one change that needs epub.js to re-layout rather than just re-style: changing it
   * without re-displaying leaves the rendition paginating in the OLD mode against the NEW CSS.
   * Skipped when the flow is unchanged so an unrelated theme-only appearance update never triggers a
   * layout flash. `spread` needs no such guard — `rendition.spread()` is cheap and idempotent.
   */
  applyAppearance: (appearance) => {
    const previousFlow = currentAppearance?.flow;
    currentAppearance = appearance;
    applyBaselineCss();

    if (!rendition) return;

    rendition.spread(mapSpread(appearance.spread));

    if (previousFlow !== undefined && previousFlow !== appearance.flow) {
      rendition.flow(appearance.flow);
      rendition.display(lastCfi ?? undefined).catch((error: unknown) => {
        fail('NAVIGATION_FAILED', error);
      });
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
