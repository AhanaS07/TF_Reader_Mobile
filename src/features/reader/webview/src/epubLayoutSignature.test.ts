// Owner: Reader (Ahana).
//
// Which appearance changes move a glyph, exercised by CALLING the classifier — which is why it is a
// pure module and not an inline `if` in `applyAppearance`.
//
// >>> WHAT THESE CASES ACTUALLY GUARD. <<< An EPUB highlight is painted as SVG rects measured once,
// and epub.js re-measures them only when the chapter iframe's PIXEL SIZE changes — which a font-size
// change inside a fixed-size, column-paginated body does not do. So the shell has to notice the
// change itself, and this is the noticing. A field wrongly classified as paint-only is a highlight
// that silently detaches from its words at the next preference change, and nothing on screen says
// why. A field wrongly classified as geometry costs a needless remove-then-add of every annotation,
// which is only slow.
//
// The exhaustiveness of the two lists is checked by the COMPILER (`Unclassified` in the module), not
// here — a new `ReaderAppearance` field turns `npm run typecheck` red rather than slipping past a
// test that only knows about the fields someone remembered to name.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';

import { layoutSignature, type LayoutViewport } from './epubLayoutSignature';

const VIEWPORT: LayoutViewport = { width: 393, height: 852 };

const BASE: ReaderAppearance = {
  colorScheme: 'light',
  fg: '#111111',
  bg: '#ffffff',
  link: '#1a4f8b',
  fontFamily: '',
  customFontUri: null,
  fontSizePt: 12,
  lineHeight: 1.5,
  letterSpacingPx: 0,
  marginPx: 16,
  flow: 'paginated',
  spread: 'single',
  zoom: 1,
  reduceMotion: false,
  highContrast: false,
  boldText: false,
  dyslexiaFont: false,
  readableSpacing: false,
  announcePageChanges: true,
  announceChapterChanges: true,
};

/** Did changing exactly this one field move the signature? */
function moved(patch: Partial<ReaderAppearance>, viewport: LayoutViewport = VIEWPORT): boolean {
  return layoutSignature(BASE, VIEWPORT) !== layoutSignature({ ...BASE, ...patch }, viewport);
}

describe('fields that re-flow the chapter', () => {
  // The reported defect, and the reason this module exists: a highlight made at 12pt stayed where it
  // was painted when the reader moved to 13pt.
  it.each([
    ['fontSizePt', { fontSizePt: 13 }],
    ['lineHeight', { lineHeight: 1.6 }],
    ['letterSpacingPx', { letterSpacingPx: 1 }],
    ['marginPx', { marginPx: 24 }],
    ['fontFamily', { fontFamily: 'Georgia' }],
    ['flow', { flow: 'scrolled-doc' as const }],
    ['spread', { spread: 'double' as const }],
  ])('%s moves the layout', (_name, patch) => {
    expect(moved(patch)).toBe(true);
  });

  it('a custom font file moves the layout', () => {
    expect(moved({ customFontUri: 'data:font/woff2;base64,AAAA' })).toBe(true);
  });

  it('SWAPPING one custom font for another moves the layout', () => {
    // The fingerprint is sampled rather than hashed (the URI carries a whole font file), so this is
    // the case that proves the sampling discriminates rather than collapsing every data: URI to the
    // same value — which would leave a font swap re-flowing every line with nothing re-measured.
    const first = layoutSignature(
      { ...BASE, customFontUri: 'data:font/woff2;base64,QUJDREVGRw' },
      VIEWPORT,
    );
    const second = layoutSignature(
      { ...BASE, customFontUri: 'data:font/woff2;base64,WFlaMTIzNA' },
      VIEWPORT,
    );
    expect(first).not.toBe(second);
  });

  it('a viewport change moves the layout with no preference change at all', () => {
    // Rotation. `readerMetrics` scales type by viewport width and quantises the column to whole
    // lines, so every glyph moves even though nothing the user set has changed.
    expect(moved({}, { width: 852, height: 393 })).toBe(true);
  });
});

describe('fields that cannot move a glyph', () => {
  it.each([
    ['colorScheme', { colorScheme: 'dark' as const }],
    ['fg', { fg: '#eeeeee' }],
    ['bg', { bg: '#121212' }],
    ['link', { link: '#64d2ff' }],
    ['zoom', { zoom: 2 }],
    ['reduceMotion', { reduceMotion: true }],
    ['announcePageChanges', { announcePageChanges: false }],
    ['announceChapterChanges', { announceChapterChanges: false }],
  ])('%s leaves the layout alone', (_name, patch) => {
    expect(moved(patch)).toBe(false);
  });

  // NOT A STATEMENT THAT THESE ARE NON-TYPOGRAPHIC — three of the four plainly are. They are
  // paint-only because `epub.entry.ts` does not put them in the stylesheet yet, so today they change
  // nothing. Wiring one in without moving its key to `GeometryKey` reintroduces the drift, and this
  // case is where that shows up: it will start failing, which is the correct signal.
  it.each([
    ['highContrast', { highContrast: true }],
    ['boldText', { boldText: true }],
    ['dyslexiaFont', { dyslexiaFont: true }],
    ['readableSpacing', { readableSpacing: true }],
  ])('%s is not rendered by this shell yet, so it does not move the layout', (_name, patch) => {
    expect(moved(patch)).toBe(false);
  });

  it('an identical payload is not a change', () => {
    // The host re-sends on every prefs-store emission, not only on a delta, so this is the common
    // case rather than a degenerate one.
    expect(moved({})).toBe(false);
  });
});

describe('the pre-first-payload state', () => {
  // The caller compares signatures with `!==` and nothing else, so "nothing has been measured yet"
  // has to be a VALUE rather than a special case — otherwise the first payload after an open, which
  // lands before any chapter is laid out, reads as unchanged and skips the refresh that establishes
  // the baseline.
  it('has its own signature rather than being refused', () => {
    expect(layoutSignature(null, VIEWPORT)).toBe('none|393x852');
  });

  it('differs from any real appearance, so the first payload always counts as a change', () => {
    expect(layoutSignature(null, VIEWPORT)).not.toBe(layoutSignature(BASE, VIEWPORT));
  });
});
