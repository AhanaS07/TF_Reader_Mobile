// src/features/personalization/fontFaceLoader.ts
// Owner: Personalization (Vaishnavi).
//
// Loads ONE selected bundled font's bytes as a data: URI, for the @font-face the reader injects into
// the EPUB WebView. Separated from fontCatalog.ts because this half imports native modules
// (expo-asset, expo-file-system) — keeping it apart is what lets the catalog stay pure and unit-
// tested.
//
// WHY A data: URI AND NOT A PATH: the EPUB WebView makes zero sub-resource requests (navigation
// lockdown), so a font cannot be fetched by url() — it has to arrive inlined. Load only the font the
// user picked; never preload the set (each file is ~100-400 KB).
//
// Same asset resolution as readerAssets.ts / devContentSeed.ts: Asset.fromModule -> downloadAsync ->
// localUri, then the new expo-file-system File API to read bytes.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import type { FontFamily } from './fontCatalog';

/**
 * The bundled font files, keyed by family.
 *
 * Each is a latin-subset, upright, regular-weight static TTF in `assets/fonts/` (OFL — bundling is
 * permitted). Metro needs a STATIC require (a literal path, never a variable), which is the whole
 * reason this is a hand-written map rather than a loop. If a family is ever removed here,
 * loadFontFaceSrc returns null for it and the reader falls back to the generic family from
 * fontCatalog — no crash, just no custom face.
 */
const ASSET_MODULES: Partial<Record<Exclude<FontFamily, 'system'>, number>> = {
  Inter: require('../../../assets/fonts/Inter.ttf'),
  Poppins: require('../../../assets/fonts/Poppins.ttf'),
  Roboto: require('../../../assets/fonts/Roboto.ttf'),
  Merriweather: require('../../../assets/fonts/Merriweather.ttf'),
  Lora: require('../../../assets/fonts/Lora.ttf'),
  Montserrat: require('../../../assets/fonts/Montserrat.ttf'),
};

/**
 * The selected font as a `data:` URI for an @font-face `src`, or null to keep the book's own font.
 *
 * Returns null for 'system', for an unknown family, and for a bundled font whose file is not present
 * yet — all three hit the same early return, so nothing native runs in those cases.
 */
export async function loadFontFaceSrc(family: string): Promise<string | null> {
  const assetModule = (ASSET_MODULES as Record<string, number | undefined>)[family];
  if (assetModule === undefined) return null;

  const asset = Asset.fromModule(assetModule);
  // Not a network call for a bundled asset, but required — without it localUri is null in dev.
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;

  const base64 = await new File(uri).base64();
  // TTF is served as font/ttf; the WebView accepts it in @font-face src url(data:...). If the files
  // are converted to woff2 (smaller to inline), change the mime to font/woff2.
  return `data:font/ttf;base64,${base64}`;
}
