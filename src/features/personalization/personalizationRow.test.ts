// personalizationRow.test.ts — round-trip check for the SQLite schema adapter.
// Run: npm test    (needs the Jest/Expo test stack — not installed yet).
//
// Proves toPersonalizationRow → fromPersonalizationRow is LOSSLESS for the
// personalization slice: what we write to Karthik's `personalization` row is
// exactly what we read back. Catches value bugs a typecheck can't see (dropped
// fields, bool↔0/1 flips, ms↔ISO precision loss, nested↔flat misplacement).
//
// accessibility is intentionally dropped (it's Hruthik's separate table), so we
// compare against the personalization slice, not the whole SharedPrefs.

import {
  toPersonalizationRow,
  fromPersonalizationRow,
  PersonalizationPrefs,
} from '@/features/personalization/personalizationRow';
import type { SharedPrefs } from '@/shared/contracts';

// Deliberately NON-default values so a forgotten/misplaced field is visible.
const original: SharedPrefs = {
  id: 'p1',
  userId: 'u1',
  theme: 'sepia',
  font: { family: 'Georgia', customFontUri: 'file:///fonts/my.ttf' },
  typography: { size: 18, lineHeight: 1.6, spacing: 0.5, margins: 24 },
  layout: { flow: 'scrolled-doc', spread: 'double' },
  zoom: { level: 1.25 },
  updatedAt: Date.UTC(2026, 7, 11, 12, 0, 0), // fixed ms — no wall-clock
  isDeleted: false,
  synced: false,
  accessibility: {
    dyslexiaFont: true,
    highContrast: false,
    reduceMotion: true,
    screenReaderHints: false,
  },
};

// The personalization slice = original minus accessibility (what the adapter owns).
const { accessibility, ...expectedSlice } = original;
const slice: PersonalizationPrefs = expectedSlice;

describe('personalizationRow adapter (SQLite schema)', () => {
  it('round-trips the personalization slice losslessly', () => {
    const row = toPersonalizationRow(original);
    const back = fromPersonalizationRow(row);
    expect(back).toEqual(slice);
  });

  it('maps to the exact column shape Karthik expects', () => {
    const row = toPersonalizationRow(original);
    expect(row.user_id).toBe('u1'); // userId → user_id
    expect(row.font_family).toBe('Georgia'); // nested font.family → flat
    expect(row.zoom).toBe(1.25); // zoom.level → flat zoom
    expect(row.is_deleted).toBe(0); // boolean false → 0
    expect(row.synced).toBe(0);
    expect(row.updated_at).toBe('2026-08-11T12:00:00.000Z'); // ms → ISO-8601 UTC string
  });

  it('handles an absent custom font as NULL, not undefined', () => {
    const noFont: SharedPrefs = { ...original, font: { family: 'system' } };
    const row = toPersonalizationRow(noFont);
    expect(row.custom_font_uri).toBeNull();
    // and it should not reappear as a key on the way back
    const back = fromPersonalizationRow(row);
    expect('customFontUri' in back.font).toBe(false);
  });
});
