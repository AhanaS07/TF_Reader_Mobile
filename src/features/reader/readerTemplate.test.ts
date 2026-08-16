// Owner: Reader (Ahana).
//
// Invariants of reader.template.html that no compiler can see.
//
// readerBridge.test.ts guards the bridge PROTOCOL — message types, error codes,
// command/method names. This file guards the things inside the template that are
// not protocol but are just as capable of breaking silently:
//
//   1. Three constants hand-copied from a FROZEN contract (DEFAULT_PREFS). The
//      template has no module system, so it cannot import them; without this
//      test, Personalization changing a default would leave the reader rendering
//      at the old one with nothing red anywhere.
//   2. The rendition settings whose VALUE TYPE, not value, is load-bearing —
//      epub.js's resize handling turns on width/height being non-numeric.
//   3. The one place the template SHAPES a bridge payload rather than forwarding
//      it: flattening the navigation tree. The bridge drift guard checks names and
//      types; it cannot see that a correctly-shaped `toc` message carries only the
//      top level of the book's navigation.
//   4. The LINE GRID. Whether a line of text gets sliced in half by a page edge is
//      pure arithmetic, so it is testable here rather than only by looking at a
//      screenshot — which is the whole reason readerMetrics/baselineCss were
//      written as pure functions of the viewport.
//
// These are read out of the template as text, for the same reason the drift guard
// is: it is the only view of that file the toolchain has. Where the code is pure it
// is not merely matched but EXTRACTED AND RUN — see templateModule() below.

import * as fs from 'fs';
import * as path from 'path';

import { MAX_TOC_DEPTH } from '@/features/reader/readerBridge';
import { DEFAULT_PREFS } from '@/shared/contracts';

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'webview', 'reader.template.html'), 'utf8');

/** The numeric literal assigned to a `var NAME = <number>;` in the template. */
function baselineConstant(name: string): number {
  const match = new RegExp(`var ${name} = ([0-9.]+);`).exec(TEMPLATE);
  if (!match) throw new Error(`Could not find "var ${name} = <number>;" in the template.`);
  return Number(match[1]);
}

interface Metrics {
  fontPx: number;
  linePx: number;
  padTop: number;
  padBottom: number;
  lines: number;
}

interface TemplateModule {
  readerMetrics: (width: number, height: number) => Metrics;
  baselineCss: (metrics: Metrics) => string;
  isForcedBreak: (value: unknown) => boolean;
  isPaginated: () => boolean;
}

/**
 * Lift the template's PURE region out of the HTML and make it callable.
 *
 * The region is delimited by the two section comments the template already carries,
 * which is why they are worded as a boundary rather than a heading: everything above
 * "DOM glue" is a function of its arguments, so it runs here unmodified. This is the
 * only executable coverage the untypechecked half of the reader gets.
 *
 * Extracted rather than imported because there is nothing to import — the file is
 * HTML. If the boundary comments move, this throws by name instead of quietly
 * testing nothing.
 */
function templateModule(): TemplateModule {
  const start = TEMPLATE.indexOf('// ---- reader metrics and stylesheet: PURE');
  const end = TEMPLATE.indexOf('// ---- reader DOM glue');
  if (start < 0 || end < 0 || end < start) {
    throw new Error('Could not locate the pure region boundary comments in the template.');
  }

  // `new Function` needs no eslint-disable here: `no-new-func` is not enabled in this
  // config, and adding the directive anyway fails --max-warnings=0 as unused. The input
  // is a tracked source file in this repo, not user data.
  return new Function(
    `${TEMPLATE.slice(start, end)}
     return { readerMetrics: readerMetrics, baselineCss: baselineCss,
              isForcedBreak: isForcedBreak, isPaginated: isPaginated };`,
  )() as TemplateModule;
}

describe('the template baseline mirrors DEFAULT_PREFS.typography', () => {
  // If one of these fails, the fix is to change the TEMPLATE, not this test and
  // not prefs.ts — src/shared/contracts/ is the Week-1 freeze and the template is
  // the copy. (And if the values are meant to diverge, the real answer is that
  // prefs-application has arrived; see WEBVIEW_BRIDGE.md.)
  it('font size', () => {
    expect(baselineConstant('BASELINE_FONT_SIZE_PX')).toBe(DEFAULT_PREFS.typography.size);
  });

  it('line height', () => {
    expect(baselineConstant('BASELINE_LINE_HEIGHT')).toBe(DEFAULT_PREFS.typography.lineHeight);
  });

  it('margins', () => {
    expect(baselineConstant('BASELINE_MARGIN_PX')).toBe(DEFAULT_PREFS.typography.margins);
  });
});

describe('the stylesheet is applied in a way epub.js honours', () => {
  it('registers the content hook before the first display()', () => {
    // The hook is what puts the sheet into each chapter document. Registered after
    // display(), the first chapter paints at UA defaults and then re-flows — a
    // visible flash of the exact bug the baseline exists to fix.
    const hookAt = TEMPLATE.indexOf('rendition.hooks.content.register(');
    const displayAt = TEMPLATE.indexOf('rendition.display()');

    expect(hookAt).toBeGreaterThan(-1);
    expect(displayAt).toBeGreaterThan(-1);
    expect(hookAt).toBeLessThan(displayAt);
  });

  it('re-applies the sheet on resize, not just on load', () => {
    // Rotation changes both the type size and the grid remainder. Without this the
    // sheet built for portrait is still installed in landscape.
    expect(TEMPLATE).toMatch(/rendition\.on\('resized', function \(\) \{\s*applyBaselineCss\(\);/);
  });

  it('goes through addStylesheetCss under a stable key, not themes', () => {
    // addStylesheetCss REPLACES the node it owns (contents.js:750-757), so
    // re-applying on every rotation cannot pile up sheets. Themes cannot carry CSS
    // text at all for chapters loaded later: Themes.inject() tests theme.rules and
    // theme.url and never theme.serialized, so the sheet would be applied to the
    // chapters open at the time and silently skipped for every one after.
    expect(TEMPLATE).toMatch(/contents\.addStylesheetCss\(currentCss, STYLESHEET_KEY\)/);
    expect(TEMPLATE).not.toMatch(/rendition\.themes\.(default|registerCss)\(/);
  });

  it('forces the declarations that have to beat epub.js and the book', () => {
    const { readerMetrics, baselineCss } = templateModule();
    const css = baselineCss(readerMetrics(393, 700));

    // Beats epub.js's INLINE padding-top/bottom (contents.js:1085-1086); a
    // non-important rule cannot.
    expect(css).toMatch(/padding-top: \d+px !important/);
    expect(css).toMatch(/padding-bottom: \d+px !important/);
    // Beats the book's own class-based em sizes, which is the whole point of a
    // uniform size — element selectors lose to .calibreN on specificity.
    expect(css).toMatch(/font-size: \d+px !important/);
    // The host <style> cannot reach the chapter iframe, so it has to be here.
    expect(css).toMatch(/-webkit-text-size-adjust: 100% !important/);
  });

  it('leaves horizontal padding alone, because epub.js owns it', () => {
    // Contents.columns() sets padding-left/right inline AND important
    // (contents.js:1087-1088), which outranks author !important. A rule here would
    // look like it works and would not, so the absence is deliberate.
    const { readerMetrics, baselineCss } = templateModule();
    const css = baselineCss(readerMetrics(393, 700));

    expect(css).not.toMatch(/padding-left/);
    expect(css).not.toMatch(/padding-right/);
  });
});

describe('the line grid — why a line cannot be sliced by a page edge', () => {
  const { readerMetrics, baselineCss, isPaginated } = templateModule();

  // A representative sweep rather than one case: the remainder that slices a line is
  // a function of the viewport height, so the arithmetic has to hold for arbitrary
  // heights, not for the one the simulator happens to have.
  const HEIGHTS = [480, 604, 700, 701, 733, 812, 1024, 1180];

  it.each(HEIGHTS)('quantises a %ipx column to a whole number of line boxes', (height) => {
    const m = readerMetrics(393, height);

    // THE INVARIANT. If this holds, the text column is exactly `lines` line boxes
    // tall, so there is no partial line at the bottom to cut in half.
    expect(m.padTop + m.lines * m.linePx + m.padBottom).toBe(height);
    expect(m.linePx).toBe(Math.round(m.linePx)); // integers, or the grid drifts
    expect(m.lines).toBeGreaterThan(0);
  });

  it('never eats into the bottom margin to make the grid fit', () => {
    // The remainder is ADDED to the margin, never taken from it, so quantising
    // cannot crowd the text against the page edge.
    for (const height of HEIGHTS) {
      const m = readerMetrics(393, height);
      expect(m.padBottom).toBeGreaterThanOrEqual(DEFAULT_PREFS.typography.margins);
      expect(m.padBottom).toBeLessThan(DEFAULT_PREFS.typography.margins + m.linePx);
    }
  });

  it('keeps every line-height and vertical margin a whole multiple of the grid unit', () => {
    // The quantisation above is worthless if some element introduces a line box that
    // is not a multiple of linePx — the grid drifts and slicing returns. So this
    // reads back EVERY generated line-height and vertical margin and checks it.
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
    // A superscript citation marker with a normal line-height grows its line box and
    // drifts the grid by a fraction of a line — and academic books are full of them.
    expect(baselineCss(readerMetrics(393, 700))).toMatch(
      /sup, sub \{[^}]*line-height: 0 !important/,
    );
  });

  it('does not quantise when the flow has no page edges', () => {
    // Guard on the flow constant rather than the value: when scrolled-doc arrives,
    // this test is the record of what changes with it.
    expect(isPaginated()).toBe(true);
    expect(TEMPLATE).toMatch(/if \(!isPaginated\(\)\) \{[\s\S]*?No page edge to slice a line/);
  });
});

describe("the book's own page breaks are honoured", () => {
  const { isForcedBreak } = templateModule();

  it('recognises the whole forced-break vocabulary, legacy spellings included', () => {
    // EPUB CSS is written in the legacy `page-break-before: always` idiom, and print
    // stylesheets reach for the recto/verso and left/right spellings. Missing one
    // means that book's chapter openings silently run on mid-page.
    for (const value of ['always', 'page', 'left', 'right', 'recto', 'verso']) {
      expect(isForcedBreak(value)).toBe(true);
    }
  });

  it('treats everything else as no break, including absent values', () => {
    // `breakBefore` is undefined on engines that only expose the legacy property, so
    // the undefined case is a real one, not defensive noise.
    for (const value of ['auto', 'avoid', 'column', 'inherit', '', undefined, null, 0]) {
      expect(isForcedBreak(value)).toBe(false);
    }
  });

  it('restates the break in the column vocabulary, read from the computed value', () => {
    // Reading the COMPUTED style is the load-bearing choice: Calibre-converted books
    // declare breaks on generated classes, so there is no selector worth matching.
    // And a page break is not automatically a column break — our pages are columns.
    expect(TEMPLATE).toMatch(/win\.getComputedStyle\(el\)/);
    expect(TEMPLATE).toMatch(
      /isForcedBreak\(computed\.breakBefore\) \|\| isForcedBreak\(computed\.pageBreakBefore\)/,
    );
    expect(TEMPLATE).toMatch(/setProperty\('-webkit-column-break-before', 'always', 'important'\)/);
  });

  it('only runs in paginated flow', () => {
    // In scrolled-doc there are no columns to break, and the walk would be pure cost.
    expect(TEMPLATE).toMatch(
      /if \(isPaginated\(\)\) \{\s*applyAuthoredBreaks\(contents\.document\)/,
    );
  });
});

describe('type scales with the screen', () => {
  const { readerMetrics } = templateModule();

  // Narrow phone through to a landscape tablet.
  const WIDTHS = [320, 375, 393, 430, 744, 1024];

  it('is exactly DEFAULT_PREFS.typography.size at the reference width', () => {
    // The contract value is the anchor, not one point on a curve — so on the phone
    // it was calibrated for, the scaling is a no-op.
    expect(readerMetrics(393, 700).fontPx).toBe(DEFAULT_PREFS.typography.size);
  });

  it('grows and shrinks monotonically with the viewport', () => {
    const sizes = WIDTHS.map((width) => readerMetrics(width, 700).fontPx);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it('stays a reading size at both extremes', () => {
    // Proportional scaling alone gives ~13px on the narrowest phone and ~34px on an
    // iPad, neither of which anyone wants to read a book at.
    expect(readerMetrics(240, 700).fontPx).toBe(15);
    expect(readerMetrics(1366, 700).fontPx).toBe(22);
  });
});

/**
 * Lift `flattenToc` (and the constant it closes over) out of the template and make
 * it callable.
 *
 * This is the only EXECUTABLE coverage of WebView code in the repo — everything
 * else about that file is asserted as text — and it is possible only because
 * flattenToc is pure: no DOM, no epub.js, no bridge. Which is also the argument for
 * keeping the template's own logic pure wherever there is a choice.
 *
 * Extracted by source range rather than imported, because there is nothing to
 * import: the file is HTML. If the extraction stops matching, this throws by name
 * instead of silently testing nothing.
 */
function templateFlattenToc(): (items: unknown, depth: number, into: unknown[]) => unknown[] {
  const source = /var MAX_TOC_DEPTH = \d+;[\s\S]*?\n {8}\}\n/.exec(TEMPLATE);
  if (!source) throw new Error('Could not extract MAX_TOC_DEPTH + flattenToc from the template.');

  // `new Function` needs no eslint-disable here: `no-new-func` is not enabled in this
  // config, and adding the directive anyway fails --max-warnings=0 as unused. The input
  // is a tracked source file in this repo, not user data.
  return new Function(`${source[0]}; return flattenToc;`)() as ReturnType<
    typeof templateFlattenToc
  >;
}

describe("the template's TOC flattener", () => {
  const flattenToc = templateFlattenToc();

  it('emits a nested tree depth-first, in reading order', () => {
    const nav = [
      {
        label: '  Part One  ', // real nav documents are full of stray whitespace
        href: 'p1.xhtml',
        subitems: [
          {
            label: 'Chapter 1',
            href: 'c1.xhtml',
            subitems: [{ label: 'Section 1.1', href: 'c1.xhtml#s1', subitems: [] }],
          },
          { label: 'Chapter 2', href: 'c2.xhtml' }, // no subitems key at all
        ],
      },
      { label: 'Part Two', href: 'p2.xhtml', subitems: [] },
    ];

    expect(flattenToc(nav, 0, [])).toEqual([
      { label: 'Part One', href: 'p1.xhtml', depth: 0 },
      { label: 'Chapter 1', href: 'c1.xhtml', depth: 1 },
      { label: 'Section 1.1', href: 'c1.xhtml#s1', depth: 2 },
      { label: 'Chapter 2', href: 'c2.xhtml', depth: 1 },
      { label: 'Part Two', href: 'p2.xhtml', depth: 0 },
    ]);
  });

  it('keeps every entry of an absurdly deep tree, clamping only the depth', () => {
    // Losing a chapter is worse than mis-indenting one, so the cap flattens onto
    // itself rather than truncating the walk.
    let deepest: Record<string, unknown> = { label: 'level 10', href: 'l10.xhtml' };
    for (let level = 9; level >= 1; level--) {
      deepest = { label: `level ${level}`, href: `l${level}.xhtml`, subitems: [deepest] };
    }

    const flat = flattenToc([deepest], 0, []) as { label: string; depth: number }[];

    expect(flat).toHaveLength(10);
    expect(flat.map((item) => item.label)).toContain('level 10');
    expect(Math.max(...flat.map((item) => item.depth))).toBe(MAX_TOC_DEPTH);
  });

  it('survives the malformed entries a real nav document contains', () => {
    // A missing label is common (a nav point wrapping only an image), and epub.js
    // will hand through a null subitem for a malformed <navPoint>.
    expect(flattenToc([{ href: 'a.xhtml' }, null, { label: 'B', href: 'b.xhtml' }], 0, [])).toEqual(
      [
        { label: '', href: 'a.xhtml', depth: 0 },
        { label: 'B', href: 'b.xhtml', depth: 0 },
      ],
    );
    expect(flattenToc(undefined, 0, [])).toEqual([]);
  });
});

describe('the TOC is flattened, not truncated to its top level', () => {
  it('walks subitems', () => {
    // A SHAPE guard, which is the category readerBridge.test.ts's drift guard
    // explicitly cannot cover: every message type and field name could be correct
    // while the template silently sends only the top level of the tree, which is
    // what it did until 2026-08-14. Most real books nest their chapters, so that
    // omission hid most of the book's navigation.
    expect(TEMPLATE).toMatch(/flattenToc\(item\.subitems/);
    expect(TEMPLATE).toMatch(/post\(\{ type: 'toc', items: toc \}\)/);
  });

  it('caps depth at the same value the host clamps to', () => {
    expect(baselineConstant('MAX_TOC_DEPTH')).toBe(MAX_TOC_DEPTH);
  });
});

describe('rotation keeps working', () => {
  it('passes width and height to renderTo as percentage strings, not numbers', () => {
    // THE WHOLE OF THE READER'S RESIZE HANDLING DEPENDS ON THIS TYPE.
    // Stage.onResize attaches its window resize listener only when width/height
    // are non-numeric (epubjs/src/managers/helpers/stage.js:147-153); that
    // listener is what reaches Rendition.onResized, which re-lays out and
    // re-displays the current CFI. Switching to pixel numbers — which looks like a
    // harmless precision improvement — silently removes rotation support, with no
    // error and nothing else in the toolchain to notice.
    const renderTo = /renderTo\('viewer', \{([\s\S]*?)\}\);/.exec(TEMPLATE);
    if (!renderTo) throw new Error('Could not find the renderTo call in the template.');

    expect(renderTo[1]).toMatch(/width: '100%'/);
    expect(renderTo[1]).toMatch(/height: '100%'/);
  });
});
