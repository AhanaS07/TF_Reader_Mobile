// Owner: Reader (Ahana).
//
// The one place `rendition.annotations` gets called from. Not unit-tested — same tier as
// `epub.entry.ts`, it only forwards to epub.js — but it is the whole enforcement mechanism behind
// `highlightNaming.ts`'s naming, so it is worth being explicit about WHY the call shape is what it
// is rather than the more obvious-looking alternative.
//
// >>> NAMESPACING MUST GO THROUGH `type`, NOT JUST `className`. <<< epub.js's `Annotations` keys its
// internal map on `cfiRange + type` (annotations.js), where `type` is the first argument to `.add`/
// `.remove` — the annotation KIND (`'highlight'`, `'underline'`, `'mark'`), not a free label. If two
// owners painted the same `cfiRange` and both called `.remove(cfiRange, 'highlight')`, the SECOND
// remove would silently no-op against an already-removed (or differently-owned) entry only by luck of
// call order — `Annotations.remove` refuses a mismatched `type`, so passing a PER-OWNER `type` string
// (via `annotationType`) is what actually makes one owner's removal incapable of touching another's,
// rather than merely unlikely to.
//
// STATELESS ON PURPOSE. This does not remember what it last painted for an owner — `add`/`remove` are
// the primitive; a caller that wants "replace" (like `setSpokenRange`) calls `remove` then `add` and
// keeps its own "what did I last paint" state, the same way `epub.entry.ts` already keeps `lastCfi`
// for the relocated position.

import type { Rendition } from 'epubjs';

import { annotationClassName, annotationType } from './highlightNaming';

/** Paint `cfiRange` for `owner`, styled by `variant`. Replaces nothing — call `remove` first if a
 * previous range for this owner is still painted. */
export function add(
  rendition: Rendition,
  owner: string,
  cfiRange: string,
  variant: string,
  styles?: Record<string, string>,
): void {
  rendition.annotations.add(
    annotationType(owner),
    cfiRange,
    {},
    undefined,
    annotationClassName(owner, variant),
    styles,
  );
}

/** Remove `cfiRange` painted by `owner`. A no-op if nothing matches — epub.js's own `remove` already
 * tolerates that, so this does not need to track existence itself. */
export function remove(rendition: Rendition, owner: string, cfiRange: string): void {
  rendition.annotations.remove(cfiRange, annotationType(owner));
}
