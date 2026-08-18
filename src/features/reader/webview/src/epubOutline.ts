// Owner: Reader (Ahana).
//
// The EPUB shell's navigation flattening — the counterpart of pdfOutline.ts, and here for the same
// reason: it is the one place the EPUB entry SHAPES a bridge payload rather than forwarding a
// primitive, and the failure it can produce is invisible from above. A perfectly well-formed `toc`
// message carrying only the top level of a nested navigation tree looks fine to the host and loses
// most of a real book's chapters.
//
// Before the typechecked-WebView conversion this lived inside the template and was tested by
// extracting the function with `new Function` over a text region. It is a plain import now.

import { MAX_TOC_DEPTH, type ReaderTocItem } from '@/features/reader/readerBridge';

/**
 * One node of epub.js's `navigation.toc`. `subitems` is what makes it a tree
 * (epubjs/src/navigation.js:218).
 *
 * Every field is optional because this comes from a book's own navigation document — untrusted
 * input. A real one has been seen missing each of them.
 */
export interface NavItem {
  label?: string;
  href?: string;
  subitems?: NavItem[];
}

/**
 * Flatten epub.js's navigation tree depth-first into one ordered list with a `depth` marker.
 *
 * WHY FLAT AND NOT A TREE: the host indents by `depth` and cannot render a recursive structure, and
 * a recursive payload was the worst possible shape for the boundary this used to be half of by hand.
 * Order is the reading order — a parent immediately followed by its own subtree — so the flat list is
 * still navigable top to bottom.
 *
 * Depth is clamped to `MAX_TOC_DEPTH` rather than the entry being dropped: no entry ever disappears,
 * its indent just stops growing. The host re-clamps as well, because this originates in book content.
 */
export function flattenToc(
  items: NavItem[] | null | undefined,
  depth: number,
  into: ReaderTocItem[],
): ReaderTocItem[] {
  if (!items?.length) return into;

  for (const item of items) {
    if (!item) continue;

    into.push({ label: (item.label ?? '').trim(), href: item.href ?? '', depth });
    flattenToc(item.subitems, Math.min(depth + 1, MAX_TOC_DEPTH), into);
  }

  return into;
}
