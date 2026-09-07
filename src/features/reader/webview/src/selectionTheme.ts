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

/** The one CSS colour name this ever sees today (`highlightStore`'s own default) — resolved because
 * `parseHex` deliberately only reads hex, and a named colour still needs its channels to judge
 * contrast against the page. Anything not in this map is passed to `parseHex` as-is, so a future
 * hex-stored colour needs no change here. */
const NAMED_COLOR_HEX: Record<string, string> = { yellow: '#ffff00' };

function resolveChannels(color: string): { r: number; g: number; b: number } | null {
  return parseHex(NAMED_COLOR_HEX[color.toLowerCase()] ?? color);
}

/**
 * A saved highlight's rendered fill and blend mode, for the current page. `multiply` is right on a
 * neutral light page, but reads wrong elsewhere: near-invisible on a dark page (multiplying by
 * near-black stays near-black — use `screen`, its inverse, instead), and low-contrast on a warm
 * page like sepia against a similarly warm/light fill (darken the same colour instead).
 */
export function highlightFill(color: string, bg?: string): { fill: string; blend: 'multiply' | 'screen' } {
  const page = bg ? parseHex(bg) : null;
  if (!page) return { fill: color, blend: 'multiply' };

  if (luminance(page) < 0.35) return { fill: color, blend: 'screen' };

  const swatch = resolveChannels(color);
  if (swatch) {
    const warm = (c: { r: number; g: number; b: number }): boolean => c.r > c.b && c.g > c.b;
    const closeInLightness = Math.abs(luminance(page) - luminance(swatch)) < 0.25;

    if (warm(page) && warm(swatch) && closeInLightness) {
      return {
        fill: `rgb(${Math.round(swatch.r * 0.7)}, ${Math.round(swatch.g * 0.55)}, ${Math.round(swatch.b * 0.7)})`,
        blend: 'multiply',
      };
    }
  }

  return { fill: color, blend: 'multiply' };
}

/**
 * The `fill-opacity` for the spoken-WORD wash, given the blend `highlightFill` chose for the page.
 *
 * >>> THE WORD IS THE SAME COLOUR AS THE SENTENCE AT A HIGHER OPACITY, AND THAT IS THE DESIGN. <<<
 * Both layers go through one `highlightFill(TTS_SPOKEN_COLOR, bg)` call, so they always get the same
 * fill and the same blend — which means more opacity is more prominent on EVERY page, by
 * construction, and the pair can never invert. A second HUE would have to be re-argued against three
 * page colours, against `user`'s fill underneath it and against `search`'s stroke, and re-argued
 * again the next time a palette moves. HIGHLIGHT_LAYERS.md §3 records this as two intensities of one
 * channel rather than a fourth owner.
 *
 * >>> WHY THE NUMBER DEPENDS ON THE BLEND, NOT ON THE THEME. <<< The two blends fail in opposite
 * directions, so one opacity cannot serve both:
 *
 *  - `multiply` CAN ONLY DARKEN. The glyph is already the darkest thing on a light or sepia page, so
 *    it is near a fixed point; more alpha darkens the PAGE under the word and text contrast goes up.
 *    Alpha is capped by nothing, so it is set high enough to be unmistakable.
 *  - `screen` CAN ONLY LIGHTEN. On a dark page the glyph is the LIGHTEST thing, so more alpha drives
 *    the background up toward the glyph and the text under the word goes muddy. Alpha is capped by
 *    readability here, and the low value is not timidity — the sentence wash on a near-black page is
 *    so dim that 0.3 is still a ~3.5x step in linear luminance.
 *
 * Keyed on `blend` rather than on luminance so there is ONE cutoff in this file: move
 * `highlightFill`'s 0.35 and this follows automatically. It also covers Accessibility's
 * `highContrast` pairs for free — those arrive as `fg`/`bg` on the appearance, so the answer is a
 * function of the page that actually arrives, not of a theme name.
 *
 * >>> BOTH NUMBERS ARE COMPUTED, NEVER OBSERVED ON HARDWARE. <<< They come from compositing
 * `THEME_PALETTES` (readerAppearance.ts) against the 0.2 sentence wash and checking WCAG contrast —
 * light 0.5 ~= 14:1 glyph contrast, sepia 0.5 ~= 4.8:1, dark 0.3 ~= 4.6:1, and dark at 0.5 would be
 * ~= 2.7:1, which is why it is not 0.5. The device pass belongs to Accessibility (Hruthik), and
 * THESE TWO NUMBERS ARE WHAT IT IS FOR — not "does a highlight appear". The two failure signatures
 * to look for:
 *
 *  - DARK: the word wash lifts the page toward the glyph and the text under it goes muddy -> lower
 *    the `screen` value.
 *  - LIGHT / SEPIA: the word does not separate from the sentence wash around it -> raise the
 *    `multiply` value, which multiply makes safe.
 *
 * Either correction is a one-line change here, in a pure unit-tested module, with no shell edit.
 */
export function spokenWordOpacity(blend: 'multiply' | 'screen'): string {
  return blend === 'screen' ? '0.3' : '0.5';
}

/**
 * The search-match OUTLINE colour for the current page — HIGHLIGHT_LAYERS.md §3's third channel.
 *
 * >>> AN OUTLINE, NOT A FILL, AND THAT IS THE WHOLE DESIGN OF THE CHANNEL. <<< `user` owns the
 * solid fill and `tts` owns the translucent wash; `search` is transient and has to be findable
 * *over* a user highlight without hiding it, so it is a border with no fill at all. §4's z-order
 * (`tts > search > user`) is priority, not mutual exclusion — nothing below is removed to show it.
 *
 * WHY BLUE/CYAN AND NOT THE THEME'S OWN ACCENT: unlike `selectionBackground`, this must not collide
 * with the layer beneath it. The link colour is already spent on selection, and a highlight's
 * stored colour is user-chosen (yellow today, anything later) — an outline drawn in a neighbouring
 * hue reads as part of the fill rather than as a separate mark. Blue is the one hue nothing else in
 * this reader paints in.
 *
 * ONE HELPER, BOTH SHELLS: EPUB passes it as the SVG `stroke` presentation attribute, PDF as a
 * `border-color`. Splitting it in two is how the user layer's fill and blend drifted apart before.
 */
export function matchStroke(bg?: string): string {
  const page = bg ? parseHex(bg) : null;
  // No readable page colour is the same case `highlightFill` treats as "neutral light": the shells
  // default `currentBg` to white, so the light-page answer is the right guess when in doubt.
  if (!page) return '#0a84ff';

  // Lifted towards cyan on a near-black page for the reason `screen` exists in `highlightFill`: a
  // mid-blue stroke on dark grey is barely a line, and this layer says "the thing you searched for
  // is HERE".
  if (luminance(page) < 0.35) return '#64d2ff';

  // A warm, pale page (sepia) washes out the lighter blue the way it washes out a warm fill —
  // deepen it rather than change hue, so the channel still reads as one colour across themes.
  if (page.r > page.b && page.g > page.b && luminance(page) > 0.6) return '#0a5fd0';

  return '#0a84ff';
}
