// Owner: Reader (Ahana).
//
// The override is the one place the Reader overrules a stored preference, so what is pinned here is
// both halves of that: WHEN it fires, and that it fires on nothing else.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';

import { a11yFlowOverride, effectiveLayoutFlow, flowOverrideApplied } from './readerA11yLayout';

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

describe('flowOverrideApplied', () => {
  it('is true only for paginated flow with a screen reader running', () => {
    expect(flowOverrideApplied('paginated', true)).toBe(true);
    expect(flowOverrideApplied('paginated', false)).toBe(false);
    expect(flowOverrideApplied('scrolled-doc', true)).toBe(false);
    expect(flowOverrideApplied('scrolled-doc', false)).toBe(false);
  });

  it('is false when the user already chose scrolled', () => {
    // NOT the same as "the override is unnecessary" — it is that nothing was taken from the user,
    // so ReaderScreen must not show its notice and the prefs menu must not disable its Flow rows.
    // Getting this wrong tells a scrolled-by-choice reader their preference was overridden.
    expect(flowOverrideApplied('scrolled-doc', true)).toBe(false);
  });
});

describe('effectiveLayoutFlow', () => {
  it('reports scrolled for the overridden case and passes everything else through', () => {
    expect(effectiveLayoutFlow('paginated', true)).toBe('scrolled-doc');
    expect(effectiveLayoutFlow('paginated', false)).toBe('paginated');
    expect(effectiveLayoutFlow('scrolled-doc', true)).toBe('scrolled-doc');
    expect(effectiveLayoutFlow('scrolled-doc', false)).toBe('scrolled-doc');
  });
});

describe('a11yFlowOverride', () => {
  it('switches paginated to scrolled and forces a single spread', () => {
    // The spread half is load-bearing: scrolled + double is the combination DevPreferencesMenu
    // resets on sight, because neither renderer can honour it.
    const result = a11yFlowOverride(appearance({ flow: 'paginated', spread: 'double' }), true);

    expect(result.flow).toBe('scrolled-doc');
    expect(result.spread).toBe('single');
  });

  it('leaves every other field of the payload alone', () => {
    const input = appearance({ flow: 'paginated', fontSizePt: 19, colorScheme: 'sepia' });
    const result = a11yFlowOverride(input, true);

    expect(result).toEqual({ ...input, flow: 'scrolled-doc', spread: 'single' });
  });

  it('returns the input unchanged, by reference, when it does not apply', () => {
    // Identity, not just equality: the whole payload is re-sent on every OS appearance tick, and a
    // fresh object on each pass would defeat any caller that diffs to decide whether to speak.
    const off = appearance({ flow: 'paginated' });
    expect(a11yFlowOverride(off, false)).toBe(off);

    const alreadyScrolled = appearance({ flow: 'scrolled-doc', spread: 'single' });
    expect(a11yFlowOverride(alreadyScrolled, true)).toBe(alreadyScrolled);
  });
});
