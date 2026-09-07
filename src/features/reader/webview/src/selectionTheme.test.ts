// Owner: Reader (Ahana).
//
// What a selection looks like, per theme. Worth testing by calling rather than by eye because the
// thing this guards against is invisible in the good case and total in the bad one: a selection the
// reader cannot see is indistinguishable, from their side, from a long press that did not work.

import { THEME_PALETTES } from '@/features/personalization/readerAppearance';

import {
  highlightFill,
  matchStroke,
  selectionBackground,
  spokenWordOpacity,
} from './selectionTheme';

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
      expect(selectionBackground(palette.link, palette.bg)).toMatch(
        /^rgba\(\d+, \d+, \d+, 0\.32\)$/,
      );
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

describe('a saved highlight fill', () => {
  it('leaves the stored colour and multiply alone on a neutral, light page', () => {
    // The case this was already right for — nothing here should move.
    expect(highlightFill('yellow', THEME_PALETTES.light.bg)).toEqual({
      fill: 'yellow',
      blend: 'multiply',
    });
  });

  it('switches to screen on a dark page, where multiply would nearly vanish', () => {
    // Multiplying by a near-black page stays near black regardless of the fill colour — screen does
    // the opposite of multiply and reads close to the fill colour itself instead.
    expect(highlightFill('yellow', THEME_PALETTES.dark.bg)).toEqual({
      fill: 'yellow',
      blend: 'screen',
    });
  });

  it('darkens a warm fill on an equally warm, similarly light page (sepia)', () => {
    // Confirmed on-device: plain yellow multiplied against sepia's own warm, pale tone barely
    // shifts — both are warm and both are light, so there is little for multiply to do. A darker,
    // more saturated shade of the same colour still reads as "this highlight" while actually
    // standing out from the page.
    expect(highlightFill('yellow', THEME_PALETTES.sepia.bg)).toEqual({
      fill: 'rgb(179, 140, 0)',
      blend: 'multiply',
    });
  });

  it('leaves an unparseable stored colour and an unparseable page alone, rather than guessing', () => {
    expect(highlightFill('yellow', undefined)).toEqual({ fill: 'yellow', blend: 'multiply' });
    expect(highlightFill('rebeccapurple', THEME_PALETTES.sepia.bg)).toEqual({
      fill: 'rebeccapurple',
      blend: 'multiply',
    });
  });

  it('does not darken a cool fill on a warm page — only warm-on-warm is low-contrast', () => {
    // A blue fill against sepia already has plenty of hue contrast; the sepia-specific darkening is
    // for a fill that shares the page's own warmth, not for every fill that happens to be light.
    expect(highlightFill('#3a7bd5', THEME_PALETTES.sepia.bg)).toEqual({
      fill: '#3a7bd5',
      blend: 'multiply',
    });
  });
});

// --- the search-match outline -------------------------------------------------------------------

describe('the search-match stroke', () => {
  it('gives every shipped theme a stroke, and a distinct one where the page demands it', () => {
    const light = matchStroke(THEME_PALETTES.light.bg);
    const dark = matchStroke(THEME_PALETTES.dark.bg);
    const sepia = matchStroke(THEME_PALETTES.sepia.bg);

    // Three grounds, three answers — and the dark one is the whole reason this is derived rather
    // than a constant: a mid-blue line on a near-black page is barely a line, which is the same
    // failure `highlightFill`'s `screen` branch exists to fix for the fill.
    expect(new Set([light, dark, sepia]).size).toBe(3);
    for (const stroke of [light, dark, sepia]) expect(stroke).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('stays in the blue channel on every theme', () => {
    // The channel has to read as ONE colour across themes, or the outline stops meaning "search"
    // and starts meaning "something changed". Deepened or lifted, never re-hued: blue dominant on
    // all three.
    for (const bg of Object.values(THEME_PALETTES).map((palette) => palette.bg)) {
      const stroke = matchStroke(bg);
      const r = Number.parseInt(stroke.slice(1, 3), 16);
      const b = Number.parseInt(stroke.slice(5, 7), 16);
      expect(b).toBeGreaterThan(r);
    }
  });

  it('falls back to the light-page stroke when the page colour cannot be read', () => {
    // Both shells default `currentBg` to white, so light is the right guess when there is nothing
    // to go on — the same reasoning `highlightFill` uses for its own unparseable case.
    expect(matchStroke(undefined)).toBe(matchStroke(THEME_PALETTES.light.bg));
    expect(matchStroke('rgb(255, 255, 255)')).toBe(matchStroke(THEME_PALETTES.light.bg));
  });

  it('does not deepen for a warm page that is DARK — that is the lifted case, not the sepia one', () => {
    // A warm dark page (a hypothetical future theme) must take the dark branch. Checking the order
    // of the two conditions, which is the kind of thing that reads fine and behaves backwards.
    expect(matchStroke('#3a2010')).toBe(matchStroke(THEME_PALETTES.dark.bg));
  });
});

// --- the spoken-word wash -----------------------------------------------------------------------

describe('the spoken-word opacity', () => {
  it('sits above the sentence wash on every shipped theme', () => {
    // 0.2 is the sentence's own `fill-opacity` (`ttsSpokenStyles` in epub.entry.ts). The word is the
    // SAME fill and the SAME blend at a higher alpha, so "is the word more prominent" reduces to
    // this comparison on every page — which is the entire reason the pair cannot invert.
    for (const bg of Object.values(THEME_PALETTES).map((palette) => palette.bg)) {
      const { blend } = highlightFill('#ffd500', bg);
      expect(Number(spokenWordOpacity(blend))).toBeGreaterThan(0.2);
    }
  });

  it('backs off on a page that is lightened rather than darkened', () => {
    // The asymmetry is the design (see the function's own note): `multiply` can only darken, so the
    // glyph is near a fixed point and alpha is uncapped; `screen` can only lighten, so alpha drives
    // the background UP toward the glyph and is capped by whether the text stays readable.
    expect(Number(spokenWordOpacity('screen'))).toBeLessThan(Number(spokenWordOpacity('multiply')));
  });

  it('gives the dark theme the screen value and the other two the multiply value', () => {
    // Keyed on the BLEND, not on a theme name — so this asserts the crossing, not the constants.
    // Move `highlightFill`'s 0.35 luminance cutoff and this follows it, which is the point.
    const opacityFor = (bg: string): string =>
      spokenWordOpacity(highlightFill('#ffd500', bg).blend);

    expect(opacityFor(THEME_PALETTES.dark.bg)).toBe(spokenWordOpacity('screen'));
    expect(opacityFor(THEME_PALETTES.light.bg)).toBe(spokenWordOpacity('multiply'));
    expect(opacityFor(THEME_PALETTES.sepia.bg)).toBe(spokenWordOpacity('multiply'));
  });

  it('stays translucent on both branches', () => {
    // HIGHLIGHT_LAYERS.md §3's interim rule for this owner is "keep TTS translucent so it layers
    // rather than masks". An opacity of 1 would mask the glyphs it is meant to be marking.
    for (const blend of ['multiply', 'screen'] as const) {
      expect(Number(spokenWordOpacity(blend))).toBeGreaterThan(0);
      expect(Number(spokenWordOpacity(blend))).toBeLessThan(1);
    }
  });
});
