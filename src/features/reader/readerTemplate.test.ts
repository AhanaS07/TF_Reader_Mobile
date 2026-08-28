// Owner: Reader (Ahana).
//
// Invariants of the reader shells that no compiler can see — and, since the typechecked-WebView
// conversion, ONLY those. Everything that could become a real function call did.
//
// WHAT MOVED, AND WHERE, so nobody re-adds a grep for it:
//
//   * The typographic arithmetic and the stylesheet are called directly below, imported from
//     webview/src/readerMetrics.ts. `templateModule()` — which lifted a text region out of the .html
//     and ran it through `new Function` — is gone, along with the boundary comments it depended on.
//   * The three DEFAULT_PREFS constants are no longer COPIED into the shell, so there is no copy to
//     pin. readerMetrics.ts imports them. What is asserted instead is that the metrics actually
//     USE them, which is what the pin was ever a proxy for.
//   * MAX_TOC_DEPTH is imported by both flatteners, so the "same value the host clamps to" test has
//     nothing left to compare — one value, one definition.
//   * The EPUB and PDF outline flatteners are unit-tested where they live:
//     webview/src/epubOutline.test.ts and webview/src/pdfOutline.test.ts. Those replace nine regexes
//     with tests that CALL the code, including cases (a malformed outline, an unresolvable
//     destination) no text search could express.
//
// WHAT LEGITIMATELY STAYS A SOURCE ASSERTION, and why each one cannot be a type:
//
//   1. The rendition settings whose VALUE TYPE, not value, is load-bearing — epub.js's resize
//      handling turns on width/height being non-numeric, which `tsc` is happy to let you get wrong.
//   2. ORDER of DOM-driving calls: the content hook must be registered before the first display().
//      A compiler cannot see a sequencing requirement.
//   3. The PDF shell's offline choices. pdf.js WANTS to fetch things — a worker script, cmaps,
//      standard font data — and every one is a sub-resource this document cannot make. These pin the
//      POSITIVE choices that keep it from needing one, which a URL check cannot see.
//   4. The HTML and CSS the entries query. A .ts file cannot carry `#fallback` or the text/plain
//      worker block, and the entry silently does nothing useful if either goes missing.
//   5. reduceMotion having nothing to suppress. That is an absence, and only a search can assert an
//      absence across both a stylesheet and its entry.

import * as fs from 'fs';
import * as path from 'path';

import {
  baselineCss,
  cappedIndent,
  columnOverrideCss,
  isExcessiveIndent,
  isForcedBreak,
  isMultiColumnCount,
  isPaginated,
  readerMetrics,
  sanitizeFontDataUri,
  sanitizeFontFamily,
} from '@/features/reader/webview/src/readerMetrics';
import { DEFAULT_PREFS } from '@/shared/contracts';

const webviewFile = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, 'webview', ...parts), 'utf8');

const TEMPLATE = webviewFile('reader-epub.template.html');
const PDF_TEMPLATE = webviewFile('reader-pdf.template.html');

/**
 * The entry SOURCES, for the handful of assertions that are about DOM-driving code.
 *
 * Read as text for the same reason the templates are: these are statements about call order and
 * about options deliberately NOT passed, neither of which is a type. Everything in these files that
 * could be tested by calling it has been moved into a module that is.
 */
const EPUB_ENTRY = webviewFile('src', 'epub.entry.ts');
const PDF_ENTRY = webviewFile('src', 'pdf.entry.ts');

describe('the baseline is derived from DEFAULT_PREFS, not copied from it', () => {
  // THIS REPLACES THREE PINS ON HAND-COPIED LITERALS. readerMetrics.ts imports
  // DEFAULT_PREFS.typography, so there is no copy left to drift and nothing to grep for. What is
  // asserted instead is the thing the pins were ever a proxy for: that the contract's values are
  // what the reader actually renders at.
  //
  // THESE SURVIVE PREFS-APPLICATION — they do not get deleted with it. Prefs are an async SQLite
  // read and `applyAppearance` is injected AFTER `ready`, so these values stay as the fallback the
  // first paint uses when that read is slow or fails, which is the case where a UA-default flash
  // would be the visible bug.
  const m = readerMetrics(393, 700);

  it('renders body text at the contract size on the reference viewport', () => {
    expect(m.fontPx).toBe(DEFAULT_PREFS.typography.size);
  });

  it('derives the line box from the contract line height', () => {
    expect(m.linePx).toBe(
      Math.round(DEFAULT_PREFS.typography.size * DEFAULT_PREFS.typography.lineHeight),
    );
  });

  it('uses the contract margin as the top padding', () => {
    expect(m.padTop).toBe(DEFAULT_PREFS.typography.margins);
  });
});

describe('the stylesheet is applied in a way epub.js honours', () => {
  it('registers the content hook before the first display()', () => {
    // A SEQUENCING REQUIREMENT, which is why it is still a source assertion: no type can express
    // it. The hook is what puts the sheet into each chapter document. Registered after display(),
    // the first chapter paints at UA defaults and then re-flows — a visible flash of the exact bug
    // the baseline exists to fix.
    //
    // The hook lives inside createRendition() (shared by openEpub and applyAppearance's flow-change
    // rebuild) rather than inline in openEpub, so the invariant this test pins shifted from "earlier
    // in this function's text" to "createRendition() registers it before returning, and openEpub
    // only calls display() on what createRendition() returns" — checked as three text positions
    // rather than two, since that is what now makes the ordering structural rather than textual.
    const hookAt = EPUB_ENTRY.indexOf('rendition.hooks.content.register(');
    const createCallAt = EPUB_ENTRY.indexOf('const newRendition = createRendition();');
    const displayAt = EPUB_ENTRY.indexOf('await newRendition.display()');

    expect(hookAt).toBeGreaterThan(-1);
    expect(createCallAt).toBeGreaterThan(-1);
    expect(displayAt).toBeGreaterThan(-1);
    expect(hookAt).toBeLessThan(createCallAt);
    expect(createCallAt).toBeLessThan(displayAt);
  });

  it('re-applies the sheet on resize, not just on load', () => {
    // Rotation changes both the type size and the grid remainder. Without this the sheet built for
    // portrait is still installed in landscape.
    expect(EPUB_ENTRY).toMatch(/rendition\.on\('resized', \(\) => \{\s*applyBaselineCss\(\);/);
  });

  it('goes through addStylesheetCss under a stable key, not themes', () => {
    // addStylesheetCss REPLACES the node it owns (contents.js:750-757), so re-applying on every
    // rotation cannot pile up sheets. Themes cannot carry CSS text at all for chapters loaded
    // later: Themes.inject() tests theme.rules and theme.url and never theme.serialized, so the
    // sheet would be applied to the chapters open at the time and silently skipped for every one
    // after.
    expect(EPUB_ENTRY).toMatch(/addStylesheetCss\(/);
    expect(EPUB_ENTRY).toMatch(/STYLESHEET_KEY/);
    expect(EPUB_ENTRY).not.toMatch(/rendition\.themes\.(default|registerCss)\(/);
  });

  it('forces the declarations that have to beat epub.js and the book', () => {
    const css = baselineCss(readerMetrics(393, 700));

    // Beats epub.js's INLINE padding-top/bottom (contents.js:1085-1086); a non-important rule
    // cannot.
    expect(css).toMatch(/padding-top: \d+px !important/);
    expect(css).toMatch(/padding-bottom: \d+px !important/);
    // Beats the book's own class-based em sizes, which is the whole point of a uniform size —
    // element selectors lose to .calibreN on specificity.
    expect(css).toMatch(/font-size: \d+px !important/);
    // The host <style> cannot reach the chapter iframe, so it has to be here.
    expect(css).toMatch(/-webkit-text-size-adjust: 100% !important/);
  });

  it('leaves horizontal padding alone, because epub.js owns it', () => {
    // Contents.columns() sets padding-left/right inline AND important (contents.js:1087-1088),
    // which outranks author !important. A rule here would look like it works and would not, so the
    // absence is deliberate.
    const css = baselineCss(readerMetrics(393, 700));

    expect(css).not.toMatch(/padding-left/);
    expect(css).not.toMatch(/padding-right/);
  });
});

describe('the line grid — why a line cannot be sliced by a page edge', () => {
  // A representative sweep rather than one case: the remainder that slices a line is a function of
  // the viewport height, so the arithmetic has to hold for arbitrary heights, not for the one the
  // simulator happens to have.
  const HEIGHTS = [480, 604, 700, 701, 733, 812, 1024, 1180];

  it.each(HEIGHTS)('quantises a %ipx column to a whole number of line boxes', (height) => {
    const m = readerMetrics(393, height);

    // THE INVARIANT. If this holds, the text column is exactly `lines` line boxes tall, so there is
    // no partial line at the bottom to cut in half.
    expect(m.padTop + m.lines * m.linePx + m.padBottom).toBe(height);
    expect(m.linePx).toBe(Math.round(m.linePx)); // integers, or the grid drifts
    expect(m.lines).toBeGreaterThan(0);
  });

  it('never eats into the bottom margin to make the grid fit', () => {
    // The remainder is ADDED to the margin, never taken from it, so quantising cannot crowd the
    // text against the page edge.
    for (const height of HEIGHTS) {
      const m = readerMetrics(393, height);
      expect(m.padBottom).toBeGreaterThanOrEqual(DEFAULT_PREFS.typography.margins);
      expect(m.padBottom).toBeLessThan(DEFAULT_PREFS.typography.margins + m.linePx);
    }
  });

  it('keeps every line-height and vertical margin a whole multiple of the grid unit', () => {
    // The quantisation above is worthless if some element introduces a line box that is not a
    // multiple of linePx — the grid drifts and slicing returns. So this reads back EVERY generated
    // line-height and vertical margin and checks it.
    const m = readerMetrics(393, 700);
    const css = baselineCss(m);

    const values = [...css.matchAll(/(?:line-height|margin-top|margin-bottom): (\d+)px/g)].map(
      (match) => Number(match[1]),
    );

    expect(values.length).toBeGreaterThan(5);
    for (const value of values) {
      expect(value % m.linePx).toBe(0);
    }
  });

  it('holds the grid against raised glyphs', () => {
    // A superscript citation marker with a normal line-height grows its line box and drifts the
    // grid by a fraction of a line — and academic books are full of them.
    expect(baselineCss(readerMetrics(393, 700))).toMatch(
      /sup, sub \{[^}]*line-height: 0 !important/,
    );
  });

  it('forces text selectable against a book that switches it off', () => {
    // `user-select: none` / `-webkit-touch-callout: none` are the copy-prevention idiom in publisher
    // and Calibre-converted stylesheets, and either one makes a long press select nothing — no
    // menu, no highlight, and nothing on screen explaining it. Selection is half of highlighting
    // now, so this sheet has to win.
    const css = baselineCss(readerMetrics(393, 700));
    expect(css).toMatch(/html, body \{[^}]*-webkit-user-select: text !important/);
    expect(css).toMatch(/html, body \{[^}]*-webkit-touch-callout: default !important/);
    // Repeated on the text elements: both declarations are important, so a book's rule on its own
    // paragraphs beats an ancestor's on specificity unless this sheet matches there too.
    expect(css).toMatch(/^p, div, span, li,[^{]*\{[^}]*user-select: text !important/m);
  });

  it('does not quantise when the flow has no page edges', () => {
    // Guard on the flow rather than the value: when scrolled-doc arrives, this test is the record
    // of what changes with it.
    expect(isPaginated()).toBe(true);
    expect(readerMetrics(393, 700).lines).toBeGreaterThan(0);
  });
});

describe("the book's own page breaks are honoured", () => {
  it('recognises the whole forced-break vocabulary, legacy spellings included', () => {
    // EPUB CSS is written in the legacy `page-break-before: always` idiom, and print stylesheets
    // reach for the recto/verso and left/right spellings. Missing one means that book's chapter
    // openings silently run on mid-page.
    for (const value of ['always', 'page', 'left', 'right', 'recto', 'verso']) {
      expect(isForcedBreak(value)).toBe(true);
    }
  });

  it('treats everything else as no break, including absent values', () => {
    // `breakBefore` is undefined on engines that only expose the legacy property, so the undefined
    // case is a real one, not defensive noise. The casts are the point: this is called with a
    // computed style value, and the runtime has to survive what the types promise it will not send.
    for (const value of ['auto', 'avoid', 'column', 'inherit', '', undefined, null, 0]) {
      expect(isForcedBreak(value as unknown as string)).toBe(false);
    }
  });

  it('restates the break in the column vocabulary, read from the computed value', () => {
    // Reading the COMPUTED style is the load-bearing choice: Calibre-converted books declare breaks
    // on generated classes, so there is no selector worth matching. And a page break is not
    // automatically a column break — our pages are columns.
    expect(EPUB_ENTRY).toMatch(/win\.getComputedStyle\(el\)/);
    expect(EPUB_ENTRY).toMatch(
      /isForcedBreak\(computed\.breakBefore\) \|\| isForcedBreak\(computed\.pageBreakBefore\)/,
    );
    expect(EPUB_ENTRY).toMatch(
      /setProperty\('-webkit-column-break-before', 'always', 'important'\)/,
    );
  });

  it('only runs in paginated flow', () => {
    // In scrolled-doc there are no columns to break, and the walk would be pure cost. Checked
    // against the LIVE flow (currentFlow()), not the static READER_FLOW default — this call sat
    // bare (isPaginated()) until continuous scroll shipped, which meant it silently always used
    // the paginated-flow default regardless of what the user was actually reading in.
    expect(EPUB_ENTRY).toMatch(
      /if \(isPaginated\(currentFlow\(\)\)\) applyAuthoredBreaks\(contents\.document\)/,
    );
  });
});

describe("a book's own print-layout margins don't eat the whole column", () => {
  // Real values from a Calibre-converted fixture: .calibre27 { margin: 1em 0 1em 20em; } — a
  // print-page x-offset with nowhere else to go once converted to HTML, now sized for a phone.
  const VIEWPORT_WIDTH = 380;

  it('leaves a modest, plausibly-intentional indent alone', () => {
    // ~2em at a 16px root — a nested list or a blockquote, not a layout artifact.
    expect(isExcessiveIndent(32, VIEWPORT_WIDTH)).toBe(false);
  });

  it('flags a margin that consumes most of the column', () => {
    // 20em at 16px root = 320px, on a 380px column — the fixture's actual value.
    expect(isExcessiveIndent(320, VIEWPORT_WIDTH)).toBe(true);
  });

  it('caps to a fraction of the viewport, not to a fixed pixel value', () => {
    // Scales with the viewport rather than clamping every phone to one hardcoded number — a tablet
    // legitimately has more room for the same indent to still read as intentional.
    expect(cappedIndent(380)).toBeCloseTo(76);
    expect(cappedIndent(760)).toBeCloseTo(152);
  });

  it('applies regardless of flow, unlike the break walk and the column override', () => {
    // Horizontal width is scarce in scrolled-doc too — only pagination-specific fixes are gated on
    // isPaginated().
    expect(EPUB_ENTRY).toMatch(
      /capExcessiveIndents\(contents\.document, viewportSize\(\)\.width\)/,
    );
    expect(EPUB_ENTRY).not.toMatch(/if \(isPaginated\([^)]*\)\)\s*capExcessiveIndents/);
  });
});

describe("an authored multi-column layout doesn't fight our own page columns", () => {
  it('treats "auto" and one column as no author columns', () => {
    // 'auto' is the computed value when nothing set column-count, and a book that explicitly asks
    // for one column is not nesting a second column context — nothing to detect either way.
    for (const value of ['auto', '1', '', 'inherit']) {
      expect(isMultiColumnCount(value)).toBe(false);
    }
  });

  it('recognises two or more authored columns', () => {
    for (const value of ['2', '3', '10']) {
      expect(isMultiColumnCount(value)).toBe(true);
    }
  });

  it('forces every element back to one column, not just the body', () => {
    // The book can put the rule on any wrapper, not only the root — same reasoning
    // applyAuthoredBreaks gives for reading computed values instead of guessing a selector.
    const css = columnOverrideCss();

    expect(css).toMatch(/body,\s*body \*\s*\{[^}]*column-count:\s*1\s*!important/);
    expect(css).toMatch(/-webkit-column-count:\s*1\s*!important/);
  });

  it('detects authored columns from the computed value, on the body or a candidate element', () => {
    expect(EPUB_ENTRY).toMatch(/win\.getComputedStyle\(doc\.body\)\.columnCount/);
    expect(EPUB_ENTRY).toMatch(
      /isMultiColumnCount\(win\.getComputedStyle\(nodes\[i\] as HTMLElement\)\.columnCount\)/,
    );
  });

  it('only overrides columns when this chapter actually authors them', () => {
    // The override must be conditional — appending it unconditionally would mean every chapter of
    // every book pays for a rule it never needed, and would force column-count: 1 on legitimately
    // authored two-column content this reader has no opinion about outside paginated flow. Checked
    // against the LIVE flow, same reasoning as the break walk above.
    expect(EPUB_ENTRY).toMatch(
      /isPaginated\(currentFlow\(\)\) && hasAuthoredColumns\(doc\)\s*\n\s*\? `\$\{currentCss\}\\n\$\{columnOverrideCss\(\)\}`\s*\n\s*: currentCss/,
    );
  });

  it('re-checks per chapter document, not once per book', () => {
    // A front-matter page can be plain while a later chapter (e.g. a glossary) authors columns —
    // detection has to run against each chapter's own document.
    expect(EPUB_ENTRY).toMatch(/function hasAuthoredColumns\(doc: Document \| null \| undefined\)/);
    expect(EPUB_ENTRY).toMatch(/insertStylesheet\(contents, finalCssFor\(contents\.document\)\)/);
  });
});

describe('type scales with the screen', () => {
  // Narrow phone through to a landscape tablet.
  const WIDTHS = [320, 375, 393, 430, 744, 1024];

  it('is exactly DEFAULT_PREFS.typography.size at the reference width', () => {
    // The contract value is the anchor, not one point on a curve — so on the phone it was
    // calibrated for, the scaling is a no-op.
    expect(readerMetrics(393, 700).fontPx).toBe(DEFAULT_PREFS.typography.size);
  });

  it('grows and shrinks monotonically with the viewport', () => {
    const sizes = WIDTHS.map((width) => readerMetrics(width, 700).fontPx);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it('stays a reading size at both extremes', () => {
    // Proportional scaling alone gives ~13px on the narrowest phone and ~34px on an iPad, neither
    // of which anyone wants to read a book at.
    expect(readerMetrics(240, 700).fontPx).toBe(15);
    expect(readerMetrics(1366, 700).fontPx).toBe(22);
  });
});

describe('prefs-driven typography clamps the viewport FACTOR, not the product', () => {
  // THE REGRESSION THIS GUARDS: a prior version clamped the scaled px result to [15, 22], which
  // silently re-capped exactly the accessibility user this exists for. A large `fontSizePt` (from
  // composeFontSizePt's deliberately unclamped a11y multiplier) must still scale past the old
  // ceiling on a narrow phone.

  it('does not cap a large fontSizePt at the old 22px ceiling', () => {
    const m = readerMetrics(393, 700, { fontSizePt: 40, lineHeight: 1.5, marginPx: 16 });
    // At the reference width the viewport factor is 1, so this is a direct pass-through —
    // proof that the OLD absolute clamp (max 22) is gone, not just moved.
    expect(m.fontPx).toBe(40);
  });

  it('still scales a large fontSizePt down on a narrow phone, by the same factor as the default', () => {
    const defaultFontPx = readerMetrics(240, 700).fontPx; // uses DEFAULT_PREFS' 16pt
    const scaledFontPx = readerMetrics(240, 700, {
      fontSizePt: 32,
      lineHeight: 1.5,
      marginPx: 16,
    }).fontPx;
    // Double the input, roughly double the output — the viewport factor is the same regardless of
    // fontSizePt, so this is linear.
    expect(scaledFontPx).toBe(defaultFontPx * 2);
  });

  it('still refuses a pathological fontSizePt rather than laying out an unbounded page', () => {
    // The absolute guard is a pathological-value backstop, not a design bound — it must not fire for
    // any legitimate accessibility size, but a corrupt stored value (or a defect upstream) must not
    // reach the line-grid arithmetic unchecked either.
    expect(readerMetrics(393, 700, { fontSizePt: 100_000, lineHeight: 1.5, marginPx: 16 }).fontPx)
      .toBeLessThan(1000);
    expect(readerMetrics(393, 700, { fontSizePt: -50, lineHeight: 1.5, marginPx: 16 }).fontPx)
      .toBeGreaterThan(0);
  });

  it('never lets an adversarial marginPx drive padBottom negative', () => {
    for (const height of [240, 480, 700, 1024]) {
      for (const marginPx of [0, 16, 500, 100_000]) {
        const m = readerMetrics(393, height, { fontSizePt: 16, lineHeight: 1.5, marginPx });
        expect(m.padBottom).toBeGreaterThanOrEqual(0);
        expect(m.padTop).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('baselineCss carries the prefs-application theme/typography overrides', () => {
  const m = readerMetrics(393, 700);

  it('omits color, link and letter-spacing rules when no appearance is given', () => {
    // The default (no second argument) must stay a no-op against today's look — nothing here should
    // regress a book that never sees an `applyAppearance`.
    const css = baselineCss(m);
    expect(css).not.toMatch(/color:/);
    expect(css).not.toMatch(/^a \{/m);
    expect(css).not.toMatch(/letter-spacing:/);
    expect(css).not.toMatch(/font-family:/);
  });

  it('emits background, text color and link color when given a theme', () => {
    const css = baselineCss(m, { fg: '#e6e6e6', bg: '#121212', link: '#6ea8fe' });
    expect(css).toMatch(/background: #121212 !important/);
    expect(css).toMatch(/color: #e6e6e6 !important/);
    expect(css).toMatch(/a \{ color: #6ea8fe !important; \}/);
  });

  it('omits letter-spacing at 0, matching the "do not restate the default" convention', () => {
    expect(baselineCss(m, { letterSpacingPx: 0 })).not.toMatch(/letter-spacing:/);
    expect(baselineCss(m, { letterSpacingPx: 2 })).toMatch(/letter-spacing: 2px !important/);
  });

  it('sets font-family only when a non-empty, already-sanitised value is given', () => {
    expect(baselineCss(m, { fontFamily: '' })).not.toMatch(/font-family:/);
    expect(baselineCss(m, { fontFamily: 'Georgia' })).toMatch(
      /font-family: Georgia, sans-serif !important/,
    );
  });

  it('injects an @font-face, declared under the bare fontFamily, when both are given', () => {
    const css = baselineCss(m, { fontFamily: 'Inter', fontFaceDataUri: 'data:font/ttf;base64,AAA=' });
    expect(css).toMatch(/@font-face \{/);
    expect(css).toMatch(/font-family: Inter;/);
    expect(css).toMatch(/src: url\("data:font\/ttf;base64,AAA="\);/);
    expect(css).toMatch(/font-display: swap;/);
    // Declared before the baseline rules, so it registers before anything references the name.
    expect(css.indexOf('@font-face')).toBeLessThan(css.indexOf('html, body {'));
  });

  it('emits no @font-face when either half is missing', () => {
    expect(baselineCss(m, { fontFamily: 'Inter' })).not.toMatch(/@font-face/);
    expect(baselineCss(m, { fontFaceDataUri: 'data:font/ttf;base64,AAA=' })).not.toMatch(/@font-face/);
    expect(baselineCss(m)).not.toMatch(/@font-face/);
  });
});

describe('sanitizeFontFamily — the allow-list standing between a preference and CSS text', () => {
  it('passes through a plain family name unquoted', () => {
    expect(sanitizeFontFamily('Georgia')).toBe('Georgia');
  });

  it('quotes a multi-word family name, per CSS quoting rules', () => {
    expect(sanitizeFontFamily('Times New Roman')).toBe('"Times New Roman"');
  });

  it('quotes each name in a comma-separated list independently', () => {
    expect(sanitizeFontFamily('Times New Roman, Georgia, serif')).toBe(
      '"Times New Roman", Georgia, serif',
    );
  });

  it('treats empty or whitespace-only input as "do not override"', () => {
    expect(sanitizeFontFamily('')).toBe('');
    expect(sanitizeFontFamily('   ')).toBe('');
  });

  it('refuses anything outside the allow-list rather than passing it through', () => {
    // A stylesheet-injection attempt: closing the font-family declaration and the rule, then opening
    // a new one. If any of this survived into baselineCss's template string, it would be live CSS.
    expect(sanitizeFontFamily(`"; } body { background: url(evil) `)).toBe('');
    expect(sanitizeFontFamily('Georgia<script>')).toBe('');
    expect(sanitizeFontFamily("Georgia'; alert(1)")).toBe('');
  });
});

describe('sanitizeFontDataUri — the allow-list standing between a font byte source and CSS text', () => {
  it('passes through a well-formed data:font URI unchanged', () => {
    expect(sanitizeFontDataUri('data:font/ttf;base64,AAAA')).toBe('data:font/ttf;base64,AAAA');
  });

  it('accepts other font mime subtypes', () => {
    expect(sanitizeFontDataUri('data:font/woff2;base64,AAAA')).toBe('data:font/woff2;base64,AAAA');
  });

  it('treats null or empty/whitespace input as "do not override"', () => {
    expect(sanitizeFontDataUri(null)).toBe('');
    expect(sanitizeFontDataUri('')).toBe('');
    expect(sanitizeFontDataUri('   ')).toBe('');
  });

  it('rejects a non-data: scheme, e.g. what a stray upload path would look like', () => {
    expect(sanitizeFontDataUri('file:///fonts/x.otf')).toBe('');
    expect(sanitizeFontDataUri('https://example.com/font.ttf')).toBe('');
  });

  it('refuses an injection attempt breaking out of the src: url("...") it will end up in', () => {
    expect(sanitizeFontDataUri('data:font/ttf;base64,AAA");}body{background:url(evil)}')).toBe('');
    expect(sanitizeFontDataUri("data:font/ttf;base64,AAA' onload='alert(1)")).toBe('');
  });
});

describe('rotation keeps working', () => {
  it('passes width and height to renderTo as percentage strings, not numbers', () => {
    // A VALUE-TYPE requirement that `tsc` cannot express: Stage.onResize only attaches its window
    // resize listener when width/height are NOT numeric (stage.js:147-153), and that listener is
    // the whole of the reader's resize handling. Pass 393 instead of '100%' and rotation silently
    // stops re-flowing, with nothing red anywhere.
    expect(EPUB_ENTRY).toMatch(/width: '100%'/);
    expect(EPUB_ENTRY).toMatch(/height: '100%'/);
  });
});

describe('the PDF shell stays offline', () => {
  it('does not set a cMap or standard-font URL', () => {
    // Both are sub-resource FETCHES this document cannot make and ReaderWebView would refuse. The
    // absence is the assertion, so it has to be checked rather than assumed.
    expect(PDF_ENTRY).not.toMatch(/cMapUrl\s*:/);
    expect(PDF_ENTRY).not.toMatch(/standardFontDataUrl\s*:/);
  });

  it('opts into system fonts, which is what makes the above survivable', () => {
    // The positive half of the assertion above: without this, dropping the font URLs means no font
    // data at all rather than substituted glyphs.
    expect(PDF_ENTRY).toMatch(/useSystemFonts:\s*true/);
  });

  it('builds its worker from the inlined source, never from a URL', () => {
    // workerSrc MUST come from a Blob built out of the text/plain block. Assigning it a path or a
    // URL is the other way this shell can start needing the network — and syncConfig.ts still
    // declares a dead PDFJS_WORKER_URL that would fit here.
    expect(PDF_ENTRY).toMatch(/URL\.createObjectURL\(blob\)/);
    expect(PDF_ENTRY).toMatch(/GlobalWorkerOptions\.workerSrc\s*=/);
    expect(PDF_ENTRY).not.toMatch(/PDFJS_WORKER_URL|pdfjsFontUrl|PDFJS_LIB_URL/);
  });

  it('parks the worker as inert text, so pdf.js does not fall back to the main thread', () => {
    // THE LOAD-BEARING ONE, and it is counter-intuitive: pdf.js checks for an already-loaded worker
    // module (globalThis.pdfjsWorker) and, finding one, parses every page ON THE MAIN THREAD.
    // pdf.worker.min.js is UMD and sets exactly that global, so inlining it as an executable
    // <script> would silently trade a worker thread for a frozen UI. type="text/plain" prevents it
    // from executing, and it stays in the template because it is DOM, not code.
    expect(PDF_TEMPLATE).toMatch(/<script\s+type="text\/plain"\s+id="pdfjs-worker-src">/);

    // And the marker must sit inside that block rather than anywhere else in the file.
    const block = /<script\s+type="text\/plain"\s+id="pdfjs-worker-src">([\s\S]*?)<\/script>/.exec(
      PDF_TEMPLATE,
    );
    if (!block) throw new Error('Could not find the text/plain worker block.');
    expect(block[1]).toMatch(/@inject:pdfjsworker/);
  });
});

describe('each shell carries the DOM its entry queries', () => {
  // A .ts file cannot carry HTML or CSS, so this is the one boundary the conversion did not remove.
  // Each entry silently does nothing useful if its elements go missing: showFallback() finds no node
  // and the last-resort error state disappears, which is how a blank page stops being explainable.
  const SHELLS = [
    ['reader-epub.template.html', () => TEMPLATE, /<div id="viewer"><\/div>/],
    ['reader-pdf.template.html', () => PDF_TEMPLATE, /<canvas id="pdf-canvas"><\/canvas>/],
  ] as const;

  it.each(SHELLS)('%s defines the fallback element and its .visible class', (name, source) => {
    const required = [/<pre id="fallback"><\/pre>/, /#fallback\s*\{/, /#fallback\.visible\s*\{/];

    expect(required.filter((re) => !re.test(source())).map((re) => `${name} lacks ${String(re)}`))
      .toEqual([]);
  });

  it.each(SHELLS)('%s defines the container its renderer draws into', (_name, source, container) => {
    expect(source()).toMatch(container);
  });

  it.each(SHELLS)('%s carries the entry marker and no inline script of its own', (_name, source) => {
    // The behaviour lives in a compiled entry now. An inline <script> here would be a second,
    // untypechecked half of the bridge growing back.
    expect(source()).toMatch(/<!-- @inject:entry -->/);
    expect(source()).not.toMatch(/<script>\s*\n\s*\(function/);
  });
});

describe('the PDF shell carries continuous scroll\'s second surface', () => {
  // pdf.entry.ts toggles which of #pdf-single/#pdf-scroll is visible off applyAppearance's flow —
  // both silently do nothing if their elements go missing, same failure mode the block above guards
  // for the single-page surface.
  it('defines #pdf-single wrapping both spread pages', () => {
    // EACH CANVAS SITS IN ITS OWN POSITIONED .pdf-page WRAPPER, which the canvases did not need
    // before highlighting: the text layer and the highlight boxes are absolutely positioned, and
    // without a positioned ancestor per page they resolve against the viewport instead of the page.
    expect(PDF_TEMPLATE).toMatch(
      /<div class="pdf-page" id="pdf-page-1"><canvas id="pdf-canvas"><\/canvas><\/div>/,
    );
    expect(PDF_TEMPLATE).toMatch(
      /<div class="pdf-page" id="pdf-page-2"><canvas id="pdf-canvas-2"><\/canvas><\/div>/,
    );
    expect(PDF_TEMPLATE).toMatch(/<div id="pdf-single">/);
  });

  it('defines the scrollable surface and its page-wrapper content root', () => {
    expect(PDF_TEMPLATE).toMatch(/<div id="pdf-scroll">/);
    expect(PDF_TEMPLATE).toMatch(/<div id="pdf-scroll-content"><\/div>/);
  });

  it('hides #pdf-scroll by default, so a book always opens in single-page mode absent an appearance', () => {
    expect(PDF_TEMPLATE).toMatch(/#pdf-scroll\s*\{[^}]*display:\s*none/);
  });
});

describe('the PDF shell carries double-page spread\'s second canvas', () => {
  // renderCurrent() (pdf.entry.ts) toggles #pdf-canvas-2's display when a spread has two pages —
  // same failure mode as the rest of this file: an element that goes missing here means the second
  // page of a spread silently never appears, with no error to explain why.
  it('hides #pdf-page-2 by default, so a book always opens on one page absent an appearance', () => {
    // THE WRAPPER, NOT THE CANVAS — moved when the page wrappers landed. #pdf-single is a flex row
    // with a gutter, and `gap` applies between IN-FLOW children, so hiding only the canvas would
    // leave an empty flex item holding an 8px gap beside a single page and shift it off centre.
    expect(PDF_TEMPLATE).toMatch(/#pdf-page-2\s*\{[^}]*display:\s*none/);
  });

  it('gives #pdf-single a gutter for when both canvases are showing', () => {
    expect(PDF_TEMPLATE).toMatch(/#pdf-single\s*\{[^}]*gap:\s*8px/);
  });
});

describe("the PDF shell carries the layers a highlight is selected and painted in", () => {
  // pdf.entry.ts CREATES these elements at runtime but cannot style them — a .ts file carries no
  // CSS. Both fail silently and differently if their rules go missing: an unstyled text layer is
  // opaque text stacked on top of the page bitmap, and an unstyled highlight layer is a set of
  // static-positioned divs pushing the canvas down the page.
  it('positions the text layer over the page', () => {
    expect(PDF_TEMPLATE).toMatch(/\.pdf-text-layer\s*\{[^}]*position:\s*absolute/);
    expect(PDF_TEMPLATE).toMatch(/\.pdf-page\s*\{[^}]*position:\s*relative/);
  });

  it('keeps the text layer transparent rather than invisible', () => {
    // `color: transparent`, NOT `opacity: 0`: the OS draws the selection highlight into this layer,
    // and an opacity-0 layer takes that with it — the user would be selecting text they cannot see
    // selected, which is indistinguishable from selection being broken.
    expect(PDF_TEMPLATE).toMatch(/\.pdf-text-layer span[^{]*\{[^}]*color:\s*transparent/);
  });

  it('keeps highlight boxes out of the touch path', () => {
    // LOAD-BEARING, not tidiness: a box that takes touches swallows the drag that starts inside it,
    // so an existing highlight could never be selected through or extended. Taps are hit-tested
    // against the painted geometry instead (highlightGeometry.ts's `highlightAt`).
    expect(PDF_TEMPLATE).toMatch(/\.pdf-highlight-layer\s*\{[^}]*pointer-events:\s*none/);
  });

  it('composites a highlight rather than covering the page with it', () => {
    // `multiply` is what makes a SOLID fill (the user layer's channel in HIGHLIGHT_LAYERS.md §3)
    // readable: it darkens the rasterised glyphs towards the colour instead of hiding them, the same
    // compositing epub.js's own highlight defaults give the EPUB shell.
    expect(PDF_TEMPLATE).toMatch(/\.pdf-highlight-layer\s*>\s*div\s*\{[^}]*mix-blend-mode:\s*multiply/);
  });
});

describe('reduceMotion has nothing to suppress, and must not quietly acquire one', () => {
  // Decision #2 in prefs.ts's log: Reader honours reduceMotion, and honouring it is FREE today
  // because there is no animation anywhere in the reader. That makes the obligation fall on whoever
  // adds the first one, and this is what makes that a red build rather than a promise in a doc.
  //
  // NOW COVERS THE ENTRIES TOO, not just the stylesheets. Before the conversion an animation could
  // only have come from CSS; a .ts entry can just as easily add one imperatively.
  //
  // WHEN YOU ADD A DELIBERATE, GATED ANIMATION: do not delete this test. Change it to assert the
  // gate — that the declaration is reachable only when the resolved reduceMotion boolean on the
  // appearance payload is false. An animation the reader can turn off is fine; an animation nobody
  // checked is what this catches.
  const ANIMATED_DECLARATION = [
    // Property position, not prose: `transition:` / `animation:` and their longhands, plus
    // @keyframes. Matching the bare words would fail on a comment mentioning them, which is how a
    // guard trains people to delete it.
    /(?:^|[;{\s])(?:transition|animation)(?:-[a-z-]+)?\s*:/,
    /@keyframes/,
    /@-webkit-keyframes/,
  ];

  it.each([
    ['reader-epub.template.html', () => TEMPLATE],
    ['reader-pdf.template.html', () => PDF_TEMPLATE],
    ['webview/src/epub.entry.ts', () => EPUB_ENTRY],
    ['webview/src/pdf.entry.ts', () => PDF_ENTRY],
  ])('%s declares no animation', (_name, source) => {
    expect(ANIMATED_DECLARATION.filter((re) => re.test(source()))).toEqual([]);
  });
});
