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

import type { LayoutPrefs } from '@/shared/contracts';
import { DEFAULT_PREFS } from '@/shared/contracts';

export type ReaderFlow = LayoutPrefs['flow'];

/**
 * The rendition flow default, until `applyAppearance` supplies a real one.
 *
 * Everything pagination-specific below keys off `isPaginated()`. `scrolled-doc` needs no line grid
 * (no page edges to slice a line) and no column breaks (no columns).
 *
 * Derived from the contract rather than restated: `'paginated'` is `DEFAULT_PREFS.layout.flow`.
 */
export const READER_FLOW = DEFAULT_PREFS.layout.flow;

/**
 * `flow` defaults to `READER_FLOW` rather than being required everywhere, so every existing call
 * site (and every existing test) keeps working unchanged while the entry — the one place `flow` can
 * actually change live — passes the current value explicitly.
 */
export function isPaginated(flow: ReaderFlow = READER_FLOW): boolean {
  return flow === 'paginated';
}

/**
 * `size` is 16 under a contract comment reading "units not yet agreed (pt vs scale factor)". Treated
 * as px at the reference width below — 16px is plainly the UA default it came from. Settling that
 * unit is Personalization's call.
 *
 * These three are the PRE-PAYLOAD fallback `readerMetrics`/`baselineCss` use before the first
 * `applyAppearance` arrives (it is sent after `ready`, and prefs are an async read) — not dead code
 * once prefs are live, still the value a book paints at if that read is slow or fails.
 */
const BASELINE_FONT_SIZE_PX = DEFAULT_PREFS.typography.size;
const BASELINE_LINE_HEIGHT = DEFAULT_PREFS.typography.lineHeight;
const BASELINE_MARGIN_PX = DEFAULT_PREFS.typography.margins;

/** The typography inputs `readerMetrics` scales — the slice of `ReaderAppearance` this module needs,
 * not the whole payload, so this file stays ignorant of the personalization type. */
export interface TypographyInput {
  fontSizePt: number;
  lineHeight: number;
  marginPx: number;
}

const DEFAULT_TYPOGRAPHY: TypographyInput = {
  fontSizePt: BASELINE_FONT_SIZE_PX,
  lineHeight: BASELINE_LINE_HEIGHT,
  marginPx: BASELINE_MARGIN_PX,
};

/**
 * The width `fontSizePt` is calibrated for (a 393pt iPhone), and the range the VIEWPORT FACTOR is
 * held inside — not the resulting px. Type scales WITH the viewport rather than being fixed, but
 * proportional scaling alone would give a 34px body on an iPad and 13px on the smallest phone, so
 * the clamp is what keeps it a reading size on both.
 *
 * >>> CLAMP THE FACTOR, NOT THE PRODUCT. <<< A prior version clamped the scaled PX result to
 * [15, 22], which silently re-capped exactly the accessibility user this feature is for: a chosen
 * `fontSizePt` above the old ceiling collapsed to 22px regardless of how deliberately it was set.
 * Clamping the viewport factor instead means a legitimate large `fontSizePt` still scales past 22px
 * on a narrow phone, while an absurd one (see ABSOLUTE_*_FONT_PX below) is still caught.
 *
 * These four are Reader's own numbers, not a preference, so they stay literals. 0.94/1.375 are
 * chosen so this clamp is a no-op at the DEFAULT_TYPOGRAPHY font size: `round(16 * 0.94) === 15` and
 * `round(16 * 1.375) === 22`, the same bounds the old product clamp produced.
 */
const REFERENCE_VIEWPORT_WIDTH_PX = 393;
const MIN_VIEWPORT_FACTOR = 0.94;
const MAX_VIEWPORT_FACTOR = 1.375;

/**
 * A pathological-value guard, not a design bound. `fontSizePt` arrives from prefs uncomposed with
 * any clamp of its own (composeFontSizePt() is deliberately unclamped — see readerAppearance.ts), so
 * a corrupt or absurd stored value must not reach the line-grid arithmetic below unchecked.
 */
const ABSOLUTE_MIN_FONT_PX = 8;
const ABSOLUTE_MAX_FONT_PX = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * `marginPx` is user-supplied and, unlike the font size, feeds directly into `padTop`/`padBottom`
 * arithmetic rather than through a scaling factor — an adversarial value (or simply a generous one on
 * a small viewport) can drive `padBottom` negative once `lines` floors to its minimum of 1. Capping
 * it at a quarter of the viewport height keeps room for at least one line box regardless of height.
 */
function clampMargin(marginPx: number, height: number): number {
  return clamp(marginPx, 0, Math.floor(height / 4));
}

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
export function readerMetrics(
  width: number,
  height: number,
  typography: TypographyInput = DEFAULT_TYPOGRAPHY,
  flow: ReaderFlow = READER_FLOW,
): ReaderMetrics {
  const viewportFactor = clamp(
    width / REFERENCE_VIEWPORT_WIDTH_PX,
    MIN_VIEWPORT_FACTOR,
    MAX_VIEWPORT_FACTOR,
  );
  const scaled = Math.round(typography.fontSizePt * viewportFactor);
  const fontPx = clamp(scaled, ABSOLUTE_MIN_FONT_PX, ABSOLUTE_MAX_FONT_PX);
  const linePx = Math.round(fontPx * typography.lineHeight);
  const marginPx = clampMargin(typography.marginPx, height);

  if (!isPaginated(flow)) {
    // No page edge to slice a line, so no quantisation — just even margins.
    return {
      fontPx,
      linePx,
      padTop: marginPx,
      padBottom: marginPx,
      lines: 0,
    };
  }

  const padTop = marginPx;
  const lines = Math.max(1, Math.floor((height - padTop - marginPx) / linePx));

  return {
    fontPx,
    linePx,
    padTop,
    // The remainder, so padTop + lines * linePx + padBottom === height exactly, EXCEPT when a
    // pathological linePx (an extreme fontSizePt/lineHeight combination the guards above did not
    // fully rule out) does not fit even once — floored at 0 rather than going negative.
    padBottom: Math.max(0, height - padTop - lines * linePx),
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
 * `fontFamily`/`fg`/`bg`/`link`/`letterSpacingPx` are the prefs-application override: `''`/0/absent
 * means "leave the book's own choice alone", matching the baseline's original stance. `fontFamily`
 * must already be sanitised (see `sanitizeFontFamily` below) — this function formats trusted CSS
 * text, it does not validate it. `text-align` stays unset regardless — justification is a preference
 * this payload does not currently carry.
 */
export interface AppearanceCssOptions {
  fg?: string;
  bg?: string;
  link?: string;
  /** Already sanitised by the caller. `''` or absent means "don't override". */
  fontFamily?: string;
  letterSpacingPx?: number;
}

export function baselineCss(
  m: ReaderMetrics,
  appearance: AppearanceCssOptions = {},
  flow: ReaderFlow = READER_FLOW,
): string {
  const f = m.fontPx;
  const l = m.linePx;
  const { fg, bg, link, fontFamily, letterSpacingPx } = appearance;

  let css: string[] = [
    // The iframe inherits nothing from the host document, so the host's own -webkit-text-size-adjust
    // does not reach it. Without this, WKWebView inflates text inside a fixed-height column:
    // clipped rows, phantom pages.
    'html, body {',
    '  -webkit-text-size-adjust: 100% !important;',
    '  text-size-adjust: 100% !important;',
    ...(bg ? [`  background: ${bg} !important;`] : []),
    '}',
    'body {',
    `  font-size: ${f}px !important;`,
    `  line-height: ${l}px !important;`,
    `  padding-top: ${m.padTop}px !important;`,
    `  padding-bottom: ${m.padBottom}px !important;`,
    ...(fg ? [`  color: ${fg} !important;`] : []),
    ...(fontFamily ? [`  font-family: ${fontFamily}, sans-serif !important;`] : []),
    // 0 is the default and is omitted entirely, per the same "don't restate the default" reasoning
    // as the spacing note used to give — a rule set to its own default only adds a declaration for a
    // real book's CSS to lose to.
    ...(letterSpacingPx ? [`  letter-spacing: ${letterSpacingPx}px !important;`] : []),
    // No hyphenation and no mid-word wrapping: a word broken across a page boundary is the thing
    // that reads as broken. Long unbreakable tokens are handled below, where they actually occur,
    // rather than by letting every word in the book break.
    '  hyphens: none !important;',
    '  -webkit-hyphens: none !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: normal !important;',
    '}',
    ...(link ? [`a { color: ${link} !important; }`] : []),
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

  if (isPaginated(flow)) {
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
 * Chars a CSS font-family value may contain, once quoted names are handled below. `fontFamily`
 * arrives from prefs — a user-supplied string reaching CSS text via `baselineCss` — so this is the
 * allow-list that stands between it and a stylesheet-injection payload (`"; } body { ... `). Anything
 * outside it, or an empty/all-whitespace result, sanitises to `''` — the same "don't override"
 * value `resolveFont()` already uses for a blank preference, not a broken CSS rule.
 */
const FONT_FAMILY_ALLOWED = /^[A-Za-z0-9 ,-]*$/;

export function sanitizeFontFamily(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || !FONT_FAMILY_ALLOWED.test(trimmed)) return '';

  const families = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    // CSS requires quoting a family name that contains a space (e.g. `"Times New Roman"`); a
    // single-word name is valid unquoted.
    .map((part) => (part.includes(' ') ? `"${part}"` : part));

  return families.join(', ');
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
 * Does a computed `column-count` mean "this element authors its own multi-column layout"?
 *
 * The computed value is either `'auto'` (no author columns) or a positive integer as a string.
 * `Number.parseInt` on `'auto'` is `NaN`, which fails the finite check — no separate string
 * comparison needed. 1 does not count: a book that explicitly sets `column-count: 1` is not
 * fighting our pagination, so there is nothing to detect.
 */
export function isMultiColumnCount(value: string): boolean {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count >= 2;
}

/**
 * The horizontal margin cap, as a fraction of the viewport width, past which a book's own
 * margin-left/margin-right reads as a print-layout artifact rather than an intentional indent.
 *
 * WHY THIS EXISTS: Calibre's PDF-to-EPUB conversion often has no better way to represent a print
 * page's original horizontal position than a hardcoded margin in em, commonly on generated classes
 * (`applyAuthoredBreaks`'s own note explains why those exist) — anywhere from a couple of em (a
 * genuine indent, a blockquote or a nested list) up to 20+ em (a print-page x-offset sized for a
 * desktop-width column, seen verbatim in a real fixture: `.calibre27 { margin: 1em 0 1em 20em; }`).
 * On a phone-width text column the latter consumes most or all of the available width, which reads
 * as "the book has weird extra spacing" rather than as the indent it is. 0.2 leaves visible room for
 * a real indent while catching the artifact.
 */
const MAX_INDENT_FRACTION = 0.2;

/** Does an authored margin exceed the cap for this viewport? */
export function isExcessiveIndent(marginPx: number, viewportWidthPx: number): boolean {
  return Number.isFinite(marginPx) && marginPx > viewportWidthPx * MAX_INDENT_FRACTION;
}

/** The margin to use instead, when `isExcessiveIndent(...)` is true. */
export function cappedIndent(viewportWidthPx: number): number {
  return viewportWidthPx * MAX_INDENT_FRACTION;
}

/**
 * Collapses an author-declared multi-column layout back to one column, everywhere in the chapter.
 *
 * WHY THIS HAS TO EXIST: our own pagination IS a CSS column context — WebKit fragments the body
 * into columns and epub.js calls each fragment a "page" (see READER_FLOW). A book that ALSO sets
 * `column-count` on its own content nests one column context inside the other. Nested columns are
 * valid CSS, but WebKit fills the inner columns top-to-bottom-then-across before it lets the outer
 * (our page) column fragment run — so text several book-columns "ahead" can render before the rest
 * of the current page, which reads as pages arriving out of spine order. Forcing every descendant
 * back to one column removes the inner context entirely, leaving our page column as the only one,
 * which is what keeps `next()`/`prev()` and CFI order matching what is on screen.
 *
 * `body *` rather than just `body`: the book can author columns on any wrapper, not only the root,
 * and `applyAuthoredBreaks` already shows Calibre-style books put such rules on generated classes
 * rather than a selector worth guessing.
 */
export function columnOverrideCss(): string {
  return [
    'body, body * {',
    '  column-count: 1 !important;',
    '  -webkit-column-count: 1 !important;',
    '  column-width: auto !important;',
    '  -webkit-column-width: auto !important;',
    '  columns: auto !important;',
    '}',
  ].join('\n');
}

/**
 * Deepest nesting the flattener will mark. Anything deeper is flattened ONTO the cap rather than
 * dropped: no entry ever disappears, its indent just stops growing.
 *
 * Imported from readerBridge.ts rather than restated — the other copy this conversion deleted.
 */
export { MAX_TOC_DEPTH } from '@/features/reader/readerBridge';
