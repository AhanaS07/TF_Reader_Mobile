// Owner: Reader (Ahana).
//
// Making epub.js re-measure a chapter it has already laid out. Not unit-tested — same tier as
// `highlightSeam.ts` and the entries themselves, it only reaches into epub.js — but it is the half
// of the highlight-drift fix that no amount of repainting can substitute for, so it is worth being
// explicit about what it does and why epub.js will not do it for us.
//
// >>> EPUB.JS RE-MEASURES A CHAPTER ONLY WHEN THE IFRAME'S PIXEL SIZE CHANGES, AND A TEXT-SIZE
// CHANGE DOES NOT CHANGE IT. <<< The chain that would repair everything after a restyle is
//
//     content reflow -> Contents.resizeCheck() -> EVENTS.CONTENTS.RESIZE -> View.expand()
//                    -> View.reframe() -> pane.render()   (re-measures every painted highlight)
//
// and it breaks in two independent places when only the STYLESHEET changed:
//
//  1. THE RESIZE IS NEVER DETECTED. `Contents.resizeObservers()` observes `document.documentElement`
//     (`epubjs/lib/contents.js:535-542`), and in paginated flow epub.js pins the BODY to a fixed
//     width/height (`Contents.columns()`), so extra text overflows into more COLUMNS rather than
//     growing any observed box. The ResizeObserver has nothing to report, `resizeCheck()` never
//     runs, and `CONTENTS.RESIZE` never fires.
//
//  2. EVEN WHEN IT DOES FIRE, THE REFRAME IS WIDTH-GATED. `expand()` rounds the column strip up to a
//     whole number of pages (`epubjs/lib/managers/views/iframe.js:274-279`) and `reframe()` runs
//     only when the rounded width actually moved (`:300-302`). Raise 16pt to 17pt in a chapter that
//     still spans twelve pages and the width is identical, so nothing is re-measured.
//
// So the shell calls `expand()` itself. That is not a workaround for gate 2 alone: it also fixes the
// STRIP WIDTH epub.js has cached (`_width`), which is what its page count and every scroll offset
// are computed from — leave it stale and the pages a larger font added are unreachable.
//
// WHAT THIS DELIBERATELY DOES NOT DO IS REPAINT. Re-measuring the marks is `epub.entry.ts`'s
// `repaintLiveAnnotations()`, through the annotation seam, because HIGHLIGHT_LAYERS.md §1's rule is
// that `rendition.annotations` has exactly one caller. This file only makes the LAYOUT current, so
// that the repaint which follows measures against the right one.

import type { Contents, Rendition } from 'epubjs';

/**
 * The parts of epub.js's `View` this file uses.
 *
 * >>> THE SHIPPED TYPES DO NOT DECLARE ANY OF THEM, WHICH IS NOT THE SAME AS THEM BEING PRIVATE.
 * <<< `types/managers/view.d.ts` declares `size`/`setLayout`/`bounds` and stops; `expand`, `layout`,
 * `contents` and `displayed` are all real, public-in-practice members of `IframeView` that epub.js's
 * OWN resize handler uses (`iframe.js:418-426`). Narrowed here, once, rather than at the call site —
 * the same treatment `epub.entry.ts` gives `addStylesheetCss`, whose declaration is likewise wrong.
 */
interface EpubViewInternals {
  expand?: () => void;
  layout?: { format?: (contents: Contents) => void };
  contents?: Contents | null;
  displayed?: boolean;
}

/**
 * The rendition's views as a real array.
 *
 * `rendition.views()` is typed `Array<View>` and IS NOT ONE: it returns the manager's `Views`
 * helper (`epubjs/lib/managers/helpers/views.js`), which has `forEach`/`all()` and no
 * `Symbol.iterator`, so a `for...of` over it throws. Only the empty fallback epub.js substitutes
 * when there is no manager is a genuine array. Both shapes are handled rather than the declaration
 * trusted, because trusting it is a runtime crash on the very path that is supposed to repair the
 * reader.
 */
function viewList(rendition: Rendition): EpubViewInternals[] {
  const views = rendition.views() as unknown as
    | { all?: () => EpubViewInternals[] }
    | EpubViewInternals[];

  if (Array.isArray(views)) return views;
  return typeof views.all === 'function' ? views.all() : [];
}

/**
 * Re-run epub.js's own post-reflow pass over every rendered view.
 *
 * The body is exactly what `IframeView`'s `CONTENTS.RESIZE` handler does (`iframe.js:418-426`) —
 * `expand()` then `layout.format(contents)` — and mirroring it rather than inventing a shorter
 * version is deliberate: `expand()` re-reads the text's real width and reframes when it moved, and
 * `format()` re-applies the column geometry to the contents. Doing only the first leaves the columns
 * described by numbers the layout has moved past.
 *
 * SAFE TO CALL WHEN NOTHING CHANGED. `expand()` guards itself on `this._expanding` and reframes only
 * on a real delta, so a call that finds the layout already current costs one measurement and paints
 * nothing. That is what lets the caller coalesce refreshes onto a frame instead of deciding, per
 * event, whether one is warranted.
 *
 * A view that is not displayed is skipped for the reason epub.js skips it: sizing a view before it
 * is shown commits it to a geometry it will be given again on display.
 */
export function forceReflow(rendition: Rendition): void {
  for (const view of viewList(rendition)) {
    if (view.displayed === false) continue;
    try {
      view.expand?.();
      const contents = view.contents;
      if (contents) view.layout?.format?.(contents);
    } catch {
      // Best-effort, per view. A single view that cannot be re-measured (mid-teardown, its iframe
      // already gone) must not stop the others being repaired — the alternative is one stale view
      // taking every other chapter's highlights down with it.
      continue;
    }
  }
}
