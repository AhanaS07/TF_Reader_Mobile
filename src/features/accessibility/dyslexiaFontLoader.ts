// src/features/accessibility/dyslexiaFontLoader.ts
// Owner: Accessibility (Hruthik).
//
// Loads the bundled dyslexia-friendly font's bytes as a data: URI, for the @font-face the reader
// injects into the EPUB WebView. Deliberately independent of Personalization's fontFaceLoader.ts /
// fontCatalog.ts: `accessibility.text.dyslexiaFont` is its own boolean, orthogonal to `font.family`,
// not a new FontFamily value — same asset-loading pattern as fontFaceLoader.ts, kept in its own file
// on purpose rather than added to another feature's ASSET_MODULES map.
//
// WHY A data: URI AND NOT A PATH: same reason as fontFaceLoader.ts — the EPUB WebView makes zero
// sub-resource requests (navigation lockdown), so a font cannot be fetched by url(); it has to
// arrive inlined.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

// Metro needs a static require (a literal path, never a variable) — same constraint
// fontFaceLoader.ts's ASSET_MODULES documents.
const DYSLEXIA_FONT_ASSET = require('../../../assets/fonts/OpenDyslexic3-Regular.ttf') as number;

/**
 * The dyslexia-friendly font as a `data:` URI for an @font-face `src`.
 *
 * No null-returning "unknown family" branch here (unlike `loadFontFaceSrc`) — there is exactly one
 * asset, and it is bundled, so the only failure mode is the same one Metro would already refuse to
 * build.
 */
export async function loadDyslexiaFontFaceSrc(): Promise<string> {
  const asset = Asset.fromModule(DYSLEXIA_FONT_ASSET);
  // Not a network call for a bundled asset, but required — without it localUri is null in dev.
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;

  const base64 = await new File(uri).base64();
  return `data:font/ttf;base64,${base64}`;
}
