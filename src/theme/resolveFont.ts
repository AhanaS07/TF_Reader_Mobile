// Open Sans and Aleo load as static (non-variable) Google Fonts: each weight
// registers under its own family name, e.g. "OpenSans_700Bold" — the exact
// loaded name has to be the `fontFamily` value, which is why tokens.ts calls
// this instead of building a name inline.
//
// CALLERS MUST NOT ALSO SET `fontWeight` ON THE TEXT STYLE. It is not merely
// ignored — on Android, pairing an explicit `fontWeight` with a custom
// fontFamily registered under a single style (every font here is, since
// expo-font registers each weight as its own NORMAL-style family) makes the
// renderer substitute the SYSTEM typeface for the requested weight instead of
// the one just loaded. Open Sans Bold happens to closely resemble Android's
// system Roboto Bold, so this was invisible for every `primary` style; it is
// not invisible for Aleo, which is where a whole session of "the font still
// doesn't look like Aleo" turned out to trace back to. The weight already
// lives in which font file this function picks — no caller should re-state
// it as `fontWeight`.

const openSansByWeight: Record<string, string> = {
  '300': 'OpenSans_300Light',
  '400': 'OpenSans_400Regular',
  '700': 'OpenSans_700Bold',
};

const aleoByWeight: Record<string, string> = {
  '300': 'Aleo_300Light',
  '400': 'Aleo_400Regular',
  '700': 'Aleo_700Bold',
};

export function resolveFont(family: 'primary' | 'secondary', weightValue: string): string {
  const table = family === 'primary' ? openSansByWeight : aleoByWeight;
  const fontFamily = table[weightValue];
  if (fontFamily === undefined) {
    throw new Error(`resolveFont: no ${family} font registered for weight "${weightValue}"`);
  }
  return fontFamily;
}
