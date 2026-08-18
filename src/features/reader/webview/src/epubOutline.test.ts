// Owner: Reader (Ahana).
//
// The EPUB shell's navigation flattener, EXECUTED.
//
// PORTED, NOT REWRITTEN: every case here comes from readerTemplate.test.ts's "the template's TOC
// flattener" and "the TOC is flattened, not truncated to its top level" blocks. Those pinned a
// property of the seam rather than of the extraction mechanism, so they survive the typechecked-
// WebView conversion — what changed is that they now import the function instead of lifting it out of
// an .html file with `new Function` over a source range.
//
// Two of the old cases are gone because the conversion DELETED WHAT THEY GUARDED, not because they
// stopped mattering:
//
//   * "caps depth at the same value the host clamps to" compared a `var MAX_TOC_DEPTH = 6` literal in
//     the template against the TS constant. There is one definition now — epubOutline.ts imports it —
//     so there is no second value to disagree with.
//   * "walks subitems" grepped for `flattenToc(item.subitems`. The recursion is tested by calling it
//     below, which is strictly stronger: the grep passed whether or not the walk was correct.

import { flattenToc, type NavItem } from '@/features/reader/webview/src/epubOutline';
import { MAX_TOC_DEPTH } from '@/features/reader/readerBridge';

describe('flattenToc', () => {
  it('emits a nested tree depth-first, in reading order', () => {
    const nav: NavItem[] = [
      {
        label: '  Part One  ', // real nav documents are full of stray whitespace
        href: 'p1.xhtml',
        subitems: [
          {
            label: 'Chapter 1',
            href: 'c1.xhtml',
            subitems: [{ label: 'Section 1.1', href: 'c1.xhtml#s1', subitems: [] }],
          },
          { label: 'Chapter 2', href: 'c2.xhtml' }, // no subitems key at all
        ],
      },
      { label: 'Part Two', href: 'p2.xhtml', subitems: [] },
    ];

    expect(flattenToc(nav, 0, [])).toEqual([
      { label: 'Part One', href: 'p1.xhtml', depth: 0 },
      { label: 'Chapter 1', href: 'c1.xhtml', depth: 1 },
      { label: 'Section 1.1', href: 'c1.xhtml#s1', depth: 2 },
      { label: 'Chapter 2', href: 'c2.xhtml', depth: 1 },
      { label: 'Part Two', href: 'p2.xhtml', depth: 0 },
    ]);
  });

  // THE SHAPE FAILURE THIS EXISTS FOR: a perfectly well-formed `toc` message carrying only the top
  // level of a book's navigation, which is what the reader shipped until 2026-08-14. Most real books
  // nest their chapters, so that omission hid most of the navigation while every field name and
  // message type stayed correct.
  it('does not stop at the top level', () => {
    const nav: NavItem[] = [
      { label: 'Part', href: 'p.xhtml', subitems: [{ label: 'Chapter', href: 'c.xhtml' }] },
    ];

    expect(flattenToc(nav, 0, []).map((i) => i.label)).toEqual(['Part', 'Chapter']);
  });

  it('keeps every entry of an absurdly deep tree, clamping only the depth', () => {
    // Losing a chapter is worse than mis-indenting one, so the cap flattens onto itself rather than
    // truncating the walk.
    let deepest: NavItem = { label: 'level 10', href: 'l10.xhtml' };
    for (let level = 9; level >= 1; level--) {
      deepest = { label: `level ${level}`, href: `l${level}.xhtml`, subitems: [deepest] };
    }

    const flat = flattenToc([deepest], 0, []);

    expect(flat).toHaveLength(10);
    expect(flat.map((item) => item.label)).toContain('level 10');
    expect(Math.max(...flat.map((item) => item.depth))).toBe(MAX_TOC_DEPTH);
  });

  it('survives the malformed entries a real nav document contains', () => {
    // A missing label is common (a nav point wrapping only an image), and epub.js will hand through
    // a null subitem for a malformed <navPoint>. The cast is the honest part: the runtime has to
    // survive input the types say cannot happen, because this comes from book content.
    const nav = [{ href: 'a.xhtml' }, null, { label: 'B', href: 'b.xhtml' }] as NavItem[];

    expect(flattenToc(nav, 0, [])).toEqual([
      { label: '', href: 'a.xhtml', depth: 0 },
      { label: 'B', href: 'b.xhtml', depth: 0 },
    ]);
  });

  it.each([[null], [undefined], [[]]])('returns the accumulator unchanged for %p', (items) => {
    expect(flattenToc(items as NavItem[] | null | undefined, 0, [])).toEqual([]);
  });

  // A nav point can legitimately carry no href (a heading that groups others). It must still appear,
  // because dropping it would silently reindent everything under it.
  it('keeps an entry with no href rather than dropping it', () => {
    const nav: NavItem[] = [{ label: 'Grouping heading', subitems: [{ label: 'C', href: 'c.xhtml' }] }];

    expect(flattenToc(nav, 0, [])).toEqual([
      { label: 'Grouping heading', href: '', depth: 0 },
      { label: 'C', href: 'c.xhtml', depth: 1 },
    ]);
  });
});
