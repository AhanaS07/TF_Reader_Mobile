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

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';

import {
  base64ToArrayBuffer,
  fail,
  installErrorHandlers,
  post,
  publish,
  type TFReaderApi,
} from './bridge';
import {
  buildOutlineToc,
  fitScale,
  pageFromTarget,
  type OutlineDocument,
} from './pdfOutline';

/**
 * The pdf.js surface this shell uses, as it appears on `window`.
 *
 * Only the two members actually touched are named. `getDocument`'s parameter type is spelled out
 * rather than imported because pdf.js's own `DocumentInitParameters` is far wider than what a shell
 * with no network access may pass — see the deliberate omissions in `openPdf`.
 */
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer; useSystemFonts: boolean }) => {
    promise: Promise<PDFDocumentProxy>;
  };
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
 * Guards against overlapping renders. pdf.js rejects a second `render()` on a page whose first is
 * still running, and next/prev can easily outpace a render on a slow page — so a token is compared
 * on completion and a stale result is discarded rather than painted over a newer one.
 */
let renderToken = 0;

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
 * Returns false having already failed, rather than throwing, so the caller can stop before
 * getDocument().
 */
function wireWorker(pdfjs: PdfJsLib): boolean {
  const el = document.getElementById('pdfjs-worker-src');
  if (!el?.textContent?.trim()) {
    fail('PDFJS_MISSING', 'pdf.js worker source is empty — check the build-html inject step');
    return false;
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
 * Render one page, fitted to the container, and report the new position.
 *
 * devicePixelRatio is applied to the CANVAS BUFFER only, with CSS holding the layout size — the
 * standard sharp-canvas trick. Without it, text on a 3x screen renders at a third of the available
 * resolution and looks soft in a way that reads as "the PDF is low quality".
 *
 * The fit scale itself is `fitScale()` in pdfOutline.ts, where it is tested.
 */
async function renderPage(pageNumber: number): Promise<void> {
  if (!pdfDoc) {
    fail('NOT_READY', 'renderPage() before a document was opened');
    return;
  }

  const token = ++renderToken;
  const page: PDFPageProxy = await pdfDoc.getPage(pageNumber);
  if (token !== renderToken) return;

  const box = viewportSize();
  const base = page.getViewport({ scale: 1 });
  const fit = fitScale(box.width, box.height, base.width, base.height);
  if (fit === 0) {
    // A zero-height container yields a zero-scale canvas — a blank page with no error, which is an
    // explicit non-acceptance criterion. Say so instead of painting nothing.
    fail('NAVIGATION_FAILED', 'the reader container has no measurable size');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: fit * dpr * currentZoom });

  const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement | null;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) {
    fail('NAVIGATION_FAILED', 'the page canvas is missing from the shell');
    return;
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  // CSS/layout size carries `currentZoom` too — it is the visual magnification the user asked for,
  // not just extra backing-buffer resolution the way `dpr` is.
  canvas.style.width = `${Math.floor(base.width * fit * currentZoom)}px`;
  canvas.style.height = `${Math.floor(base.height * fit * currentZoom)}px`;

  await page.render({ canvasContext: context, viewport }).promise;
  if (token !== renderToken) return;

  currentPage = pageNumber;

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
    atStart: currentPage <= 1,
    atEnd: currentPage >= pageCount,
  });
}

/** Report a render failure without letting the rejection escape into the catch-all. */
function renderPageGuarded(pageNumber: number): void {
  renderPage(pageNumber).catch((error: unknown) => {
    fail('NAVIGATION_FAILED', error);
  });
}

// Rotation and split-view resizes change the fit scale, so the current page has to be re-rasterised
// or it stays at the old resolution, stretched by CSS. epub.js does its own resize handling; pdf.js
// does none, so this is ours.
window.addEventListener('resize', () => {
  if (pdfDoc && currentPage) renderPageGuarded(currentPage);
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
        await renderPage(1);
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
    if (currentPage >= pageCount) return;
    renderPageGuarded(currentPage + 1);
  },

  prev: () => {
    if (!pdfDoc) {
      fail('NOT_READY', 'prev() before a document was opened');
      return;
    }
    if (currentPage <= 1) return;
    renderPageGuarded(currentPage - 1);
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

    renderPageGuarded(page);
  },

  /**
   * Apply a resolved appearance. Per the sign-off doc this shell applies only `bg` and `zoom` —
   * typography/theme-text fields are silently ignored, not an oversight: pdf.js rasterises pages, so
   * there is no text CSS layer to override here the way the EPUB shell has.
   *
   * `document.body.style` rather than a stylesheet: there is no `Contents` abstraction to hook into
   * (one page is one canvas, not a chapter document), so a single direct style write is enough.
   */
  applyAppearance: (appearance: ReaderAppearance) => {
    document.body.style.background = appearance.bg;

    const zoomChanged = appearance.zoom !== currentZoom;
    currentZoom = appearance.zoom;

    if (zoomChanged && pdfDoc && currentPage) {
      renderPageGuarded(currentPage);
    }
  },
};

// Announce last, once the API is fully defined — RN waits for `ready` before injecting any command.
if (!lib()) {
  fail('PDFJS_MISSING', 'pdf.js did not load — check the build-html inject step');
} else {
  publish(api);
}
