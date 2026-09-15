// Owner: Reader (Ahana).
//
// The arithmetic behind PDF highlighting: character offsets into a page's text layer. Pure and
// unit-tested, for the reason CLAUDE.md gives — `pdf.entry.ts` reads the DOM and drives pdf.js, so
// anything with a `+1` in it belongs next door where a test can call it.
//
// Hit-testing a touch against the painted boxes used to live here too. It moved to
// `highlightGeometry.ts` when the EPUB shell started doing it the same way — a rect is a rect, and
// one copy is what keeps "press on a highlight" meaning the same thing in both formats.
//
// >>> WHAT A PDF HIGHLIGHT IS ADDRESSED BY, AND WHY IT IS NOT A RECTANGLE. <<<
// `highlightStore` stores a PDF highlight as two per-page `Locator`s — `{page, offset}` — where
// `offset` is a CHARACTER offset into that page's text. Not a rectangle, and that is the right
// choice: a rectangle is in device space, so it moves under zoom, rotation and a double-page spread,
// and it survives none of them. A character offset is a property of the document, so the same stored
// highlight paints correctly at any scale, on either canvas of a spread, and in continuous scroll.
//
// THE PAGE'S TEXT IS THE CONCATENATION OF ITS TEXT-LAYER ITEMS, IN pdf.js's OWN ORDER. pdf.js's
// `renderTextLayer` produces one `<span>` per text item and hands back `textContentItemsStr` — the
// items' strings, in the same order. Offset 0 is the first character of the first item; item
// boundaries add nothing (no separator), because inventing one would make every stored offset depend
// on a joining convention that only this file would know about.

/**
 * Running start offset of each item — `starts[i]` is the offset of item `i`'s first character.
 *
 * One extra entry at the end holds the page's total length, so `starts[i + 1]` is always readable
 * and the "does this offset fall inside item i" test needs no special case for the last item.
 */
export function itemStarts(lengths: readonly number[]): number[] {
  const starts: number[] = [0];
  for (const length of lengths) starts.push(starts[starts.length - 1] + Math.max(0, length));
  return starts;
}

/** Total characters on a page, given its per-item lengths. */
export function pageLength(lengths: readonly number[]): number {
  const starts = itemStarts(lengths);
  return starts[starts.length - 1];
}

/**
 * A page offset -> which item holds it, and where inside that item.
 *
 * Clamped rather than nullable at both ends. An offset past the end of the page is what a stored
 * highlight looks like after the same book is re-extracted by a different pdf.js version, or after a
 * corrupt row: painting a slightly wrong span beats refusing to paint anything, and the alternative
 * (drop it) would make a real highlight vanish with no way for the reader to tell why.
 *
 * `after` picks which side of an item BOUNDARY an offset lands on — false (the default) treats the
 * offset as the start of a span, so it belongs to the item beginning there; true treats it as an
 * END, so it belongs to the item that just finished. Without the distinction a range ending exactly
 * on a boundary would claim a zero-length slice of the next item and paint a stray box at the start
 * of the following line.
 */
export function locateOffset(
  lengths: readonly number[],
  offset: number,
  after = false,
): { index: number; withinItem: number } {
  const starts = itemStarts(lengths);
  const total = starts[starts.length - 1];
  const clamped = Math.min(Math.max(offset, 0), total);

  if (lengths.length === 0) return { index: 0, withinItem: 0 };

  for (let index = 0; index < lengths.length; index++) {
    const start = starts[index];
    const end = starts[index + 1];
    const inside = after ? clamped > start && clamped <= end : clamped >= start && clamped < end;
    if (inside) return { index, withinItem: clamped - start };
  }

  // Only reachable for an empty page (every item zero-length) or an offset of 0 with `after`.
  return after
    ? { index: lengths.length - 1, withinItem: Math.max(0, lengths[lengths.length - 1]) }
    : { index: 0, withinItem: 0 };
}

/** A slice of one text-layer item: characters `[from, to)` of item `index`. */
export interface ItemSlice {
  index: number;
  from: number;
  to: number;
}

/**
 * A page-offset span -> the per-item slices that cover it.
 *
 * This is the shape painting actually needs: one DOM `Range` per item, because a text layer's items
 * are siblings with no shared text node, so a single Range across several of them would need a
 * common ancestor and would still have to be sliced per item to get sensible client rects.
 *
 * Empty for a reversed or empty span. Zero-length slices are dropped rather than emitted — they
 * produce a zero-width rect, which paints as a one-pixel sliver at a line start.
 */
export function slicesForRange(
  lengths: readonly number[],
  startOffset: number,
  endOffset: number,
): ItemSlice[] {
  if (!(endOffset > startOffset)) return [];

  const start = locateOffset(lengths, startOffset);
  const end = locateOffset(lengths, endOffset, true);

  const slices: ItemSlice[] = [];
  for (let index = start.index; index <= end.index && index < lengths.length; index++) {
    const from = index === start.index ? start.withinItem : 0;
    const to = index === end.index ? end.withinItem : Math.max(0, lengths[index]);
    if (to > from) slices.push({ index, from, to });
  }

  return slices;
}

/**
 * The inverse, for a selection: two (item, offset-within-item) anchors -> the page span they cover.
 *
 * Returned normalised (`start <= end`) because a DOM selection made by dragging BACKWARDS reports
 * its anchor after its focus, and a highlight has no direction — storing one reversed would make
 * `slicesForRange` return nothing and the highlight would save successfully and paint nothing.
 */
export function offsetsForSelection(
  lengths: readonly number[],
  a: { index: number; withinItem: number },
  b: { index: number; withinItem: number },
): { startOffset: number; endOffset: number } {
  const starts = itemStarts(lengths);
  const at = (anchor: { index: number; withinItem: number }): number => {
    const index = Math.min(Math.max(anchor.index, 0), Math.max(0, lengths.length - 1));
    return starts[index] + Math.min(Math.max(anchor.withinItem, 0), Math.max(0, lengths[index] ?? 0));
  };

  const first = at(a);
  const second = at(b);
  return first <= second
    ? { startOffset: first, endOffset: second }
    : { startOffset: second, endOffset: first };
}
