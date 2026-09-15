import { FONT_CATALOG, FONT_FAMILY_VALUES, cssFamilyFor, isValidFontFamily } from './fontCatalog';

describe('fontCatalog', () => {
  it('offers system plus the six bundled fonts', () => {
    expect(FONT_FAMILY_VALUES).toEqual([
      'system',
      'Inter',
      'Poppins',
      'Roboto',
      'Merriweather',
      'Lora',
      'Montserrat',
    ]);
    // 'system' is not a catalog entry — it means "no override".
    expect(FONT_CATALOG).toHaveLength(6);
  });

  it('validates known families and rejects everything else', () => {
    expect(isValidFontFamily('Inter')).toBe(true);
    expect(isValidFontFamily('system')).toBe(true);
    expect(isValidFontFamily('Comic Sans')).toBe(false);
    expect(isValidFontFamily(42)).toBe(false);
    expect(isValidFontFamily(undefined)).toBe(false);
  });

  it("returns '' for system and unknown, so the book's own font is kept", () => {
    expect(cssFamilyFor('system')).toBe('');
    expect(cssFamilyFor('unknown')).toBe('');
  });

  it('returns a quoted family with the matching generic fallback', () => {
    expect(cssFamilyFor('Inter')).toBe('"Inter", sans-serif');
    expect(cssFamilyFor('Merriweather')).toBe('"Merriweather", serif');
  });

  it('every catalog entry has a label and a generic fallback', () => {
    for (const entry of FONT_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(['serif', 'sans-serif']).toContain(entry.fallback);
    }
  });
});
