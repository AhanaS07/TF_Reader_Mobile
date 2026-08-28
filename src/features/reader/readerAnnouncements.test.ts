// Owner: Reader (Ahana).
//
// The gates matter more than the wording. Every `null` case below is a defect if it starts
// returning a string: the failure mode in a reading app is talking over the book, not staying quiet.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type { ReaderPosition } from '@/features/reader/readerBridge';

import {
  appearanceChangeAnnouncement,
  chapterChangeAnnouncement,
  pageChangeAnnouncement,
  tocLabelForHref,
} from './readerAnnouncements';

const ON = { enabled: true, ttsSpeaking: false };

function page(n: number, total = 340): ReaderPosition {
  return { kind: 'page', page: n, pageCount: total };
}

function appearance(over: Partial<ReaderAppearance> = {}): ReaderAppearance {
  return {
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
    ...over,
  };
}

describe('pageChangeAnnouncement', () => {
  it('names the new page and the total', () => {
    expect(pageChangeAnnouncement(page(11), page(12), ON)).toBe('Page 12 of 340');
  });

  it('says nothing for the first position of an open', () => {
    // Not a change — announcing it narrates opening the book.
    expect(pageChangeAnnouncement(null, page(1), ON)).toBeNull();
  });

  it('says nothing when the page number did not move', () => {
    // THE PDF SCROLL-MODE CASE. `virtualize()` posts `relocated` from a rAF-coalesced scroll
    // listener, so it fires continuously through a single drag. Keyed off arrival instead of
    // change, one flick would announce dozens of times.
    expect(pageChangeAnnouncement(page(12), page(12), ON)).toBeNull();
  });

  it('says nothing for a reflowable EPUB, in either direction', () => {
    // A CFI is not a page. There is no honest string here, and "page turned" with no number is
    // noise — the chapter is the meaningful unit for a reflowable book.
    const cfi: ReaderPosition = { kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2)' };
    const other: ReaderPosition = { kind: 'cfi', cfi: 'epubcfi(/6/6!/4/2)' };

    expect(pageChangeAnnouncement(cfi, other, ON)).toBeNull();
    expect(pageChangeAnnouncement(cfi, page(3), ON)).toBeNull();
    expect(pageChangeAnnouncement(page(3), cfi, ON)).toBeNull();
  });

  it('respects the announce.pageChanges preference', () => {
    expect(pageChangeAnnouncement(page(11), page(12), { ...ON, enabled: false })).toBeNull();
  });

  it('stays silent while TTS is speaking', () => {
    // `autoContinueChapter` turns pages while reading aloud. Announcing here lands on top of the
    // sentence being spoken — one output device, neither stream ducking for the other.
    expect(pageChangeAnnouncement(page(11), page(12), { ...ON, ttsSpeaking: true })).toBeNull();
  });
});

describe('chapterChangeAnnouncement', () => {
  const one = { index: 0, href: 'ch1.xhtml' };
  const two = { index: 1, href: 'ch2.xhtml' };

  it('prefers the TOC label the reader would recognise', () => {
    expect(chapterChangeAnnouncement(one, two, 'The Cave', ON)).toBe('Chapter: The Cave');
  });

  it('falls back to a 1-based spine position when the book names nothing', () => {
    expect(chapterChangeAnnouncement(one, two, null, ON)).toBe('Chapter 2');
    expect(chapterChangeAnnouncement(one, two, '   ', ON)).toBe('Chapter 2');
  });

  it('says nothing when the href did not change', () => {
    // A `goTo` within the current chapter reports the same href. Turning a page inside one chapter
    // must not re-announce the chapter every time.
    expect(chapterChangeAnnouncement(one, { ...one }, 'Chapter One', ON)).toBeNull();
  });

  it('says nothing on the first relocation, or for a format with no spine', () => {
    expect(chapterChangeAnnouncement(null, two, 'The Cave', ON)).toBeNull();
    expect(chapterChangeAnnouncement(one, null, null, ON)).toBeNull();
  });

  it('respects the preference and the TTS suppression', () => {
    expect(chapterChangeAnnouncement(one, two, 'The Cave', { ...ON, enabled: false })).toBeNull();
    expect(chapterChangeAnnouncement(one, two, 'The Cave', { ...ON, ttsSpeaking: true })).toBeNull();
  });
});

describe('appearanceChangeAnnouncement', () => {
  const quiet = { ttsSpeaking: false };

  it('says nothing for the first resolved appearance', () => {
    expect(appearanceChangeAnnouncement(null, appearance(), quiet)).toBeNull();
  });

  it('says nothing when the resolved payload is unchanged', () => {
    // THE REASON THIS DIFFS THE RESOLVED VALUE RATHER THAN THE PREFS EDIT: trigger C re-resolves
    // and re-sends on every OS appearance tick, and `theme: 'system'` resolving to the same scheme
    // twice is not a change the user made.
    const before = appearance();
    expect(appearanceChangeAnnouncement(before, appearance(), quiet)).toBeNull();
  });

  it.each([
    [{ colorScheme: 'dark' as const }, 'Dark theme'],
    [{ colorScheme: 'sepia' as const }, 'Sepia theme'],
    [{ dyslexiaFont: true }, 'Dyslexia-friendly font on'],
    [{ fontFamily: 'Atkinson Hyperlegible' }, 'Font: Atkinson Hyperlegible'],
    [{ fontSizePt: 18.4 }, 'Text size 18 point'],
    [{ flow: 'scrolled-doc' as const }, 'Continuous scroll layout'],
    [{ spread: 'double' as const }, 'Two-page spread'],
    [{ highContrast: true }, 'High contrast on'],
    [{ boldText: true }, 'Bold text on'],
    [{ zoom: 1.25 }, 'Zoom 125 percent'],
  ])('names the field that changed: %o', (change, expected) => {
    expect(appearanceChangeAnnouncement(appearance(), appearance(change), quiet)).toBe(expected);
  });

  it('names one field, not every derived one, when a single tap moves several', () => {
    // Changing size from a menu also moves the resolved line height. Reading out every field
    // that shifted turns one tap into a paragraph.
    const said = appearanceChangeAnnouncement(
      appearance(),
      appearance({ fontSizePt: 20, lineHeight: 1.8, letterSpacingPx: 1 }),
      quiet,
    );

    expect(said).toBe('Text size 20 point');
  });

  it('stays silent while TTS is speaking', () => {
    expect(
      appearanceChangeAnnouncement(appearance(), appearance({ colorScheme: 'dark' }), {
        ttsSpeaking: true,
      }),
    ).toBeNull();
  });
});

describe('tocLabelForHref', () => {
  const toc = [
    { label: 'Chapter One', target: { kind: 'href' as const, href: 'ch1.xhtml' }, depth: 0 },
    { label: 'Part Two', target: { kind: 'href' as const, href: 'ch2.xhtml' }, depth: 0 },
    { label: 'A Sub-Heading', target: { kind: 'href' as const, href: 'ch2.xhtml#part2' }, depth: 1 },
    { label: 'Not navigable', target: { kind: 'href' as const, href: '' }, depth: 0 },
    { label: 'A PDF row', target: { kind: 'page' as const, page: 4 }, depth: 0 },
  ];

  it('finds the entry that names a spine item', () => {
    expect(tocLabelForHref(toc, 'ch1.xhtml')).toBe('Chapter One');
  });

  it('matches across a fragment on either side', () => {
    // A nav document routinely points at `ch4.xhtml#part2` while the spine item epub.js reports is
    // plain `ch4.xhtml`. Matching raw strings would miss exactly the books with the best outlines.
    expect(tocLabelForHref(toc, 'ch2.xhtml#anything')).toBe('Part Two');
  });

  it('prefers the chapter over a sub-heading in the same file', () => {
    // `epubOutline.ts` flattens depth-first, so the chapter's own row comes first.
    expect(tocLabelForHref(toc, 'ch2.xhtml')).toBe('Part Two');
  });

  it('returns null when nothing addresses the href', () => {
    expect(tocLabelForHref(toc, 'ch9.xhtml')).toBeNull();
    expect(tocLabelForHref([], 'ch1.xhtml')).toBeNull();
  });

  it('never matches an empty href against a non-navigable row', () => {
    // An empty href is `epubOutline.ts`'s "this entry addresses nothing". Matching it would name
    // every unnamed section after the first unnavigable row in the outline.
    expect(tocLabelForHref(toc, '')).toBeNull();
    expect(tocLabelForHref(toc, '#fragment-only')).toBeNull();
  });
});
