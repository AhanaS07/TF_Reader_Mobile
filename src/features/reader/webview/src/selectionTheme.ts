// Owner: Reader (Ahana).
//
// What a text selection looks like, per theme. Pure and unit-tested; its own module rather than a
// corner of readerMetrics.ts because BOTH shells need it and only one of them has any other use for
// the typography arithmetic — importing readerMetrics into pdf.entry.ts to reach one function would
// pull the whole stylesheet builder into a bundle that has no CSS text layer to build (and past a
// size ceiling buildReaderHtml.ts enforces on purpose).
//
// >>> WHY THE SELECTION COLOUR IS DERIVED AND NOT LEFT TO THE PLATFORM. <<<
// Selecting text is now the first half of making a highlight — long-press, then choose "Highlight"
// — so what the selection looks like is the feedback that says the gesture worked. WebKit's default
// selection fill is drawn opaque over the text on a `file://` document, which on the sepia and dark
// palettes reads as a hole punched in the page and hides the very words being selected.

/**
 * A CSS colour -> its three channels, or null if this is not a form we can read.
 *
 * DELIBERATELY ONLY HEX. Every colour that reaches here comes from `THEME_PALETTES` or from a prefs
 * record shaped by it, so hex is what exists; anything else falls through to the neutral scrim below
 * rather than to a wrong colour. Accepts both `#abc` and `#aabbcc`.
 */
function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Perceived lightness, 0..1. The standard luma weights — green carries most of what the eye reads
 * as brightness, which is why a mid-grey and a mid-green are not equally light. */
function luminance(color: { r: number; g: number; b: number }): number {
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
}

/**
 * The `::selection` background for a theme.
 *
 * >>> WHY THIS IS DERIVED AND NOT A CONSTANT. <<< WebKit's default selection blue is drawn OPAQUE
 * over the text on a `file://` document, which on the sepia and dark palettes reads as a hole in the
 * page and hides the very words being selected — and selecting text is now the first half of making
 * a highlight, so the reader has to be able to see what they have got.
 *
 * The theme's LINK colour at low alpha is the first choice: it is the palette's own accent, it is
 * already contrast-checked against the page, and a translucent tint darkens the text rather than
 * covering it. A palette whose link colour cannot be read falls back to a neutral scrim chosen by
 * the page's lightness — light on a dark page, dark on a light one — which is never pretty but is
 * never invisible either.
 */
export function selectionBackground(link?: string, bg?: string): string {
  const accent = link ? parseHex(link) : null;
  if (accent) return `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.32)`;

  const page = bg ? parseHex(bg) : null;
  return page && luminance(page) < 0.5 ? 'rgba(255, 255, 255, 0.30)' : 'rgba(0, 0, 0, 0.18)';
}
