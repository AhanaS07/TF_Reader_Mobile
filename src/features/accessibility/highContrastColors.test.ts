// Owner: Accessibility (Hruthik).
//
// Pins the documented WCAG-AAA pairs and the sepia→light fallback — these are design decisions,
// not derivable from the type, so they need a test that fails if someone "simplifies" a value.

import { getHighContrastPalette, getHighContrastReaderColors } from './highContrastColors';

describe('getHighContrastReaderColors', () => {
  it('returns the dark AAA pair for a dark scheme', () => {
    expect(getHighContrastReaderColors('dark')).toEqual({
      fg: '#FFFFFF',
      bg: '#000000',
      link: '#FFFF00',
    });
  });

  it('returns the light AAA pair for a light scheme', () => {
    expect(getHighContrastReaderColors('light')).toEqual({
      fg: '#000000',
      bg: '#FFFFFF',
      link: '#0000EE',
    });
  });

  it('maps sepia onto the same pair as light — there is no separate high-contrast-on-sepia design', () => {
    expect(getHighContrastReaderColors('sepia')).toEqual(getHighContrastReaderColors('light'));
  });
});

describe('getHighContrastPalette', () => {
  it('derives native chrome colours from the same reader colours, so both surfaces read as one palette', () => {
    const reader = getHighContrastReaderColors('dark');

    expect(getHighContrastPalette('dark')).toEqual({
      bg: reader.bg,
      fg: reader.fg,
      border: reader.fg,
      accent: reader.link,
    });
  });
});
