// Owner: Reader (Ahana).
//
// Naming for the per-owner highlight seam (`highlightSeam.ts`). Pure and unit-tested on its own,
// because the collision this exists to prevent is entirely a naming property: two owners must never
// produce the same epub.js annotation `type` or CSS class, or `Annotations.remove` (keyed on
// `cfiRange + type`) could remove one owner's paint while servicing another's.
//
// `owner` is a free string (`'tts'`, `'search'`, `'user'`, ...) rather than a closed union — this
// module does not need to know who exists, only that whoever calls it gets a name nobody else does.

/** The epub.js annotation `type` argument, namespaced per owner. */
export function annotationType(owner: string): string {
  return `tf-hl-${owner}`;
}

/** The CSS class epub.js applies to the painted element, namespaced per owner AND variant. */
export function annotationClassName(owner: string, variant: string): string {
  return `tf-hl-${owner}--${variant}`;
}
