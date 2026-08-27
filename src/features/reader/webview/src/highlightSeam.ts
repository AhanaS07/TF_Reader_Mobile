// Owner: Reader (Ahana).
//
// The one place `rendition.annotations` gets called from. Not unit-tested — same tier as
// `epub.entry.ts`, it only forwards to epub.js — but it is the whole enforcement mechanism behind
// `highlightNaming.ts`'s naming, so it is worth being explicit about WHY the call shape is what it
// is rather than the more obvious-looking alternative.
//
// >>> THE FIRST ARGUMENT IS epub.js's ANNOTATION *KIND*, AND IT MUST BE ONE OF ITS THREE. <<<
// This file used to pass `annotationType(owner)` there — `tf-hl-tts`, `tf-hl-user` — on the reading
// that a per-owner value in the slot epub.js keys removal on is what makes one owner's `remove`
// structurally incapable of touching another's paint. That reading is right about `remove` and wrong
// about everything else, because of what `Annotation.attach()` does with the same value
// (`epubjs/lib/annotations.js`):
//
//     if (type === "highlight")      result = view.highlight(...);
//     else if (type === "underline") result = view.underline(...);
//     else if (type === "mark")      result = view.mark(...);
//
// There is no `else`. A `type` outside those three matches no branch, `result` stays `undefined`,
// and NOTHING IS EVER PAINTED — the annotation is filed in epub.js's map, attached to every view,
// and draws nothing. That is why the TTS spoken-word highlight has never actually appeared on a
// device despite being wired end to end: unit tests cannot see a blank overlay, and the paint was
// the one part no test called. Confirmed by reading epub.js 0.3.93's own source, not inferred.
//
// So the kind is `'highlight'` for every owner, and the namespacing that survives is the per-owner
// CSS CLASS (`annotationClassName`) plus the owner stamped into the annotation's `data`, which
// marks-pane copies onto the painted element's `dataset`. WHAT IS LOST, stated plainly rather than
// buried: epub.js hashes its annotation map on `encodeURI(cfiRange + type)`, so two owners painting
// the EXACT SAME range now collide there — the later `add` displaces the earlier in the map, and a
// `remove` for that range removes whichever is filed. It is bounded (identical range strings only;
// a repaint restores it) and it is the price of painting at all. HIGHLIGHT_LAYERS.md §1 records the
// same correction, because that document specified the broken arrangement.
//
// STATELESS ON PURPOSE. This does not remember what it last painted for an owner — `add`/`remove` are
// the primitive; a caller that wants "replace" (like `setSpokenRange`) calls `remove` then `add` and
// keeps its own "what did I last paint" state, the same way `epub.entry.ts` already keeps `lastCfi`
// for the relocated position, and the same way `paintHighlights` keeps its id -> range map.

import type { Rendition } from 'epubjs';

import { annotationClassName, annotationType } from './highlightNaming';

/**
 * epub.js's annotation KIND. Not a free label — see the file header for what happens to a value
 * outside its three-branch `if`. `'highlight'` is the only one of the three that fills an area,
 * which is what every channel in HIGHLIGHT_LAYERS.md §3 is (a fill, an outline, a wash); `underline`
 * strokes a baseline and `mark` draws nothing at all.
 */
const EPUBJS_KIND = 'highlight';

/** Paint `cfiRange` for `owner`, styled by `variant`. Replaces nothing — call `remove` first if a
 * previous range for this owner is still painted.
 *
 * `styles` are SVG PRESENTATION ATTRIBUTES, not CSS declarations: marks-pane applies them with
 * `element.setAttribute(name, value)` onto an `<svg><g>`, so `fill` / `fill-opacity` /
 * `mix-blend-mode` work and a camelCased CSS property name like `backgroundColor` is silently
 * ignored. epub.js's own defaults (`fill: yellow`, `fill-opacity: 0.3`, `mix-blend-mode: multiply`)
 * are merged UNDER whatever is passed, so a caller only has to name what it changes.
 *
 * `onTap` is wired by epub.js/marks-pane to both `click` and `touchstart` on the painted element —
 * a real touch, not a mouse-only affordance. NOT what tap-to-delete rides on any more: confirmed
 * on-device that marks-pane's touch proxy (which crosses from the chapter iframe's document, where
 * touches fire, to the OUTER document, where the painted `<rect>`s live) does not fire reliably
 * here, so `epub.entry.ts`'s own `highlightIdAtPoint` hit-tests directly at `touchstart` instead —
 * see its doc comment for the fuller account. No current caller passes `onTap`; the parameter stays
 * because epub.js/marks-pane still support it for whatever DOES want a same-document tap callback,
 * and `undefined` remains the right value for a layer that is not interactive (TTS's spoken range
 * is not something to tap). */
export function add(
  rendition: Rendition,
  owner: string,
  cfiRange: string,
  variant: string,
  styles?: Record<string, string>,
  onTap?: () => void,
): void {
  rendition.annotations.add(
    EPUBJS_KIND,
    cfiRange,
    // Lands on the painted element's `dataset` (marks-pane's `Highlight.bind`), so which owner drew
    // a given rect is inspectable in the DOM rather than only inferable from its class name.
    { tfOwner: annotationType(owner) },
    onTap,
    annotationClassName(owner, variant),
    styles,
  );
}

/** Remove `cfiRange` painted by `owner`. A no-op if nothing matches — epub.js's own `remove` already
 * tolerates that, so this does not need to track existence itself.
 *
 * `owner` is kept in the signature even though epub.js's map can no longer discriminate on it (see
 * the file header): every call site reads as "un-paint MY range", and the day epub.js grows a real
 * per-owner key this is the only line that changes. */
export function remove(rendition: Rendition, _owner: string, cfiRange: string): void {
  rendition.annotations.remove(cfiRange, EPUBJS_KIND);
}
