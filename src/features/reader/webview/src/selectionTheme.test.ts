// Owner: Reader (Ahana).
//
// What a selection looks like, per theme. Worth testing by calling rather than by eye because the
// thing this guards against is invisible in the good case and total in the bad one: a selection the
// reader cannot see is indistinguishable, from their side, from a long press that did not work.

import { THEME_PALETTES } from '@/features/personalization/readerAppearance';

import { selectionBackground } from './selectionTheme';

describe('the selection fill', () => {
  it('uses the theme accent, translucent so the words show through', () => {
    // Translucency is the whole point: an opaque fill covers the text it is selecting, which on a
    // long-press-to-highlight flow hides exactly what the reader is deciding about.
    expect(selectionBackground('#1a4f8b', '#ffffff')).toBe('rgba(26, 79, 139, 0.32)');
  });

  it('accepts the short hex form', () => {
    expect(selectionBackground('#08f')).toBe('rgba(0, 136, 255, 0.32)');
  });

  it('resolves every shipped palette to a real colour', () => {
    // The three themes are what actually reach this. A palette that fell through to the fallback
    // would still be legible, but it would silently stop being the theme's own accent.
    for (const palette of Object.values(THEME_PALETTES)) {
      expect(selectionBackground(palette.link, palette.bg)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.32\)$/);
    }
  });

  it('falls back to a LIGHT scrim on a dark page and a DARK one on a light page', () => {
    // Reached only when the accent is unreadable. Never pretty, never invisible — which is the right
    // trade for a fallback.
    expect(selectionBackground(undefined, '#121212')).toBe('rgba(255, 255, 255, 0.30)');
    expect(selectionBackground(undefined, '#ffffff')).toBe('rgba(0, 0, 0, 0.18)');
  });

  it('judges the page by perceived lightness, not by raw channel size', () => {
    // Green and blue at FULL strength, and they land on opposite verdicts: green carries most of
    // what the eye reads as brightness, so a green page is light and a blue one is dark. An average
    // of the three channels would call both the same and put a white scrim on a page that is
    // already bright.
    expect(selectionBackground(undefined, '#00ff00')).toBe('rgba(0, 0, 0, 0.18)');
    expect(selectionBackground(undefined, '#0000ff')).toBe('rgba(255, 255, 255, 0.30)');
  });

  it('falls back rather than emitting a colour it did not understand', () => {
    // A non-hex value would otherwise be pasted into a CSS rule unchecked. Anything unparseable
    // takes the neutral path instead.
    expect(selectionBackground('rebeccapurple', '#ffffff')).toBe('rgba(0, 0, 0, 0.18)');
    expect(selectionBackground('#12345', '#ffffff')).toBe('rgba(0, 0, 0, 0.18)');
    expect(selectionBackground(undefined, undefined)).toBe('rgba(0, 0, 0, 0.18)');
  });
});
