// src/features/accessibility/highContrastColors.ts
// Owner: Accessibility (Hruthik).
//
// The high-contrast colour "recipe" — `readerAppearance.ts`'s own doc comment leaves this
// unspecified on purpose ("the contrast recipe is Reader/Hruthik's, at apply time"). This file is
// that recipe: two pure functions, no design decisions left for a caller to make, only wiring.
//
// `accessibility.display.highContrast` is deliberately independent of colour scheme (dark +
// high-contrast is a valid combination — see accessibility.ts), so both functions take the
// resolved scheme and return the SAME shape of override regardless of which one it is; 'sepia' maps
// onto the light pair, since sepia is a light-background scheme and there is no separate
// high-contrast-on-sepia design.

/** Mirrors `ResolvedColorScheme` from `readerAppearance.ts` without importing it — this file stays
 * free of any dependency on another feature's module, same as its values-only shape. */
export type ColorScheme = 'light' | 'dark' | 'sepia';

/** Overrides for `ReaderAppearance.fg`/`bg`/`link` before the appearance crosses the bridge. */
export interface HighContrastReaderColors {
  fg: string;
  bg: string;
  link: string;
}

/** Overrides for native RN `StyleSheet` chrome — toolbar/panel backgrounds, focus rings, selected/active chip states. */
export interface HighContrastPalette {
  bg: string;
  fg: string;
  border: string;
  accent: string;
}

/**
 * WCAG-AAA pair (21:1 body contrast) per scheme, for the EPUB body/background/link colours.
 * Link colours are chosen to stay clearly distinguishable from body text against their background.
 */
export function getHighContrastReaderColors(colorScheme: ColorScheme): HighContrastReaderColors {
  if (colorScheme === 'dark') {
    return { fg: '#FFFFFF', bg: '#000000', link: '#FFFF00' };
  }
  // 'light' and 'sepia' share the same high-contrast pair.
  return { fg: '#000000', bg: '#FFFFFF', link: '#0000EE' };
}

/**
 * The same pair, shaped for native `StyleSheet` use — `accent` doubles as the focus-ring and
 * selected/active-chip colour, reusing `getHighContrastReaderColors`'s link colour so the native
 * chrome and the EPUB content read as one palette rather than two.
 */
export function getHighContrastPalette(colorScheme: ColorScheme): HighContrastPalette {
  const { fg, bg, link } = getHighContrastReaderColors(colorScheme);
  return { bg, fg, border: fg, accent: link };
}
