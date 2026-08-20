# Custom fonts — reader wiring note (Personalization → Reader)

**For:** Ahana (Reader). **From:** Vaishnavi (Personalization). Complements `READER_PREFS_APPLICATION.md` §8.

Personalization's half is **built and in the tree**. This is the reader-side apply, which is yours.

## What's already done (my side)

- **6 bundled fonts** — `assets/fonts/{Inter,Poppins,Roboto,Merriweather,Lora,Montserrat}.ttf` (latin-subset, upright, regular, OFL — bundling permitted).
- **`fontCatalog.ts`** — `FONT_FAMILY_VALUES` (the 7 allowed: `system` + the 6), `isValidFontFamily`, `cssFamilyFor(family)`.
- **`fontFaceLoader.ts`** — `loadFontFaceSrc(family): Promise<string | null>` → the selected font as a `data:` URI for `@font-face`, or `null` for `system`/unknown. Loads only the chosen font.

No `readerAppearance.ts` change — I left the payload shape alone so this doesn't collide with your just-landed `applyAppearance`.

## Facts that constrain the design

- **EPUB only.** PDF renders its own embedded fonts — ignore font in `pdf.entry.ts`.
- **Zero sub-resource requests in the WebView**, so a font can't be fetched by URL — it must arrive **inlined as base64**, which is exactly what `loadFontFaceSrc` returns.
- `ReaderAppearance` already carries `fontFamily` (the bare family, e.g. `"Inter"`, from `resolveFont`) and `customFontUri` (currently `null`). `READER_PREFS_APPLICATION.md` §8 already earmarked `customFontUri` as the `@font-face` src — so **reuse it; no new field.**

## Host side — where you build & send `applyAppearance` (ReaderScreen)

You already do an async read before sending. Add the font load alongside it:

```ts
import { loadFontFaceSrc } from '@/features/personalization/fontFaceLoader';

const fontFaceSrc = await loadFontFaceSrc(prefs.font.family);        // data: URI or null
const appearance = { ...toReaderAppearance(prefs, env), customFontUri: fontFaceSrc };
sender({ type: 'applyAppearance', appearance });
```

`appearance.fontFamily` is already the bare family name (`"Inter"`); `customFontUri` now carries the bytes. Do this on **open and on the prefs-subscribe re-apply**, same as the rest of the payload.

## WebView side — `epub.entry.ts` apply path

When `customFontUri` is non-null, inject an `@font-face` and set the body family:

```css
@font-face {
  font-family: "<appearance.fontFamily>";
  src: url("<appearance.customFontUri>");   /* the data: URI */
  font-display: swap;                        /* show fallback text until the face is ready */
}
body { font-family: "<appearance.fontFamily>", <generic-fallback>; }
```

- **`font-display: swap`** matters — without it a slow face paints invisible text.
- When `customFontUri` is `null` (i.e. `system`), **don't set font-family** — keep the book's own font, exactly as today.
- `pdf.entry.ts`: no change.

**Fallback nicety (optional):** for the right generic per font (serif for Merriweather/Lora, sans for the rest) instead of one blanket generic, call `cssFamilyFor(prefs.font.family)` host-side and send that as the body value; the `@font-face` still declares the bare `fontFamily`. If you'd rather keep your existing single fallback, that's fine for v1.

## Safety

`customFontUri` is a `data:` URI *I* generate (not user input), and `fontFamily` is one of 7 known values (`isValidFontFamily` if you want a belt-and-braces check). The CSS-injection risk `READER_PREFS_APPLICATION.md` flagged for user-supplied fonts is gone — these are bundled — but keep your allow-list if you already have one.

## Verify on device

`loadFontFaceSrc` is native (expo-asset/expo-file-system), so it can't be unit-tested — verify on the simulator: pick each of the 6 fonts → the open EPUB re-renders in that font without a reopen; pick **System** → reverts to the book's own font.

## Ownership recap

- Mine: the 6 assets, `fontCatalog.ts`, `fontFaceLoader.ts` (done).
- Yours: the two wiring steps above (host overlay of `customFontUri`, and the `@font-face` inject in `epub.entry.ts`).
