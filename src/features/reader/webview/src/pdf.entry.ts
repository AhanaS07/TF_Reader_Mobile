// Owner: Reader (Ahana).
//
// THE PDF SHELL'S ENTRY POINT. Compiled by buildReaderHtml.ts (esbuild, one IIFE) and inlined into
// assets/reader/reader-pdf.html. Its sibling is epub.entry.ts; the shared half is bridge.ts.
//
// TWO SHELLS RATHER THAN ONE BRANCHING FILE, for two reasons that are both load-bearing: an EPUB read
// should not carry ~1.4 MB of inlined pdf.js it can never call, AND one shell per book is why this
// one only ever receives `{kind:'page'}` targets and can refuse an `href` outright. A single combined
// shell would give up the second property.
//
// WHAT LIVES HERE vs IN pdfOutline.ts: this file reads the DOM and drives pdf.js, so it is not unit
// tested. Everything that is arithmetic or tree-walking lives next door, where tests can call it.
// Keep this file thin for that reason — if you are about to write a loop with a `+1` in it, it
// belongs in pdfOutline.ts.
//
// pdf.js ARRIVES ON `window`, NOT THROUGH AN IMPORT. It is inlined as a classic script by the
// generator, so importing it as a VALUE here would bundle a second ~1.4 MB copy into this entry.
// buildReaderHtml.ts enforces that with a hard size ceiling on the compiled bundle. Types are
// imported (erased at compile time) and that is exactly why the cast below is checked rather than
// hopeful.

import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type { PdfHighlightPaint } from '@/features/personalization/readerHighlights';

import {
  base64ToArrayBuffer,
  fail,
  installErrorHandlers,
  post,
  publish,
  type TFReaderApi,
} from './bridge';
import { pdfHighlights } from './highlightPaint';
import { selectionBackground } from './selectionTheme';
import {
  LONG_PRESS_MS,
  movedBeyondSlop,
  swipeDirection,
  type TouchPoint,
} from './touchGesture';
import {
  clearTextLayer,
  ensureSurface,
  highlightAtClientPoint,
  paintPage,
  selectionInSurface,
  setPageText,
  type PdfPageSurface,
} from './pdfHighlightSeam';
import {
  buildOutlineToc,
  fitScale,
  fitWidthScale,
  mostVisiblePage,
  nextSpreadStart,
  pageFromTarget,
  prevSpreadStart,
  shouldRenderSpread,
  spreadPages,
  type OutlineDocument,
} from './pdfOutline';

/**
 * The pdf.js surface this shell uses, as it appears on `window`.
 *
 * Only the members actually touched are named. `getDocument`'s parameter type is spelled out
 * rather than imported because pdf.js's own `DocumentInitParameters` is far wider than what a shell
 * with no network access may pass — see the deliberate omissions in `openPdf`.
 */
/**
 * What `page.getTextContent()` resolves to.
 *
 * Derived from the method rather than imported: pdf.js's root types re-export `PageViewport` but not
 * `TextContent`, and reaching into `pdfjs-dist/types/src/display/api` for it would pin this file to
 * the package's internal layout for the sake of one alias.
 */
type PageTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer; useSystemFonts: boolean }) => {
    promise: Promise<PDFDocumentProxy>;
  };
  /**
   * pdf.js's own text-layer renderer, used rather than hand-laying spans from `getTextContent()`.
   *
   * WHY BORROW IT INSTEAD OF WRITING ONE: the placement is not "put each string where its transform
   * says". It is font-ascent correction, per-item horizontal scaling measured against a canvas, and
   * marked-content nesting — several hundred lines of typography that pdf.js already gets right and
   * that a highlight's character offsets depend on being right. `textContentItemsStr` (an OUTPUT
   * parameter) is the index the offsets are counted against; see pdfHighlightSeam.ts.
   */
  renderTextLayer: (params: {
    textContentSource: PageTextContent;
    container: HTMLElement;
    viewport: PageViewport;
    textDivs: HTMLElement[];
    textContentItemsStr: string[];
  }) => { promise: Promise<void> };
}

/**
 * `PDFDocumentProxy` really does satisfy the structural interface pdfOutline.ts is tested against.
 *
 * THIS ASSERTION IS THE POINT OF THE INDIRECTION. The tests use a three-method fake; without this
 * line the fake could drift from the real proxy and the tests would keep passing against a shape
 * pdf.js no longer has. It already earned its place once: it rejected `OutlineNode.url?: string`,
 * because pdf.js types that field `string | null`.
 */
type AssertDocumentSatisfiesOutline = PDFDocumentProxy extends OutlineDocument ? true : never;
const _outlineContractHolds: AssertDocumentSatisfiesOutline = true;
void _outlineContractHolds;

installErrorHandlers();

let pdfDoc: PDFDocumentProxy | null = null;
let currentPage = 0;
let pageCount = 0;

/**
 * The latest `applyAppearance` payload. Per the sign-off doc, PDF applies only `bg` and `zoom` and
 * ignores typography entirely — pdf.js rasterises pages, so there is no text CSS to override. `zoom`
 * defaults to 1.0 (100%) rather than being undefined before the first payload arrives, matching
 * DEFAULT_PREFS.zoom.level.
 */
let currentZoom = 1.0;

/**
 * The latest `applyAppearance` spread preference. Single-page mode only — continuous scroll never
 * consults this (see the module doc in pdfOutline.ts). Defaults to 'single', matching
 * `ReaderAppearance`'s pre-payload baseline the same way `currentZoom` defaults to 1.0.
 */
let spreadPref: 'single' | 'double' = 'single';

// --- user highlights -----------------------------------------------------------------------------
//
// The PDF side of `paintHighlights`. The mechanics (text layer, boxes, hit-testing, the offset
// arithmetic) live in pdfHighlightSeam.ts and pdfTextRange.ts; what is here is the part that has to
// know about THIS shell's page lifecycle — which pages are on screen, and when their geometry moved.
//
// >>> EVERY PATH THAT RE-RASTERISES A PAGE MUST ALSO REBUILD ITS TEXT LAYER AND REPAINT IT. <<<
// The boxes are absolutely-positioned pixels measured from the text layer, so a zoom, a rotation, a
// spread flip or a scroll-buffer re-render leaves them describing a geometry that no longer exists.
// There is no "re-measure" shortcut: the spans themselves are laid out for the old scale too, so the
// layer is rebuilt from `getTextContent()` rather than adjusted. That is why `renderPageSurface`
// below is called from renderCurrent AND renderScrollPage rather than once per page per book.

/** Every visible page's surface, keyed by page number. SPREAD-AWARE by being a map rather than a
 * single current-page surface: a double-page spread holds two entries at once, continuous scroll
 * holds up to `2 * SCROLL_BUFFER_PAGES + 1`, and painting simply visits all of them. */
const pageSurfaces = new Map<number, PdfPageSurface>();

/** The last `paintHighlights` payload. Kept because the shell repaints on its OWN schedule — a zoom
 * or a scroll re-render must restore the highlights without asking the host to re-send them. */
let userHighlights: PdfHighlightPaint[] = [];

/** The current page background, as `applyAppearance` last set it — kept as the ORIGINAL hex string
 * rather than read back from `document.body.style.background`, whose serialised form (`rgb(...)` vs
 * the hex it was assigned) is not guaranteed across engines and would silently break
 * `highlightFill`'s `parseHex`, which only reads hex. */
let currentBg = '#ffffff';

/** Rebuild one page's text layer at the scale it is currently drawn, then repaint its highlights.
 *
 * `cssScale` is the page's on-screen scale (fit x zoom), NOT the canvas backing-store scale — the
 * text layer is laid out in CSS pixels and pdf.js 3.11 reads that scale from the `--scale-factor`
 * custom property, which is why it is set on the container rather than passed as an argument.
 * Getting it wrong does not misplace the text slightly; it misplaces every glyph proportionally, so
 * selections land on the wrong words. */
async function renderPageSurface(
  pageNumber: number,
  page: PDFPageProxy,
  root: HTMLElement,
  cssScale: number,
): Promise<void> {
  const pdfjs = lib();
  if (!pdfjs) return;

  const surface = ensureSurface(pageNumber, root);
  pageSurfaces.set(pageNumber, surface);
  clearTextLayer(surface);
  surface.textLayer.style.setProperty('--scale-factor', String(cssScale));

  const textDivs: HTMLElement[] = [];
  const textContentItemsStr: string[] = [];

  await pdfjs.renderTextLayer({
    // The UNSCALED viewport, deliberately: pdf.js positions each span as a PERCENTAGE of the page
    // and sizes it as `calc(var(--scale-factor) * <unscaled>px)`, so the scale belongs in the custom
    // property and passing a scaled viewport here would apply it twice.
    textContentSource: await page.getTextContent(),
    container: surface.textLayer,
    viewport: page.getViewport({ scale: 1 }),
    textDivs,
    textContentItemsStr,
  }).promise;

  setPageText(surface, textDivs, textContentItemsStr);
  paintPage(surface, userHighlights, currentBg);
}

/** Forget a page that is no longer on screen. Its surface elements go with the DOM node that held
 * them; this only stops a stale entry being repainted (or hit-tested) after the fact. */
function forgetPageSurface(pageNumber: number): void {
  pageSurfaces.delete(pageNumber);
}

/** Repaint every visible page from the current set. Cheap — `paintPage` rebuilds one layer of a few
 * absolutely-positioned divs — which is what lets this be the ONE repaint entry point rather than a
 * diff (see paintPage's own note on why the PDF side does not diff). */
function repaintUserHighlights(): void {
  for (const surface of pageSurfaces.values()) paintPage(surface, userHighlights, currentBg);
}

/** Gutter between the two canvases when a spread is actually showing two pages. Small and fixed —
 * this reader has no other "gap" concept to reuse, and a book's own gutter is not part of the page
 * bitmap pdf.js hands back. */
const SPREAD_GAP_PX = 8;

/**
 * Guards against overlapping renders. pdf.js rejects a second `render()` on a page whose first is
 * still running, and next/prev can easily outpace a render on a slow page — so a token is compared
 * on completion and a stale result is discarded rather than painted over a newer one. Shared across
 * both pages of a spread: they are one render operation as far as staleness is concerned, since a
 * newer call always supersedes both canvases at once.
 */
let renderToken = 0;

// --- continuous scroll -------------------------------------------------------------------------
//
// A SECOND surface (#pdf-scroll/#pdf-scroll-content), shown instead of #pdf-single/#pdf-canvas when
// `applyAppearance`'s flow is 'scrolled-doc'. Virtualised deliberately: this codebase's own memory
// history (READER_MEASUREMENTS.md) is about resident full-size copies, and rendering every page of a
// large PDF into a scroll list at once would reproduce exactly that failure mode. Only pages within
// SCROLL_BUFFER_PAGES of the one most in view stay rasterised; everything else is disposed as soon
// as it scrolls out of that window, so peak memory here is bounded by the buffer, not by book length.

/** Whether #pdf-scroll is the visible surface right now. */
let scrollMode = false;

/** The flow `applyAppearance` most recently asked for, tracked even before `pdfDoc` exists — a
 * `flow: 'scrolled-doc'` payload arrives BEFORE `openPdf` (see WEBVIEW_BRIDGE.md's ordering
 * requirement), when there is nothing yet to switch into scroll mode. `openPdf` consults this once
 * the document is open, so a book always opens directly into the user's saved preference rather than
 * flashing single-page mode first. */
let wantsScroll = false;

/** Page (1-based) -> its wrapper `<div>` in #pdf-scroll-content, once the list has been built. */
const pageWrappers = new Map<number, HTMLDivElement>();

/** Pages with a rasterised canvas resident right now — the virtualisation window. */
const renderedPages = new Set<number>();

/** Per-page equivalent of `renderToken`: continuous scroll can have several pages' renders
 * legitimately in flight as the user scrolls, where single-page mode only ever has one. */
const pageRenderTokens = new Map<number, number>();

/** Every wrapper's top offset in #pdf-scroll-content's own coordinate space, 1-indexed by page.
 * Cached rather than read from the DOM on every scroll tick — offsetTop does not change between
 * `buildScrollList()` calls, and reading it per page, per frame, while scrolling a long book is a
 * layout-thrashing cost this does not need to pay. */
let cachedPageTops: number[] = [];

/** How many pages beyond the one most in view stay rasterised on either side. This constant IS the
 * peak-memory bound for continuous scroll: at most `2 * SCROLL_BUFFER_PAGES + 1` pages resident at
 * once, regardless of how long the book is. */
const SCROLL_BUFFER_PAGES = 1;

function scrollContainer(): HTMLDivElement | null {
  return document.getElementById('pdf-scroll') as HTMLDivElement | null;
}

function scrollContentEl(): HTMLDivElement | null {
  return document.getElementById('pdf-scroll-content') as HTMLDivElement | null;
}

function singlePageEl(): HTMLDivElement | null {
  return document.getElementById('pdf-single') as HTMLDivElement | null;
}

/** Bump and return a fresh token for `page` — used both to claim a new render and, by
 * `disposeScrollPage`, to invalidate one already in flight (the returned value is not needed there,
 * only the side effect of making the in-flight render's captured token stale). */
function nextTokenFor(page: number): number {
  const next = (pageRenderTokens.get(page) ?? 0) + 1;
  pageRenderTokens.set(page, next);
  return next;
}

/**
 * Build one empty, correctly-HEIGHTED wrapper per page, before any page is rasterised.
 *
 * Pre-sizing is what keeps the scrollbar/scroll-length correct while pages are still being lazily
 * rendered around the visible window — without it the content would grow taller as each page
 * renders in, so the user's scroll position would drift under their thumb.
 *
 * Page geometry (`getViewport({scale:1})`) is metadata pdf.js already parsed when the document
 * opened — this does not rasterise anything, so fetching every page up front is cheap even for a
 * large book. Fetched concurrently (`Promise.all`), same reasoning as `buildOutlineToc`'s destination
 * resolution: serially, a thousand-page book would be a visible stall before scroll mode is usable.
 */
async function buildScrollList(doc: PDFDocumentProxy): Promise<void> {
  const content = scrollContentEl();
  if (!content) return;

  content.innerHTML = '';
  pageWrappers.clear();
  renderedPages.clear();
  pageRenderTokens.clear();

  const box = viewportSize();
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_unused, i) => doc.getPage(i + 1)),
  );

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const base = pages[i].getViewport({ scale: 1 });
    const fit = fitWidthScale(box.width, base.width) * currentZoom;
    const height = fit > 0 ? base.height * fit : 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-scroll-page';
    wrapper.style.height = `${Math.floor(height)}px`;

    // The positioned page box the canvas and its two layers share — the continuous-scroll
    // equivalent of #pdf-page-1/#pdf-page-2. It is a SEPARATE element from the scroll wrapper, not
    // the wrapper itself, because the wrapper is full-width and centres its child: absolutely
    // positioning the text layer against it would stretch the layer across the whole viewport
    // instead of over the page.
    const pageBox = document.createElement('div');
    pageBox.className = 'pdf-page';
    pageBox.style.width = `${Math.floor(fit > 0 ? base.width * fit : 0)}px`;
    pageBox.style.height = `${Math.floor(height)}px`;
    wrapper.appendChild(pageBox);

    content.appendChild(wrapper);
    pageWrappers.set(pageNumber, wrapper);
  }

  cachedPageTops = Array.from(
    { length: pageCount },
    (_unused, i) => pageWrappers.get(i + 1)?.offsetTop ?? 0,
  );
}

/** Rasterise one page into its wrapper, unless it already has a canvas or one is already in
 * flight (`renderedPages` covers both — see the claim below). */
async function renderScrollPage(pageNumber: number): Promise<void> {
  if (!pdfDoc || renderedPages.has(pageNumber)) return;
  const wrapper = pageWrappers.get(pageNumber);
  if (!wrapper) return;

  const token = nextTokenFor(pageNumber);
  // Claimed BEFORE the first await, so a second virtualisation pass landing before this one
  // resolves sees `renderedPages.has(pageNumber)` and does not start a duplicate render.
  renderedPages.add(pageNumber);

  try {
    const page = await pdfDoc.getPage(pageNumber);
    if (pageRenderTokens.get(pageNumber) !== token || !scrollMode) return;

    const box = viewportSize();
    const base = page.getViewport({ scale: 1 });
    const fit = fitWidthScale(box.width, base.width) * currentZoom;
    if (fit === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: fit * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * fit)}px`;
    canvas.style.height = `${Math.floor(base.height * fit)}px`;

    const context = canvas.getContext('2d');
    if (!context) return;

    await page.render({ canvasContext: context, viewport }).promise;
    // Re-checked AFTER the render too: disposeScrollPage can invalidate this page while the
    // (slow) rasterisation above was still running.
    if (pageRenderTokens.get(pageNumber) !== token || !scrollMode) return;

    // The `.pdf-page` box built by buildScrollList, not the scroll wrapper itself — see its note.
    // Falls back to the wrapper only if the list was somehow built without one, which would put the
    // page on screen unhighlightable rather than not at all.
    const pageBox = wrapper.querySelector<HTMLElement>('.pdf-page') ?? wrapper;
    pageBox.replaceChildren(canvas);

    // AFTER replaceChildren, because that call is what would otherwise wipe the two layers
    // `ensureSurface` appends.
    await renderPageSurface(pageNumber, page, pageBox, fit);
    if (pageRenderTokens.get(pageNumber) !== token || !scrollMode) forgetPageSurface(pageNumber);
  } catch (error) {
    // A failed claim must not be permanent — clear it so the next virtualisation pass retries
    // this page instead of silently leaving it blank forever.
    renderedPages.delete(pageNumber);
    throw error;
  }
}

/** Drop a rendered page's canvas and invalidate any render still in flight for it. THE MEMORY
 * BOUND: called on every page that scrolls outside the buffer, which is what keeps peak memory
 * proportional to the buffer rather than to the book. */
function disposeScrollPage(pageNumber: number): void {
  if (!renderedPages.has(pageNumber)) return;
  renderedPages.delete(pageNumber);
  nextTokenFor(pageNumber);
  forgetPageSurface(pageNumber);

  // The `.pdf-page` box is emptied rather than removed: buildScrollList sized it, and the scroll
  // length depends on it keeping that size while the page is out of the buffer.
  const wrapper = pageWrappers.get(pageNumber);
  (wrapper?.querySelector<HTMLElement>('.pdf-page') ?? wrapper)?.replaceChildren();
}

let scrollRaf = 0;

/** Coalesces scroll events onto one rAF-scheduled pass rather than running the (cheap but
 * non-trivial) virtualisation math once per native scroll event, which can fire far more often
 * than the display can repaint. */
function scheduleVirtualize(): void {
  if (scrollRaf) return;
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0;
    virtualize();
  });
}

/** The one pass that decides what is on screen: which page is most visible, which pages should be
 * rendered because they are within the buffer of it, and which should be disposed because they are
 * not. Also reports `relocated` — "page" here means "the page most in view", the same reading the
 * RN-side page indicator already gives a discriminated `{kind:'page'}` position. */
function virtualize(): void {
  if (!scrollMode || !pdfDoc || pageCount === 0) return;
  const container = scrollContainer();
  if (!container) return;

  const current = mostVisiblePage(cachedPageTops, container.scrollTop, container.clientHeight);
  const lo = Math.max(1, current - SCROLL_BUFFER_PAGES);
  const hi = Math.min(pageCount, current + SCROLL_BUFFER_PAGES);

  for (let page = lo; page <= hi; page++) {
    renderScrollPage(page).catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });
  }
  for (const page of renderedPages) {
    if (page < lo || page > hi) disposeScrollPage(page);
  }

  currentPage = current;
  post({
    type: 'relocated',
    position: { kind: 'page', page: current, pageCount },
    atStart: current <= 1,
    atEnd: current >= pageCount,
    // A PDF has no spine, so there is no section to name and nothing for a chapter announcement to
    // compare against. Null rather than a synthesised "section 1": the outline is a separate thing
    // (pdfOutline.ts) and a page is not a member of one.
    section: null,
  });
}

let scrollListenerAttached = false;

function attachScrollListener(): void {
  if (scrollListenerAttached) return;
  scrollListenerAttached = true;
  scrollContainer()?.addEventListener('scroll', scheduleVirtualize, { passive: true });
}

function detachScrollListener(): void {
  if (!scrollListenerAttached) return;
  scrollListenerAttached = false;
  scrollContainer()?.removeEventListener('scroll', scheduleVirtualize);
}

/** Switch #pdf-pages from single-page to continuous scroll. Scrolls to `currentPage` INSTANTLY
 * (a plain `scrollTop` assignment, not `scrollIntoView({behavior:'smooth'})`) — no animation
 * anywhere in this reader, matching the same design `readerTemplate.test.ts` enforces elsewhere. */
async function enterScrollMode(doc: PDFDocumentProxy): Promise<void> {
  if (scrollMode) return;
  scrollMode = true;

  // THE SWITCH MUST HAPPEN BEFORE buildScrollList, NOT AFTER. buildScrollList reads each wrapper's
  // offsetTop into cachedPageTops, and an element inside a display:none ancestor reports offsetTop
  // as 0 regardless of its real position — so measuring while #pdf-scroll was still hidden made
  // EVERY page look like it started at 0, which made mostVisiblePage() always resolve to the LAST
  // page, and the page actually on screen (the first one) never got rendered.
  const single = singlePageEl();
  const scroll = scrollContainer();
  if (single) single.style.display = 'none';
  if (scroll) scroll.style.display = 'block';

  await buildScrollList(doc);

  if (scroll) scroll.scrollTop = cachedPageTops[currentPage - 1] ?? 0;

  attachScrollListener();
  virtualize();
}

/** Switch back to single-page mode, reclaiming every continuous-scroll canvas immediately rather
 * than waiting on garbage collection. */
function leaveScrollMode(): void {
  if (!scrollMode) return;
  scrollMode = false;
  detachScrollListener();

  for (const page of [...renderedPages]) disposeScrollPage(page);
  pageSurfaces.clear();
  pageWrappers.clear();
  cachedPageTops = [];
  const content = scrollContentEl();
  if (content) content.replaceChildren();

  const single = singlePageEl();
  const scroll = scrollContainer();
  if (scroll) scroll.style.display = 'none';
  if (single) single.style.display = 'flex';

  if (pdfDoc && currentPage) renderCurrentGuarded(currentPage);
}

/** Re-fit every wrapper's height and re-render whatever is currently in the buffer — the
 * scroll-mode equivalent of the single-page resize/zoom re-render below. */
async function resizeScrollList(doc: PDFDocumentProxy): Promise<void> {
  if (!scrollMode) return;
  const page = currentPage;
  await buildScrollList(doc);
  const scroll = scrollContainer();
  if (scroll) scroll.scrollTop = cachedPageTops[page - 1] ?? 0;
  virtualize();
}

/** Scroll straight to a page's wrapper — the continuous-scroll equivalent of `renderCurrentGuarded`
 * for `next`/`prev`/`goTo`. Instant, for the same no-animation reason as `enterScrollMode`. */
function scrollToPage(page: number): void {
  const scroll = scrollContainer();
  if (!scroll) return;
  scroll.scrollTop = cachedPageTops[page - 1] ?? 0;
  virtualize();
}

function lib(): PdfJsLib | null {
  const candidate = window.pdfjsLib as PdfJsLib | undefined;
  return candidate && typeof candidate.getDocument === 'function' ? candidate : null;
}

/**
 * Point pdf.js at a real worker thread built from the inlined source.
 *
 * >>> THE WORKER IS PARKED AS INERT TEXT AND HANDED OVER AS A BLOB URL. THAT IS THE WHOLE DESIGN. <<<
 * pdf.js picks its execution mode by probing for an already-loaded worker module
 * (`globalThis.pdfjsWorker?.WorkerMessageHandler`). pdf.worker.min.js is UMD and its header does
 * `e.pdfjsWorker=t()`, so inlining it as a NORMAL script would define that global and pdf.js would
 * skip the real worker and parse every page ON THE MAIN THREAD. For a book-sized PDF that is a
 * frozen UI. `blob:` is already in ReaderWebView.tsx's allow-list, and a Blob URL is memory rather
 * than a fetch, so this keeps the zero-sub-resource-requests property.
 *
 * ANDROID IS THE ONE PLACE THIS INTENT DOESN'T HOLD — see the Android branch below for why the
 * real worker never actually starts there, and main-thread parsing is accepted instead.
 *
 * Returns false having already failed, rather than throwing, so the caller can stop before
 * getDocument().
 */
function wireWorker(pdfjs: PdfJsLib): boolean {
  const el = document.getElementById('pdfjs-worker-src');
  if (!el?.textContent?.trim()) {
    fail('PDFJS_MISSING', 'pdf.js worker source is empty — check the build-html inject step');
    return false;
  }

  // ANDROID ONLY: run the SAME worker source as a normal script instead of handing it to a real
  // Worker via a blob URL.
  //
  // This page is loaded via `file://`, which Chromium gives an opaque ("null") origin. pdf.js's
  // PDFWorker._initialize() checks isSameOrigin(window.location.href, workerSrc) before spawning a
  // real worker; a null-origin page always fails that check, so pdf.js wraps the blob above in a
  // SECOND blob that does `importScripts("<the first blob>")` and hands that to `new Worker()`.
  // Android's WebView refuses to load a blob: URL from inside a worker whose own script also came
  // from a null-origin blob ("Not allowed to load local resource") — iOS's WKWebView does not have
  // this restriction. The failure surfaces as an uncaught global error this bridge reports as
  // WEBVIEW_SCRIPT_ERROR, even though pdf.js recovers a moment later via its own fake-worker
  // fallback — so the document still opens, just behind a false-alarm error banner.
  //
  // Executing the worker source as a plain <script> defines `globalThis.pdfjsWorker` directly (the
  // same UMD global this comment's opening paragraph names) BEFORE getDocument() ever runs.
  // PDFWorker._initialize() probes for exactly that global first, ahead of any Worker/blob logic —
  // finding it already set skips the doomed real-worker attempt entirely and goes straight to the
  // same main-thread fallback that was already silently recovering every time, minus the failed
  // attempt and its false-alarm error. No Worker, no Blob, no importScripts — none of the pieces
  // Android's restriction above applies to are used on this path at all.
  if (/Android/.test(navigator.userAgent)) {
    const script = document.createElement('script');
    script.textContent = el.textContent;
    document.head.appendChild(script);
    return true;
  }

  const blob = new Blob([el.textContent], { type: 'text/javascript' });
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  return true;
}

/** Container size in CSS pixels. Mirrors the EPUB shell's viewportSize(). */
function viewportSize(): { width: number; height: number } {
  const el = document.getElementById('pdf-pages');
  return {
    width: el?.clientWidth || window.innerWidth || 0,
    height: el?.clientHeight || window.innerHeight || 0,
  };
}

/**
 * Render the spread containing `pageNumber` — one canvas normally, two when `spreadPref` is
 * 'double' and the viewport is wide enough (`shouldRenderSpread`/`spreadPages` in pdfOutline.ts) —
 * and report the new position. Reports are keyed off the spread's FIRST page; `atEnd` looks at its
 * LAST page, so a two-page spread ending on the book's final page is correctly reported as the end.
 *
 * devicePixelRatio is applied to the CANVAS BUFFER only, with CSS holding the layout size — the
 * standard sharp-canvas trick. Without it, text on a 3x screen renders at a third of the available
 * resolution and looks soft in a way that reads as "the PDF is low quality".
 *
 * When two pages are showing, both render at the SMALLER of their two individual fit scales, so a
 * spread has one consistent scale even if the two pages differ in size, rather than each page
 * maximising its own half independently.
 *
 * The fit scale itself is `fitScale()` in pdfOutline.ts, where it is tested.
 */
async function renderCurrent(pageNumber: number): Promise<void> {
  if (!pdfDoc) {
    fail('NOT_READY', 'renderCurrent() before a document was opened');
    return;
  }
  const doc = pdfDoc;

  const box = viewportSize();
  const spreading = shouldRenderSpread(spreadPref, box.width);
  const pages = spreadPages(pageNumber, pageCount, spreading);

  const token = ++renderToken;
  const pageProxies = await Promise.all(pages.map((p) => doc.getPage(p)));
  if (token !== renderToken) return;

  // Two pages share the viewport width minus one gutter; one page gets the whole thing.
  const perPageWidth = pages.length === 2 ? (box.width - SPREAD_GAP_PX) / 2 : box.width;
  const bases = pageProxies.map((p) => p.getViewport({ scale: 1 }));
  const fit = Math.min(
    ...bases.map((base) => fitScale(perPageWidth, box.height, base.width, base.height)),
  );

  if (fit === 0) {
    // A zero-height container (or a degenerate page) yields a zero-scale canvas — a blank page with
    // no error, which is an explicit non-acceptance criterion. Say so instead of painting nothing.
    fail('NAVIGATION_FAILED', 'the reader container has no measurable size');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  // Each entry is one half of a spread: the positioned wrapper that owns the page's stack (canvas,
  // text layer, highlight layer) and the canvas inside it. Hiding is done on the WRAPPER — see the
  // template's own note on why an empty-but-present flex item would keep the spread gutter.
  const spreadSlots = [
    { root: 'pdf-page-1', canvas: 'pdf-canvas' },
    { root: 'pdf-page-2', canvas: 'pdf-canvas-2' },
  ] as const;
  const renders: Promise<void>[] = [];
  const surfaceWork: { page: number; proxy: (typeof pageProxies)[number]; root: HTMLElement }[] = [];

  for (let i = 0; i < spreadSlots.length; i++) {
    const root = document.getElementById(spreadSlots[i].root);
    const canvas = document.getElementById(spreadSlots[i].canvas) as HTMLCanvasElement | null;
    if (!canvas || !root) {
      fail('NAVIGATION_FAILED', 'the page canvas is missing from the shell');
      return;
    }

    if (i >= pageProxies.length) {
      // Not part of this spread. Backing store released rather than left resident — a hidden canvas
      // otherwise keeps its last full-size frame in memory for no reason.
      root.style.display = 'none';
      canvas.width = 0;
      canvas.height = 0;
      continue;
    }

    root.style.display = 'block';
    surfaceWork.push({ page: pages[i], proxy: pageProxies[i], root });
    const base = bases[i];
    const viewport = pageProxies[i].getViewport({ scale: fit * dpr * currentZoom });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    // CSS/layout size carries `currentZoom` too — it is the visual magnification the user asked for,
    // not just extra backing-buffer resolution the way `dpr` is.
    canvas.style.width = `${Math.floor(base.width * fit * currentZoom)}px`;
    canvas.style.height = `${Math.floor(base.height * fit * currentZoom)}px`;

    const context = canvas.getContext('2d');
    if (!context) {
      fail('NAVIGATION_FAILED', 'the page canvas is missing from the shell');
      return;
    }
    renders.push(pageProxies[i].render({ canvasContext: context, viewport }).promise);
  }

  await Promise.all(renders);
  if (token !== renderToken) return;

  // A page that just left the spread must stop being repainted and hit-tested. Its DOM is reused by
  // the next render, so forgetting the entry is the whole of the cleanup.
  for (const page of [...pageSurfaces.keys()]) {
    if (!pages.includes(page)) forgetPageSurface(page);
  }

  // AFTER the canvases and NOT awaited before `relocated` is posted: the text layer is what makes
  // the page selectable and highlightable, not what makes it visible, so making the page indicator
  // wait on `getTextContent()` would delay the whole navigation for a feature nobody is using yet
  // at that instant. Guarded by the same `renderToken` as the render above — a newer navigation
  // must not have its text layer overwritten by a stale one finishing late.
  for (const work of surfaceWork) {
    void renderPageSurface(work.page, work.proxy, work.root, fit * currentZoom)
      .then(() => {
        if (token !== renderToken) forgetPageSurface(work.page);
      })
      .catch(() => {
        // Best-effort, exactly like the EPUB shell's `setSpokenRange`: a page that cannot build a
        // text layer is a page that cannot be highlighted, which must not become a page that cannot
        // be READ. The canvas is already on screen and stays there.
      });
  }

  currentPage = pages[0];

  // THE PAGE AND THE PAGE COUNT, which this shell tracked privately for a long time and deliberately
  // did not report: `relocated` was at the payload-size boundary that would have forced the
  // typechecked-WebView conversion, and nothing consumed a reading position, so the field bought
  // nothing. Both of those changed — see ReaderPosition in readerBridge.ts.
  //
  // atStart/atEnd are still reported, and still nothing reads them: ReaderScreen disables Prev/Next on
  // `send === null` only, so both stay enabled at the ends, same as the EPUB path. Bounds are enforced
  // in next/prev below instead, which is why tapping Next on the last page is a no-op, not an error.
  post({
    type: 'relocated',
    position: { kind: 'page', page: currentPage, pageCount },
    atStart: pages[0] <= 1,
    atEnd: pages[pages.length - 1] >= pageCount,
    // No spine — see the scroll-mode emission above.
    section: null,
  });
}

/** Report a render failure without letting the rejection escape into the catch-all. */
function renderCurrentGuarded(pageNumber: number): void {
  renderCurrent(pageNumber).catch((error: unknown) => {
    fail('NAVIGATION_FAILED', error);
  });
}

/**
 * The reader tapped "Highlight". Reads `document.getSelection()` fresh, so a selection extended
 * right up to the tap is what's used. `selectionInSurface` finds which page it's on (spread-aware);
 * refuses (`null`) if the press was on an existing highlight (`pressedHighlightId`).
 */
function requestCurrentSelection(): void {
  if (pressedHighlightId !== null) {
    post({ type: 'selection', selection: null });
    return;
  }

  const selection = document.getSelection();

  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    for (const surface of pageSurfaces.values()) {
      const span = selectionInSurface(surface, selection);
      if (span) {
        post({
          type: 'selection',
          selection: {
            kind: 'pageRange',
            page: surface.page,
            startOffset: span.startOffset,
            endOffset: span.endOffset,
          },
        });
        return;
      }
    }
  }

  post({ type: 'selection', selection: null });
}

// --- gestures ---------------------------------------------------------------------------------
//
// The PDF half of what epub.entry.ts does in every chapter document: a long press offers a menu, a
// directional drag turns the page, and the two are told apart by shape. Simpler here in one way —
// there is one document rather than an iframe per chapter, so coordinates need no translation — and
// harder in another, since a highlight is a div this shell painted rather than something a library
// hit-tests for us. See touchGesture.ts for why both live on this side of the bridge at all.

let touchOrigin: TouchPoint | null = null;
let longPressTimer = 0;
let longPressFired = false;

/**
 * The painted highlight under the finger for the CURRENT gesture, or null — hit-tested at
 * `touchstart` rather than only when `onLongPress` fires. Read by `requestCurrentSelection` (refuse
 * a create over an existing highlight) and `confirmDeleteHighlight` (delete only if this is set) —
 * see their own notes in readerBridge.ts.
 */
let pressedHighlightId: string | null = null;

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

document.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.touches[0];
    if (!touch) return;

    cancelLongPress();
    touchOrigin = { x: touch.clientX, y: touch.clientY };
    longPressFired = false;

    // HIT-TESTED AGAINST THE PAINTED GEOMETRY, not by a listener on each box — the boxes must stay
    // `pointer-events: none` or they would swallow the very drags that create highlights (see
    // pdfHighlightSeam.ts's header). Every visible surface is asked, which is what makes this work
    // across a double-page spread: the press can land on either page.
    pressedHighlightId = null;
    for (const surface of pageSurfaces.values()) {
      const id = highlightAtClientPoint(surface, touch.clientX, touch.clientY);
      if (id !== null) {
        pressedHighlightId = id;
        break;
      }
    }
    // Reset only here, never on touchend/touchcancel — see readerBridge.ts's `highlightTouchActive`
    // note (clearing on touchend crashed the app).
    post({ type: 'highlightTouchActive', active: pressedHighlightId !== null });

    longPressTimer = window.setTimeout(onLongPress, LONG_PRESS_MS);
  },
  { passive: true },
);

document.addEventListener(
  'touchmove',
  (event) => {
    const touch = event.touches[0];
    if (!touch || !touchOrigin) return;
    if (movedBeyondSlop(touchOrigin, { x: touch.clientX, y: touch.clientY })) cancelLongPress();
  },
  { passive: true },
);

document.addEventListener(
  'touchend',
  (event) => {
    cancelLongPress();
    const origin = touchOrigin;
    touchOrigin = null;
    // highlightTouchActive is NOT reset here — see readerBridge.ts's note (it used to be, and crashed).

    const touch = event.changedTouches[0];
    if (!origin || !touch || longPressFired || !pdfDoc) return;
    // A drag that ends with text selected is a selection being extended, not a page turn.
    if (!document.getSelection()?.isCollapsed) return;
    // In continuous scroll the reader scrolls; there is no discrete page to turn. Same rule the RN
    // overlay applied from the outside, now applied where the touch actually is.
    if (scrollMode) return;

    const direction = swipeDirection(origin, { x: touch.clientX, y: touch.clientY });
    if (direction === null) return;

    const spreading = shouldRenderSpread(spreadPref, viewportSize().width);
    const target =
      direction === 'next'
        ? nextSpreadStart(currentPage, pageCount, spreading)
        : prevSpreadStart(currentPage, pageCount, spreading);
    if (target === null) return;
    renderCurrentGuarded(target);
  },
  { passive: true },
);

document.addEventListener(
  'touchcancel',
  () => {
    cancelLongPress();
    touchOrigin = null;
  },
  { passive: true },
);

// Rotation and split-view resizes change the fit scale, so the current page has to be re-rasterised
// or it stays at the old resolution, stretched by CSS. epub.js does its own resize handling; pdf.js
// does none, so this is ours. Branches on scrollMode: a resize changes every wrapper's fit-to-width
// height, not just the one page single-page mode would re-render. In single-page mode this also
// re-evaluates spread: rotating across PDF_SPREAD_MIN_WIDTH should switch between one and two
// canvases live, not just re-fit whichever was already showing.
window.addEventListener('resize', () => {
  if (!pdfDoc) return;
  if (scrollMode) {
    resizeScrollList(pdfDoc).catch((error: unknown) => {
      fail('NAVIGATION_FAILED', error);
    });
  } else if (currentPage) {
    renderCurrentGuarded(currentPage);
  }
});

const api: TFReaderApi<'openPdf'> = {
  /**
   * Open a whole document from base64-encoded PDF bytes and show page 1.
   *
   * NAMED openPdf, NOT open, and that is the whole of how format routing crosses this bridge. The
   * host reads ContentFormat in typechecked TS and picks the command NAME; the format value never
   * travels. Putting ContentFormat in a payload would be trigger 3 in WEBVIEW_BRIDGE.md.
   *
   * >>> THE DECRYPTED-CONTENT HANDOFF. THIS IS LIVE. <<<
   * The base64 handed in is a whole document already decrypted in RAM by
   * ContentProvider.getBook(bookId). It never touched disk as plaintext and must not start here —
   * nothing below may write, cache or postMessage these bytes back out. Verified on a real 14.66 MB
   * PDF: the app container holds only ciphertext (READER_MEASUREMENTS.md).
   *
   * WORTH KNOWING FOR MEMORY: pdf.js TRANSFERS this buffer to its worker rather than copying it
   * (`pdf.js:1058` passes it in the postMessage transfer list), so after the handoff the main thread
   * no longer holds the book's bytes at all. That is a data-minimisation property as well as a
   * performance one, and it is why the PDF path costs less per byte in the WebView than the EPUB one.
   */
  openPdf: (base64) => {
    const pdfjs = lib();
    if (!pdfjs) {
      fail('PDFJS_MISSING', 'pdf.js did not load — check the build-html inject step');
      return;
    }
    if (!wireWorker(pdfjs)) return;

    // NO standardFontDataUrl AND NO cMapUrl, deliberately. Both are sub-resource FETCHES, which this
    // document cannot make and ReaderWebView.tsx would refuse. useSystemFonts covers the base-14
    // fonts from the OS instead. KNOWN LIMITATION, not an oversight: a PDF relying on non-embedded
    // exotic fonts or CJK cmaps renders with substituted glyphs. Inlining the standard font data as
    // data: URLs is the fix when that matters.
    const loading = pdfjs.getDocument({
      data: base64ToArrayBuffer(base64),
      useSystemFonts: true,
    });

    void (async () => {
      try {
        pdfDoc = await loading.promise;
        pageCount = pdfDoc.numPages;

        // A fresh document gets a fresh highlight state. Ids and page offsets from whatever was open
        // before address nothing in this one, and a stale surface map would let a repaint write onto
        // a page container the previous book laid out.
        pageSurfaces.clear();
        userHighlights = [];
        await renderCurrent(1);

        // Consults `wantsScroll` rather than defaulting to single-page: `applyAppearance` always
        // arrives BEFORE `openPdf` (WEBVIEW_BRIDGE.md's ordering requirement), so if the user's
        // saved preference is already 'scrolled-doc' this switches BEFORE `rendered` is posted —
        // the book opens directly into continuous scroll rather than flashing single-page first.
        if (wantsScroll) {
          await enterScrollMode(pdfDoc);
        }

        post({ type: 'rendered' });

        // ALWAYS POSTED, even when empty. The host enables its Contents button off this message, so
        // staying silent would leave the panel permanently unavailable rather than legitimately
        // empty. Sent AFTER `rendered` so the first page is on screen before the destination lookups
        // run — most of a large outline's cost is those round trips into the worker.
        post({ type: 'toc', items: await buildOutlineToc(pdfDoc) });
      } catch (error) {
        fail('OPEN_FAILED', error);
      }
    })();
  },

  next: () => {
    if (!pdfDoc) {
      fail('NOT_READY', 'next() before a document was opened');
      return;
    }
    if (scrollMode) {
      if (currentPage >= pageCount) return;
      scrollToPage(currentPage + 1);
      return;
    }
    const spreading = shouldRenderSpread(spreadPref, viewportSize().width);
    const target = nextSpreadStart(currentPage, pageCount, spreading);
    if (target === null) return;
    renderCurrentGuarded(target);
  },

  prev: () => {
    if (!pdfDoc) {
      fail('NOT_READY', 'prev() before a document was opened');
      return;
    }
    if (scrollMode) {
      if (currentPage <= 1) return;
      scrollToPage(currentPage - 1);
      return;
    }
    const spreading = shouldRenderSpread(spreadPref, viewportSize().width);
    const target = prevSpreadStart(currentPage, pageCount, spreading);
    if (target === null) return;
    renderCurrentGuarded(target);
  },

  /**
   * Navigate to a PDF target.
   *
   * `pageFromTarget` rejects both the wrong format and a page outside this document — see its own note
   * for why those are two different checks with two different owners. The message names which, because
   * "not a page in this document" and "that is an EPUB target" send you to very different places.
   */
  goTo: (target) => {
    if (!pdfDoc) {
      fail('NOT_READY', 'goTo() before a document was opened');
      return;
    }

    const page = pageFromTarget(target, pageCount);
    if (page === null) {
      fail(
        'NAVIGATION_FAILED',
        target.kind === 'page'
          ? `goTo: page ${target.page} is not in this ${pageCount}-page document`
          : `goTo: this shell renders PDF, not ${target.kind}`,
      );
      return;
    }

    if (scrollMode) {
      scrollToPage(page);
      return;
    }
    renderCurrentGuarded(page);
  },

  /**
   * Apply a resolved appearance. Per the sign-off doc this shell applies `bg`, `zoom`, `flow` (as of
   * continuous scroll) and — as of double-page — `spread`; typography/theme-text fields are still
   * silently ignored, not an oversight: pdf.js rasterises pages, so there is no text CSS layer to
   * override here the way the EPUB shell has.
   *
   * `spread` only affects the single-page surface (pdfOutline.ts's module doc explains why
   * continuous scroll is out of scope) — tracked here regardless of `scrollMode` so it is already
   * current if the user leaves scroll mode later, but it only triggers a re-render below.
   *
   * `document.body.style` rather than a stylesheet: there is no `Contents` abstraction to hook into
   * (one page is one canvas, not a chapter document), so a single direct style write is enough.
   */
  applyAppearance: (appearance: ReaderAppearance) => {
    currentBg = appearance.bg;
    document.body.style.background = appearance.bg;
    // Re-tint existing highlights for the new theme immediately, not on the next unrelated repaint.
    repaintUserHighlights();
    // The text layer is transparent, so the ONLY visible sign that a long press selected anything is
    // the `::selection` fill — and WebKit's default is opaque, which hides the words it is selecting.
    // Delivered as a custom property because the rule that reads it lives in the template's CSS,
    // which cannot see this payload. Same derivation the EPUB shell's stylesheet uses.
    document.documentElement.style.setProperty(
      '--tf-selection',
      selectionBackground(appearance.link, appearance.bg),
    );

    const zoomChanged = appearance.zoom !== currentZoom;
    currentZoom = appearance.zoom;
    wantsScroll = appearance.flow === 'scrolled-doc';

    const spreadChanged = appearance.spread !== spreadPref;
    spreadPref = appearance.spread;

    // Before `pdfDoc` exists this is all there is to do — `openPdf` reads `wantsScroll` (and
    // `spreadPref`, via renderCurrent) itself once the document is open. Nothing below is reachable
    // before then.
    if (!pdfDoc) return;

    if (wantsScroll && !scrollMode) {
      enterScrollMode(pdfDoc).catch((error: unknown) => {
        fail('NAVIGATION_FAILED', error);
      });
      return;
    }

    if (!wantsScroll && scrollMode) {
      leaveScrollMode();
      return;
    }

    if (scrollMode) {
      if (!zoomChanged) return;
      resizeScrollList(pdfDoc).catch((error: unknown) => {
        fail('NAVIGATION_FAILED', error);
      });
      return;
    }

    if ((zoomChanged || spreadChanged) && currentPage) {
      renderCurrentGuarded(currentPage);
    }
  },

  /**
   * Documented no-op. Reader never constructs a ReaderTextProvider for a PDF book — the TTS seam is
   * EPUB-only (readerTextProvider.ts's segmentation model is CFI-based) — so this should never
   * actually be invoked. It exists only because `TFReaderApi<'openPdf'>` requires every SHARED
   * command to have an implementation in both shells; inventing an "EPUB-only command" category in
   * bridge.ts's mapped-type machinery would be a materially bigger, riskier change to a proven
   * type-safety mechanism for a one-off need. Answering `unavailable` rather than staying silent
   * means a caller that somehow reaches this gets a real (if unexpected) status instead of a hang.
   */
  requestTtsSentence: ({ requestId }) => {
    post({ type: 'ttsSentence', requestId, result: { status: 'unavailable' } });
  },

  /** Documented no-op — see requestTtsSentence's note. Reader never constructs a
   * `ReaderTextProvider` for a PDF book, so nothing ever asks this shell to paint a spoken range.
   * NOT for want of a seam any more — `pdfHighlightSeam.ts` exists and the user layer paints through
   * it; a TTS layer here would be a matter of segmentation, which is EPUB-only. */
  setSpokenRange: () => {},

  /**
   * Paint the user's saved highlights — the whole set, idempotently, exactly as the EPUB shell does.
   * See `ReaderCommand`'s own note for why the host always sends everything rather than a patch.
   *
   * Stored before it is applied, and applied to whatever is on screen NOW: pages that are not
   * currently rasterised have no surface to paint onto, and pick these up when they are next
   * rendered (`renderPageSurface` ends with a `paintPage`). That is what makes a highlight on page
   * 400 of a scrolled book appear when it is scrolled to, without this command having to know
   * anything about the virtualisation window.
   *
   * The wrong-shape case is refused rather than dropped, for the reason the EPUB shell gives: an
   * EPUB-shaped entry reaching here means the host chose the wrong array while having correctly
   * chosen `openPdf`, and "no highlights" is exactly what that bug would otherwise look like.
   */
  paintHighlights: (highlights) => {
    const { mine, foreign } = pdfHighlights(highlights);
    userHighlights = mine;
    repaintUserHighlights();

    if (foreign > 0) {
      fail(
        'NAVIGATION_FAILED',
        `paintHighlights: ${String(foreign)} highlight(s) address CFIs, and this shell renders PDF`,
      );
    }
  },

  requestCurrentSelection,

  /** The reader tapped "Delete Highlight". Replies only if the press landed on a highlight
   * (`pressedHighlightId`); silent otherwise. */
  confirmDeleteHighlight: () => {
    if (pressedHighlightId !== null) {
      post({ type: 'highlightPressed', id: pressedHighlightId });
    }
  },
};

// Announce last, once the API is fully defined — RN waits for `ready` before injecting any command.
if (!lib()) {
  fail('PDFJS_MISSING', 'pdf.js did not load — check the build-html inject step');
} else {
  publish(api);
}
