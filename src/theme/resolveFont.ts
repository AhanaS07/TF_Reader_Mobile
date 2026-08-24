// Open Sans and Aleo load as static (non-variable) Google Fonts: each weight
// registers under its own family name, e.g. "OpenSans_700Bold". React Native's
// `fontWeight` style is ignored on a custom font like this — the exact loaded
// name has to be the `fontFamily` value, which is why tokens.ts calls this
// instead of building a name inline.

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
  return table[weightValue];
}
