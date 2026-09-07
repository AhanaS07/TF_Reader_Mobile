// src/features/personalization/fontCatalog.ts
// Owner: Personalization (Vaishnavi).
//
// The six app-bundled reading fonts a user can pick for EPUB, plus 'system' (keep the book's own
// font). This is the PURE half — family names, picker labels, and the CSS family value. No native
// imports and no font BYTES, so it is unit-testable and safe to import anywhere. The byte loading
// (expo-asset -> base64 -> data: URI, for the @font-face the reader injects) is fontFaceLoader.ts,
// kept separate precisely so this stays pure.
//
// BUNDLED, NOT UPLOADED: user-supplied fonts are out of scope. Six curated fonts ship with the app
// and the picker offers exactly these. Font family is EPUB-ONLY — a PDF renders its own embedded
// fonts and cannot be re-fonted.
//
// TRANSPORT: the EPUB WebView makes zero sub-resource requests, so a font cannot be fetched by URL —
// it must arrive inlined as base64 in an @font-face. That is why fontFaceLoader exists and why this
// is more than "set font-family". See READER_PREFS_APPLICATION.md §8.

/** Everything the font picker may store in `prefs.font.family`. 'system' = no override. */
export const FONT_FAMILY_VALUES = [
  'system',
  'Inter',
  'Poppins',
  'Roboto',
  'Merriweather',
  'Lora',
  'Montserrat',
] as const;

export type FontFamily = (typeof FONT_FAMILY_VALUES)[number];

/** A bundled reading font. 'system' is deliberately NOT an entry — it means "no override". */
export interface FontCatalogEntry {
  /** Stored in prefs.font.family, and the CSS family name. */
  family: Exclude<FontFamily, 'system'>;
  /** What the settings picker shows. */
  label: string;
  /**
   * Generic fallback appended after the family. Load-bearing, not cosmetic: until the @font-face
   * paints (or if its file is missing) the book must fall back to a font of the SAME kind rather
   * than flipping serif<->sans mid-open.
   */
  fallback: 'serif' | 'sans-serif';
}

// Merriweather and Lora are reading serifs; the other four are sans. All six are Google Fonts under
// the OFL, which permits bundling.
export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  { family: 'Inter', label: 'Inter', fallback: 'sans-serif' },
  { family: 'Poppins', label: 'Poppins', fallback: 'sans-serif' },
  { family: 'Roboto', label: 'Roboto', fallback: 'sans-serif' },
  { family: 'Merriweather', label: 'Merriweather', fallback: 'serif' },
  { family: 'Lora', label: 'Lora', fallback: 'serif' },
  { family: 'Montserrat', label: 'Montserrat', fallback: 'sans-serif' },
];

export function isValidFontFamily(value: unknown): value is FontFamily {
  return typeof value === 'string' && (FONT_FAMILY_VALUES as readonly string[]).includes(value);
}

/**
 * The CSS `font-family` value the reader should apply, or '' to leave the book's own font.
 *
 * '' for 'system' and for anything not in the catalog — the same "empty means don't override"
 * convention `resolveFont()` already uses. A bundled font returns `"Inter", sans-serif`: the quoted
 * family the @font-face defines, plus the generic so it degrades to the right kind before the face
 * paints. This is the COMPLETE value — the reader should not append a second fallback onto it.
 */
export function cssFamilyFor(family: string): string {
  const entry = FONT_CATALOG.find((f) => f.family === family);
  return entry ? `"${entry.family}", ${entry.fallback}` : '';
}
