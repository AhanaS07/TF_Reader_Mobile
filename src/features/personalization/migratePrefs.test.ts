// migratePrefs.test.ts — read-time migration of the deprecated 'highContrast'
// Theme variant onto accessibility.display.highContrast.

// Migration promoted to @/shared/contracts (prefs-row.ts) so both Personalization and
// Sync consume one implementation. Test moved with it.
import type { SharedPrefs } from '@/shared/contracts';
import {
  migrateSharedPrefs,
  HIGH_CONTRAST_BASE_THEME,
  DEFAULT_ACCESSIBILITY_PREFS,
} from '@/shared/contracts';

const base: SharedPrefs = {
  id: 'p1',
  userId: 'u1',
  theme: 'system',
  font: { family: 'system' },
  typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 },
  layout: { flow: 'paginated', spread: 'single' },
  zoom: { level: 1.0 },
  updatedAt: Date.UTC(2026, 7, 11, 12, 0, 0),
  isDeleted: false,
  synced: true,
  accessibility: DEFAULT_ACCESSIBILITY_PREFS,
};

describe('migrateSharedPrefs — highContrast theme → accessibility flag', () => {
  it("moves theme:'highContrast' to the base theme and sets display.highContrast", () => {
    const legacy: SharedPrefs = { ...base, theme: 'highContrast' };
    const migrated = migrateSharedPrefs(legacy);
    expect(migrated.theme).toBe(HIGH_CONTRAST_BASE_THEME);
    expect(migrated.accessibility.display.highContrast).toBe(true);
  });

  it('leaves a non-highContrast record untouched (same reference)', () => {
    const migrated = migrateSharedPrefs(base);
    expect(migrated).toBe(base);
  });

  it('is idempotent — a second pass is a no-op', () => {
    const once = migrateSharedPrefs({ ...base, theme: 'highContrast' });
    const twice = migrateSharedPrefs(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate its input and preserves the rest of accessibility', () => {
    const legacy: SharedPrefs = { ...base, theme: 'highContrast' };
    const migrated = migrateSharedPrefs(legacy);
    // input untouched
    expect(legacy.theme).toBe('highContrast');
    expect(legacy.accessibility.display.highContrast).toBe(false);
    // only highContrast flipped; siblings intact
    expect(migrated.accessibility.display.reduceMotion).toBe(
      base.accessibility.display.reduceMotion,
    );
    expect(migrated.accessibility.text).toEqual(base.accessibility.text);
  });
});
