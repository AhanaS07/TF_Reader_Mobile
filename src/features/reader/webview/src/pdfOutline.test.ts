// Owner: Reader (Ahana).
//
// The PDF shell's outline mapping and navigation arithmetic, EXECUTED.
//
// Every case here replaces a regex in readerTemplate.test.ts that could only assert some text was
// present in an .html file. That distinction is the point of the typechecked-WebView conversion: a
// grep for `index + 1` passes whether or not the surrounding logic is right, and cannot test a
// malformed outline at all. These call the real functions against a three-method fake document.
//
// WHAT IS STILL A TEXT ASSERTION, AND CORRECTLY SO: the things that are properties of the generated
// ARTIFACT rather than of this code — no cMapUrl/standardFontDataUrl, the worker parked as
// text/plain, `#fallback` in the CSS. Those stay in readerTemplate.test.ts.

import {
  buildOutlineToc,
  collectOutline,
  fitScale,
  fitWidthScale,
  mostVisiblePage,
  outlineDestPage,
  pageFromTarget,
  type OutlineDocument,
  type OutlineNode,
} from '@/features/reader/webview/src/pdfOutline';
import { MAX_TOC_DEPTH } from '@/features/reader/readerBridge';

/**
 * A stand-in for `PDFDocumentProxy`'s three outline methods.
 *
 * `pageRefs` maps an opaque destination reference to its 0-BASED index, mirroring what pdf.js does:
 * the fake has to be 0-based or the `+1` under test would be tested against itself.
 */
function fakeDoc(options: {
  outline?: OutlineNode[] | null;
  named?: Record<string, unknown[] | null>;
  pageRefs?: Record<string, number>;
  throwOnOutline?: boolean;
}): OutlineDocument {
  return {
    getOutline: () => {
      if (options.throwOnOutline) return Promise.reject(new Error('unreadable outline'));
      return Promise.resolve(options.outline ?? null);
    },
    getDestination: (id) => Promise.resolve(options.named?.[id] ?? null),
    getPageIndex: (ref) => {
      const index = options.pageRefs?.[String(ref)];
      if (index === undefined) return Promise.reject(new Error(`no such page ref: ${String(ref)}`));
      return Promise.resolve(index);
    },
  };
}

describe('collectOutline', () => {
  it('walks nested entries depth-first, in reading order', () => {
    const outline: OutlineNode[] = [
      { title: 'One', dest: ['a'], items: [{ title: 'One.a', dest: ['b'] }] },
      { title: 'Two', dest: ['c'] },
    ];

    expect(collectOutline(outline, 0, []).map((e) => [e.label, e.depth])).toEqual([
      ['One', 0],
      ['One.a', 1],
      ['Two', 0],
    ]);
  });

  // The defect this guards is invisible from above: a perfectly well-formed `toc` message carrying
  // only the top level of a nested tree. Most real books put their chapters below the top level.
  it('does not stop at the top level', () => {
    const deep: OutlineNode[] = [
      { title: 'p', dest: ['a'], items: [{ title: 'c', dest: ['b'], items: [{ title: 'g', dest: ['c'] }] }] },
    ];

    expect(collectOutline(deep, 0, [])).toHaveLength(3);
  });

  it('clamps depth at MAX_TOC_DEPTH rather than dropping deeper entries', () => {
    // One chain far deeper than the cap.
    let node: OutlineNode = { title: 'deepest', dest: ['x'] };
    for (let i = 0; i < MAX_TOC_DEPTH + 4; i++) node = { title: `l${i}`, dest: ['x'], items: [node] };

    const flat = collectOutline([node], 0, []);

    expect(flat).toHaveLength(MAX_TOC_DEPTH + 5);
    expect(Math.max(...flat.map((e) => e.depth))).toBe(MAX_TOC_DEPTH);
    // Nothing disappeared — the indent stopped growing, which is the documented behaviour.
    expect(flat.map((e) => e.label)).toContain('deepest');
  });

  it('drops an external-link entry but still walks its children', () => {
    const outline: OutlineNode[] = [
      { title: 'Publisher website', url: 'https://example.com', items: [{ title: 'Real', dest: ['a'] }] },
    ];

    expect(collectOutline(outline, 0, []).map((e) => e.label)).toEqual(['Real']);
  });

  it('trims titles and survives a missing one', () => {
    const outline: OutlineNode[] = [{ title: '  spaced  ', dest: ['a'] }, { dest: ['b'] }];

    expect(collectOutline(outline, 0, []).map((e) => e.label)).toEqual(['spaced', '']);
  });

  it.each([[null], [undefined], [[]]])('returns the accumulator unchanged for %p', (items) => {
    expect(collectOutline(items as OutlineNode[] | null | undefined, 0, [])).toEqual([]);
  });
});

describe('outlineDestPage', () => {
  // THE +1. pdf.js's getPageIndex is 0-based; goTo and the page counter are 1-based. A test that
  // greps for `index + 1` cannot tell you the arithmetic is right; this can.
  it('turns a 0-based page index into a 1-based page number', async () => {
    const doc = fakeDoc({ pageRefs: { ref0: 0, ref11: 11 } });

    expect(await outlineDestPage(doc, ['ref0'])).toBe(1);
    expect(await outlineDestPage(doc, ['ref11'])).toBe(12);
  });

  it('resolves a named destination through getDestination first', async () => {
    const doc = fakeDoc({ named: { 'chapter-3': ['ref7'] }, pageRefs: { ref7: 7 } });

    expect(await outlineDestPage(doc, 'chapter-3')).toBe(8);
  });

  // A malformed entry in one book's outline must not lose the whole Contents panel, so each of these
  // resolves to null rather than rejecting.
  it.each([
    ['a missing dest', undefined],
    ['a null dest', null],
    ['an empty explicit array', []],
    ['an unknown named destination', 'nope'],
    ['a reference no page owns', ['unknown-ref']],
  ])('resolves null for %s', async (_label, dest) => {
    const doc = fakeDoc({ named: {}, pageRefs: {} });

    expect(await outlineDestPage(doc, dest)).toBeNull();
  });
});

describe('buildOutlineToc', () => {
  it('produces ReaderTocItems carrying a resolved PDF page target', async () => {
    const doc = fakeDoc({
      outline: [{ title: 'Opening', dest: ['r0'], items: [{ title: 'Middle', dest: ['r1'] }] }],
      pageRefs: { r0: 0, r1: 4 },
    });

    expect(await buildOutlineToc(doc)).toEqual([
      { label: 'Opening', target: { kind: 'page', page: 1 }, depth: 0 },
      { label: 'Middle', target: { kind: 'page', page: 5 }, depth: 1 },
    ]);
  });

  // Most PDFs have no outline. The host must treat an empty panel as normal, so this is the
  // majority case rather than an edge one.
  it('returns [] for a document with no outline', async () => {
    expect(await buildOutlineToc(fakeDoc({ outline: null }))).toEqual([]);
  });

  it('returns [] rather than rejecting when the outline is unreadable', async () => {
    expect(await buildOutlineToc(fakeDoc({ throwOnOutline: true }))).toEqual([]);
  });

  // One bad entry drops itself, not the panel — the reason outlineDestPage resolves null.
  it('skips entries whose destination will not resolve and keeps the rest', async () => {
    const doc = fakeDoc({
      outline: [
        { title: 'Good', dest: ['r0'] },
        { title: 'Broken', dest: ['missing'] },
        { title: 'Also good', dest: ['r1'] },
      ],
      pageRefs: { r0: 0, r1: 1 },
    });

    expect((await buildOutlineToc(doc)).map((i) => i.label)).toEqual(['Good', 'Also good']);
  });
});

describe('pageFromTarget', () => {
  it('accepts a page inside the document', () => {
    expect(pageFromTarget({ kind: 'page', page: 1 }, 50)).toBe(1);
    expect(pageFromTarget({ kind: 'page', page: 50 }, 50)).toBe(50);
  });

  // THE WRONG FORMAT. Since the target became discriminated this is a category error rather than a
  // string that happens not to parse — and it is the case that used to be unexpressible, because any
  // string was a plausible page number to try.
  it.each([
    ['a spine href', { kind: 'href', href: 'ch1.xhtml' }],
    ['a CFI', { kind: 'href', href: 'epubcfi(/6/4[chap01]!/4/2/2)' }],
    ['an EPUB target whose href looks like a page', { kind: 'href', href: '12' }],
  ] as const)('rejects %s', (_label, target) => {
    expect(pageFromTarget(target, 50)).toBeNull();
  });

  // THE WRONG RANGE. Only this shell knows the page count, so the upper bound can only be checked
  // here; the host validated `page` as a positive integer on the way in.
  it.each([
    ['zero', 0],
    ['a negative page', -3],
    ['past the last page', 51],
    ['a fractional page', 1.5],
  ])('rejects %s', (_label, page) => {
    expect(pageFromTarget({ kind: 'page', page }, 50)).toBeNull();
  });

  it('refuses every target when the document has no pages', () => {
    expect(pageFromTarget({ kind: 'page', page: 1 }, 0)).toBeNull();
  });
});

describe('fitScale', () => {
  // Fitting BOTH axes is what keeps a landscape page inside a portrait viewport rather than cropping
  // it — the min, not the width ratio.
  it('fits a landscape page to the width-limited axis', () => {
    expect(fitScale(400, 800, 800, 400)).toBeCloseTo(0.5);
  });

  it('fits a portrait page taller than the viewport to the height-limited axis', () => {
    expect(fitScale(400, 400, 400, 800)).toBeCloseTo(0.5);
  });

  it('scales up a page smaller than the viewport', () => {
    expect(fitScale(800, 800, 400, 400)).toBeCloseTo(2);
  });

  // A zero-height container is the documented blank-page trap: it must not produce Infinity or NaN
  // and get used to size a canvas.
  it.each([
    ['an unmeasurable viewport', 0, 0, 400, 400],
    ['a zero-height viewport', 400, 0, 400, 400],
    ['a degenerate page', 400, 400, 0, 400],
  ])('returns 0 for %s', (_label, bw, bh, pw, ph) => {
    expect(fitScale(bw, bh, pw, ph)).toBe(0);
  });
});

describe('fitWidthScale', () => {
  // Continuous scroll fits width only — height is the page's share of scroll length, not something
  // to bound.
  it('fits to the width ratio regardless of page height', () => {
    expect(fitWidthScale(400, 800)).toBeCloseTo(0.5);
    expect(fitWidthScale(800, 400)).toBeCloseTo(2);
  });

  it.each([
    ['an unmeasurable viewport', 0, 400],
    ['a degenerate page', 400, 0],
  ])('returns 0 for %s', (_label, boxWidth, pageWidth) => {
    expect(fitWidthScale(boxWidth, pageWidth)).toBe(0);
  });
});

describe('mostVisiblePage', () => {
  const pageTops = [0, 800, 1600];

  it('reports the page under the viewport MIDPOINT, not the top edge', () => {
    expect(mostVisiblePage(pageTops, 0, 800)).toBe(1); // midpoint 400 — inside page 1
    expect(mostVisiblePage(pageTops, 800, 800)).toBe(2); // midpoint 1200 — inside page 2
    expect(mostVisiblePage(pageTops, 1600, 800)).toBe(3); // midpoint 2000 — inside page 3
  });

  it('does not jump a page early — a page top just past the viewport top is not yet "current"', () => {
    // Viewport [750, 1550): midpoint 1150 is still inside page 2 (800-1600), even though page 2's
    // top has already scrolled 50px past the viewport's own top edge.
    expect(mostVisiblePage(pageTops, 750, 800)).toBe(2);
  });

  it('treats an exact boundary as having entered the next page', () => {
    expect(mostVisiblePage(pageTops, 800, 0)).toBe(2); // midpoint exactly 800
  });

  it('defaults to page 1 for an empty list or a midpoint above every page', () => {
    expect(mostVisiblePage([], 0, 800)).toBe(1);
    expect(mostVisiblePage(pageTops, -1000, 0)).toBe(1);
  });
});
