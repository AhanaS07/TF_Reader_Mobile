// Owner: Reader (Ahana).
//
// The EPUB shell's typographic arithmetic and stylesheet, as pure functions of their arguments.
// No DOM access anywhere in this file — that is what lets readerMetrics.test.ts import and CALL it
// rather than lifting a region out of an .html file and running it through `new Function`, which is
// what the coverage here used to require.
//
// >>> THE THREE TYPOGRAPHY CONSTANTS ARE NOW IMPORTED, NOT COPIED. <<<
// Before the typechecked-WebView conversion they were hand-written literals with a test grepping the
// template to prove they still equalled `DEFAULT_PREFS.typography`. WEBVIEW_BRIDGE.md's own note on
// trigger 3 says this inversion is the correct move once the WebView is a `tsc` consumer: a
// re-declared value silently tolerates the contract changing underneath it, an indexed access does
// not. So there is no copy left to drift, and no grep left to maintain.
//
// This is NOT trigger 3. Trigger 3 is about a frozen contract crossing the BRIDGE as a payload;
// nothing here is sent or received. These are compile-time reads of a constant, resolved before the
// shell is even built.

import { DEFAULT_PREFS } from '@/shared/contracts';

/**
 * The rendition flow, in ONE place.
 *
 * Everything pagination-specific below keys off `isPaginated()`, so when `LayoutPrefs.flow` starts
 * arriving over the bridge this constant becomes the value it sets and the guarded blocks are the
 * only things that change. `scrolled-doc` needs no line grid (no page edges to slice a line) and no
 * column breaks (no columns).
 *
 * Derived from the contract rather than restated: `'paginated'` is `DEFAULT_PREFS.layout.flow`, and
 * this is the reader's default until a preference overrides it.
 */
export const READER_FLOW = DEFAULT_PREFS.layout.flow;

export function isPaginated(): boolean {
  return READER_FLOW === 'paginated';
}

/**
 * `size` is 16 under a contract comment reading "units not yet agreed (pt vs scale factor)". Treated
 * as px at the reference width below — 16px is plainly the UA default it came from. Settling that
 * unit is Personalization's call.
 *
 * `spacing` (letter/word spacing) is deliberately unused: it defaults to 0, and a rule setting a
 * property to its own default only adds another declaration for a real book's CSS to lose to.
 */
const BASELINE_FONT_SIZE_PX = DEFAULT_PREFS.typography.size;
const BASELINE_LINE_HEIGHT = DEFAULT_PREFS.typography.lineHeight;
const BASELINE_MARGIN_PX = DEFAULT_PREFS.typography.margins;

/**
 * The width `BASELINE_FONT_SIZE_PX` is calibrated for (a 393pt iPhone), and the range the scaled
 * result is held inside. Type scales WITH the viewport rather than being fixed, but proportional
 * scaling alone would give a 34px body on an iPad and 13px on the smallest phone, so the clamp is
 * what keeps it a reading size on both.
 *
 * These three are Reader's own numbers, not a preference, so they stay literals.
 */
const REFERENCE_VIEWPORT_WIDTH_PX = 393;
const MIN_FONT_SIZE_PX = 15;
const MAX_FONT_SIZE_PX = 22;

export interface ReaderMetrics {
  fontPx: number;
  linePx: number;
  padTop: number;
  padBottom: number;
  lines: number;
}

/**
 * Every number the stylesheet needs, derived from the viewport.
 *
 * THE LINE GRID IS THE POINT, and it is why these are integers. In paginated flow the text column is
 * a fixed height, so unless that height is an exact whole number of line boxes the last line on
 * every page is sliced through the middle — the top half of a row of words on one page and the
 * bottom half on the next. It reads as a rendering bug and it is really just arithmetic: quantise
 * the column to floor(available / lineHeight) lines and put the remainder into padding-bottom.
 *
 * That only holds if EVERY line box is a whole multiple of `linePx`, which is what forces the
 * heading line-heights and block margins in `baselineCss()` to be multiples of it too, and
 * `line-height: 0` on sup/sub. A fractional line-height (1.5 unitless against an odd font size)
 * would break the grid on its own, hence the rounding here rather than in CSS.
 *
 * Images are the honest exception: an arbitrary-height figure knocks the text after it off the grid
 * until the next page. Bounding them to the page (max-height) limits that to one page rather than
 * fixing it.
 */
export function readerMetrics(width: number, height: number): ReaderMetrics {
  const scaled = Math.round((BASELINE_FONT_SIZE_PX * width) / REFERENCE_VIEWPORT_WIDTH_PX);
  const fontPx = Math.min(Math.max(scaled, MIN_FONT_SIZE_PX), MAX_FONT_SIZE_PX);
  const linePx = Math.round(fontPx * BASELINE_LINE_HEIGHT);

  if (!isPaginated()) {
    // No page edge to slice a line, so no quantisation — just even margins.
    return {
      fontPx,
      linePx,
      padTop: BASELINE_MARGIN_PX,
      padBottom: BASELINE_MARGIN_PX,
      lines: 0,
    };
  }

  const padTop = BASELINE_MARGIN_PX;
  const lines = Math.max(1, Math.floor((height - padTop - BASELINE_MARGIN_PX) / linePx));

  return {
    fontPx,
    linePx,
    padTop,
    // The remainder, so padTop + lines * linePx + padBottom === height exactly. Never smaller than
    // BASELINE_MARGIN_PX, because `lines` floored first.
    padBottom: height - padTop - lines * linePx,
    lines,
  };
}

/**
 * The reader's stylesheet, as CSS text.
 *
 * WHY CSS TEXT AND NOT rendition.themes: `Contents.addStylesheetCss` REPLACES the <style> node it
 * owns (contents.js:750-757), so re-applying on every rotation is idempotent, where themes' rule
 * form appends. Themes also cannot carry this at all — `Themes.inject()` checks `theme.rules` and
 * `theme.url` and never `theme.serialized` (themes.js:161-166), so a CSS-text theme is applied to
 * the chapters already loaded and silently skipped for every chapter loaded after. Registering our
 * own hooks.content handler avoids both.
 *
 * WHY SO MUCH `!important`: two different fights.
 *  1. epub.js sets padding-top/bottom as an INLINE style during pagination (contents.js:1085-1086),
 *     and an inline declaration beats a stylesheet rule unless that rule is !important.
 *     padding-left/right it sets inline AND important, so those are not ours to set — the horizontal
 *     margin is epub.js's `gap` (renderTo's option), not this file's.
 *  2. The BOOK's own CSS. "The text size keeps changing" is not a bug in the reader — it is the
 *     book: the 20 MB fixture ships 11 distinct em-based font-sizes on .calibreN classes, and em
 *     compounds through nesting, so a paragraph inside two scaled wrappers lands somewhere nobody
 *     chose. Overriding by element type loses to a class on specificity, so a uniform size has to be
 *     forced. A deliberate trade: the book's typographic intent is discarded in exchange for one
 *     predictable size, and it becomes a preference at the prefs stage.
 *
 * NOT set here, on purpose: font-family (books ship their own; overriding is FontPrefs, not a
 * baseline) and text-align (justification is a preference and a bad default on a narrow column).
 */
export function baselineCss(m: ReaderMetrics): string {
  const f = m.fontPx;
  const l = m.linePx;

  let css: string[] = [
    // The iframe inherits nothing from the host document, so the host's own -webkit-text-size-adjust
    // does not reach it. Without this, WKWebView inflates text inside a fixed-height column:
    // clipped rows, phantom pages.
    'html, body {',
    '  -webkit-text-size-adjust: 100% !important;',
    '  text-size-adjust: 100% !important;',
    '}',
    'body {',
    `  font-size: ${f}px !important;`,
    `  line-height: ${l}px !important;`,
    `  padding-top: ${m.padTop}px !important;`,
    `  padding-bottom: ${m.padBottom}px !important;`,
    // No hyphenation and no mid-word wrapping: a word broken across a page boundary is the thing
    // that reads as broken. Long unbreakable tokens are handled below, where they actually occur,
    // rather than by letting every word in the book break.
    '  hyphens: none !important;',
    '  -webkit-hyphens: none !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: normal !important;',
    '}',
    // One size for every text-bearing element. `div` and `span` are in the list because
    // Calibre-converted books put their scaling on wrappers.
    'p, div, span, li, dd, dt, td, th, blockquote, figcaption, caption, address {',
    `  font-size: ${f}px !important;`,
    `  line-height: ${l}px !important;`,
    '}',
    // Raised/lowered glyphs must not grow the line box, or the grid drifts by a fraction of a line
    // on every citation marker — and the test fixture is full of them. line-height: 0 is the
    // standard way to hold the rhythm.
    'sup, sub {',
    `  font-size: ${Math.round(f * 0.75)}px !important;`,
    '  line-height: 0 !important;',
    '}',
    // Heading scale. Sizes step by a fixed ratio; line-heights snap to whole multiples of the grid
    // unit rather than to the font size.
    'h1 {',
    `  font-size: ${Math.round(f * 1.6)}px !important;`,
    `  line-height: ${2 * l}px !important;`,
    '}',
    'h2 {',
    `  font-size: ${Math.round(f * 1.35)}px !important;`,
    `  line-height: ${2 * l}px !important;`,
    '}',
    'h3 {',
    `  font-size: ${Math.round(f * 1.15)}px !important;`,
    `  line-height: ${l}px !important;`,
    '}',
    'h4, h5, h6 {',
    `  font-size: ${f}px !important;`,
    `  line-height: ${l}px !important;`,
    '}',
    // Vertical rhythm: every block gap is one grid unit, top margins zeroed so adjacent blocks
    // collapse to exactly one rather than to an odd sum.
    'p, ul, ol, dl, blockquote, figure, table, pre, hr {',
    '  margin-top: 0 !important;',
    `  margin-bottom: ${l}px !important;`,
    '}',
    'h1, h2, h3, h4, h5, h6 {',
    `  margin-top: ${l}px !important;`,
    `  margin-bottom: ${l}px !important;`,
    '}',
    // Bound to the page, forced: a figure wider than the column is clipped and one taller than the
    // page pushes a blank page after itself, and neither is recoverable by the reader. max-height
    // resolves against the body height epub.js sets during pagination, which is what makes 100%
    // mean "one page".
    'img, svg, video {',
    '  max-width: 100% !important;',
    '  max-height: 100% !important;',
    '  height: auto !important;',
    '}',
    // Where long unbreakable tokens really live. Scoped so prose is unaffected.
    'a, code, pre, kbd, samp, tt {',
    '  overflow-wrap: break-word !important;',
    '}',
  ];

  if (isPaginated()) {
    css = css.concat([
      // Keep a figure or table whole rather than sliced by a page edge.
      'figure, table, img, svg {',
      '  break-inside: avoid;',
      '  -webkit-column-break-inside: avoid;',
      '}',
      // A heading alone at the foot of a page, its text on the next one.
      'h1, h2, h3, h4, h5, h6 {',
      '  break-after: avoid;',
      '  -webkit-column-break-after: avoid;',
      '}',
    ]);
  }

  return css.join('\n');
}

/**
 * Does a computed break value mean "force a break here"?
 *
 * Covers the CSS3 `break-*` vocabulary and the legacy `page-break-*` one that EPUB CSS is actually
 * written in, including the recto/verso spellings.
 */
export function isForcedBreak(value: string): boolean {
  return (
    value === 'always' ||
    value === 'page' ||
    value === 'left' ||
    value === 'right' ||
    value === 'recto' ||
    value === 'verso'
  );
}

/**
 * Deepest nesting the flattener will mark. Anything deeper is flattened ONTO the cap rather than
 * dropped: no entry ever disappears, its indent just stops growing.
 *
 * Imported from readerBridge.ts rather than restated — the other copy this conversion deleted.
 */
export { MAX_TOC_DEPTH } from '@/features/reader/readerBridge';
