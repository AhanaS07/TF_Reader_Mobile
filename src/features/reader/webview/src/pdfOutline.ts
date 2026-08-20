// Owner: Reader (Ahana).
//
// The PDF shell's outline mapping and its navigation/layout arithmetic — everything the PDF entry
// does that does NOT touch the DOM.
//
// >>> WHY THIS FILE EXISTS SEPARATELY FROM pdf.entry.ts. <<< Before the typechecked-WebView
// conversion, every property below was pinned by a REGEX over the template: that `collectOutline`
// recursed through `item.items`, that the depth clamp matched `MAX_TOC_DEPTH`, that a `+1` turned
// pdf.js's 0-based `getPageIndex` into a 1-based page, that external-link entries were dropped, and
// that `goTo` range-checked before navigating. Each of those was a guard-per-known-trap that had to
// be hand-written and could only ever assert that some text was present.
//
// They are now unit tests that CALL this code against a small fake document. The functions take
// structural interfaces rather than pdf.js's own types precisely so that fake is three methods
// instead of a mock of `PDFDocumentProxy` — and pdf.entry.ts asserts at compile time that the real
// proxy satisfies them, so the indirection cannot drift from the thing it stands in for.

import {
  MAX_TOC_DEPTH,
  type ReaderTarget,
  type ReaderTocItem,
} from '@/features/reader/readerBridge';

/**
 * One node of pdf.js's `getOutline()` tree, as far as this code cares.
 *
 * `dest` is deliberately `unknown`: it is either a NAMED destination (a string to look up) or an
 * explicit array whose first element is an opaque page reference. Neither shape is inspected here
 * beyond that split, and typing it more precisely would mean restating pdf.js's internals.
 */
export interface OutlineNode {
  title?: string;
  dest?: unknown;
  /**
   * Present instead of `dest` when the bookmark points at a website rather than a page.
   *
   * `string | null | undefined`, and the `null` is not defensive padding — pdf.js types this as
   * `string | null` and sets it to null for a page destination. An earlier draft of this interface
   * said `string | undefined`, and the compile-time assertion in pdf.entry.ts rejected it. The
   * runtime check (`!item.url`) was always right for both; the TYPE was wrong, which is precisely
   * the class of drift the typechecked-WebView conversion exists to catch.
   */
  url?: string | null;
  items?: OutlineNode[];
}

/** The three document methods the outline mapping needs. `PDFDocumentProxy` satisfies this. */
export interface OutlineDocument {
  getOutline: () => Promise<OutlineNode[] | null>;
  getDestination: (id: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: never) => Promise<number>;
}

/** A flattened outline entry before its destination has been resolved to a page. */
interface FlatEntry {
  label: string;
  dest: unknown;
  depth: number;
}

/**
 * Walk pdf.js's outline tree depth-first, exactly as the EPUB shell flattens epub.js's `subitems` —
 * the host indents by `depth` and cannot render a recursive structure, and a recursive payload is
 * the shape a hand-synced boundary was always worst at.
 *
 * EXTERNAL LINKS ARE DROPPED. An outline entry may carry `url` instead of `dest` (a bookmark
 * pointing at a website). Those have no page to go to, `goTo` would reject them, and
 * ReaderWebView's allow-list would refuse the navigation anyway — so they are filtered here rather
 * than shipped as rows that cannot work. Their CHILDREN are still walked: a linking parent does not
 * disqualify the sections under it.
 */
export function collectOutline(
  items: OutlineNode[] | null | undefined,
  depth: number,
  into: FlatEntry[],
): FlatEntry[] {
  if (!items || !items.length) return into;

  for (const item of items) {
    if (!item) continue;

    if (!item.url) {
      into.push({ label: (item.title ?? '').trim(), dest: item.dest, depth });
    }

    collectOutline(item.items, Math.min(depth + 1, MAX_TOC_DEPTH), into);
  }

  return into;
}

/**
 * An outline entry's destination, as a 1-BASED PAGE NUMBER.
 *
 * Two indirections, and both are why this is async. A `dest` is either a NAMED destination (a string
 * that has to be looked up) or an explicit array whose first element is a page REFERENCE — and
 * turning a reference into an index needs `getPageIndex`. That is 0-based while `goTo` and the page
 * counter are both 1-based, so THE +1 IS LOAD-BEARING, not cosmetic.
 *
 * Resolves to null rather than rejecting for anything unusable, because a malformed entry in one
 * book's outline must not lose the whole Contents panel.
 */
export async function outlineDestPage(
  doc: OutlineDocument,
  dest: unknown,
): Promise<number | null> {
  if (!dest) return null;

  try {
    const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(target) || !target.length) return null;

    const index = await doc.getPageIndex(target[0] as never);
    return index + 1;
  } catch {
    return null;
  }
}

/**
 * The `toc` payload for a document: the outline, flattened, with every destination already resolved
 * to a page number in `href`.
 *
 * Each entry carries a `{format: 'PDF', page}` target, so a Contents row the host can render is one it
 * can navigate to without the host knowing anything about PDF addressing. This used to be a page
 * number stuffed into an EPUB-shaped `href` string; see `ReaderTarget` in readerBridge.ts for why that
 * was chosen and why it stopped being the cheaper option.
 *
 * Resolves to [] for a document with no outline — which is most of them, and is why the host must
 * treat an empty Contents panel as normal rather than broken.
 */
export async function buildOutlineToc(doc: OutlineDocument): Promise<ReaderTocItem[]> {
  try {
    const flat = collectOutline(await doc.getOutline(), 0, []);

    // Destinations resolve concurrently: each is one or two round trips into the worker, and a
    // 200-entry outline done serially is a visible stall before the Contents button becomes usable.
    const pages = await Promise.all(flat.map((entry) => outlineDestPage(doc, entry.dest)));

    const items: ReaderTocItem[] = [];
    for (let i = 0; i < flat.length; i++) {
      const page = pages[i];
      if (page === null) continue;
      items.push({ label: flat[i].label, target: { kind: 'page', page }, depth: flat[i].depth });
    }
    return items;
  } catch {
    // An unreadable outline is not a failed open. The book renders; Contents is simply empty, which
    // is the same state a book without one produces.
    return [];
  }
}

// --- navigation and layout arithmetic ----------------------------------------
// The PDF shell's other two pure functions. They live here rather than in a third module because
// two small functions do not earn one, and both are the same kind of thing: arithmetic the entry
// needs and a test should be able to call.

/**
 * A `goTo` target as a page in THIS document, or null if it is not one.
 *
 * TWO REJECTIONS, AND BOTH MATTER FOR DIFFERENT REASONS.
 *
 *  - The wrong FORMAT. `ReaderTarget` is discriminated, so an EPUB target reaching the PDF shell is
 *    now a category error rather than a string that fails to parse. It should be impossible — one
 *    shell is loaded per book — but the value arrives over JSON from a book's own navigation document,
 *    so "should be impossible" is not a reason to skip the check.
 *  - The wrong RANGE. `page` is already validated as a positive integer by `asTarget` host-side; the
 *    upper bound can only be checked here, because only this shell knows the page count.
 *
 * Either way the caller raises NAVIGATION_FAILED rather than scrolling somewhere arbitrary.
 */
export function pageFromTarget(target: ReaderTarget, pageCount: number): number | null {
  if (target.kind !== 'page') return null;
  if (!Number.isInteger(target.page) || target.page < 1 || target.page > pageCount) return null;
  return target.page;
}

/**
 * The scale that fits a page inside a viewport, on BOTH axes.
 *
 * Taking the min of the two ratios is what keeps a landscape page inside a portrait viewport instead
 * of cropping it. A PDF page has an intrinsic size in points; scale 1.0 is 72dpi and would render a
 * letter page 612px wide regardless of the device, so this is not optional.
 *
 * Returns 0 for an unmeasurable viewport or a degenerate page rather than Infinity or NaN — the
 * caller treats that as "not renderable yet" instead of sizing a canvas from it.
 */
export function fitScale(
  boxWidth: number,
  boxHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  if (boxWidth <= 0 || boxHeight <= 0 || pageWidth <= 0 || pageHeight <= 0) return 0;
  return Math.min(boxWidth / pageWidth, boxHeight / pageHeight);
}

/**
 * The scale that fits a page to a viewport's WIDTH only, for continuous scroll.
 *
 * Unlike `fitScale`, height is not an input: in a scrolled list a page's rendered height IS its
 * share of the scroll length, not something to be bounded by the viewport, so fitting both axes
 * (and cropping or shrinking to fit a "page" that no longer exists as a screenful) would be wrong
 * here in a way it is not for the single-page-at-a-time view.
 *
 * Returns 0 for an unmeasurable viewport or a degenerate page, same convention as `fitScale` — the
 * caller treats that as "not renderable yet".
 */
export function fitWidthScale(boxWidth: number, pageWidth: number): number {
  if (boxWidth <= 0 || pageWidth <= 0) return 0;
  return boxWidth / pageWidth;
}

/**
 * Which 1-based page the middle of the viewport is currently over, given each page's top offset
 * (ascending, `pageTops[0]` is page 1's) in the scroll container's own coordinate space.
 *
 * THE MIDPOINT, NOT THE TOP EDGE. A page whose top has just scrolled past the viewport's top edge is
 * mostly still off-screen below; reporting it as "current" the instant it appears would make the
 * position indicator jump a page early on every scroll tick. The midpoint is the same "which page are
 * we most looking at" heuristic a reader would use by eye.
 *
 * Defaults to page 1 for an empty list or a midpoint above every page's top — both mean "nothing to
 * measure against yet", which is what page 1 already means before any scroll has happened.
 */
export function mostVisiblePage(
  pageTops: number[],
  viewportTop: number,
  viewportHeight: number,
): number {
  const midpoint = viewportTop + viewportHeight / 2;
  let page = 1;

  for (let i = 0; i < pageTops.length; i++) {
    if (pageTops[i] > midpoint) break;
    page = i + 1;
  }

  return page;
}
