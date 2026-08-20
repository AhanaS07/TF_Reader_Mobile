// Tests for readerAppearance.ts — the SharedPrefs -> ReaderAppearance resolver.
//
// This is the "writes" half of the prefs-application stage, and the only executable
// coverage it gets before the bridge exists to carry its output. Every case here pins a
// resolution DECISION (system-theme resolution host-side, font override semantics, the §6
// composition), not an implementation detail, so it doubles as the checklist the Reader's
// apply half must satisfy once wired.

import { DEFAULT_PREFS } from '@/shared/contracts';
import type { SharedPrefs } from '@/shared/contracts';

import {
  composeFontSizePt,
  resolveColorScheme,
  resolveFont,
  resolveTheme,
  THEME_PALETTES,
  toReaderAppearance,
  type AppearanceEnv,
} from './readerAppearance';

// A complete SharedPrefs from DEFAULT_PREFS plus the SyncRecordBase identity fields the
// defaults omit. Deep-cloned so a test mutating a nested group cannot bleed into another.
function makePrefs(overrides: Partial<SharedPrefs> = {}): SharedPrefs {
  return {
    ...structuredClone(DEFAULT_PREFS),
    id: 'prefs-001',
    userId: 'user-001',
    updatedAt: 1_755_432_000_000,
    isDeleted: false,
    synced: false,
    ...overrides,
  };
}

const ENV: AppearanceEnv = { osColorScheme: 'light', osFontScale: 1.0, osReduceMotionEnabled: false };

describe('resolveColorScheme', () => {
  it('passes concrete schemes through unchanged', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveColorScheme('sepia', 'dark')).toBe('sepia');
  });

  it("resolves 'system' from the OS scheme — host-side, so the WebView never sees 'system'", () => {
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
  });

  it("falls back to the OS scheme for the deprecated 'highContrast' rather than throwing", () => {
    // Should be migrated away on read; handled defensively so a legacy record cannot crash
    // the resolver. Contrast itself is the highContrast FLAG's job, not this scheme's.
    expect(resolveColorScheme('highContrast', 'dark')).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('pairs the resolved scheme with its palette', () => {
    expect(resolveTheme('dark', 'light')).toEqual({
      colorScheme: 'dark',
      ...THEME_PALETTES.dark,
    });
  });

  it("light matches the reader's existing hard-coded look (no-op against today)", () => {
    expect(resolveTheme('light', 'dark')).toMatchObject({ fg: '#111111', bg: '#ffffff' });
  });
});

describe('resolveFont', () => {
  it("treats 'system' as 'do not override', not as a system stack", () => {
    expect(resolveFont({ family: 'system' })).toEqual({ fontFamily: '', customFontUri: null });
  });

  it('treats blank/whitespace family as system (no unnamed family forced)', () => {
    expect(resolveFont({ family: '   ' })).toEqual({ fontFamily: '', customFontUri: null });
  });

  it('passes a named family through verbatim', () => {
    expect(resolveFont({ family: 'Georgia' })).toEqual({ fontFamily: 'Georgia', customFontUri: null });
  });

  it('carries customFontUri through unresolved', () => {
    expect(resolveFont({ family: 'Georgia', customFontUri: 'file:///fonts/x.otf' })).toEqual({
      fontFamily: 'Georgia',
      customFontUri: 'file:///fonts/x.otf',
    });
  });
});

describe('composeFontSizePt (§6, proposed)', () => {
  const a11y = DEFAULT_PREFS.accessibility.text;

  it('returns the base size when nothing scales it', () => {
    // DEFAULT a11y.text: respectOsFontScale true, fontScaleMultiplier 1.0 -> scale 1.0 at osFontScale 1.
    expect(composeFontSizePt(16, a11y, 1.0)).toBe(16);
  });

  it('applies OS scale only when opted in', () => {
    expect(composeFontSizePt(16, { ...a11y, respectOsFontScale: true }, 1.5)).toBe(24);
    expect(composeFontSizePt(16, { ...a11y, respectOsFontScale: false }, 1.5)).toBe(16);
  });

  it('applies the a11y multiplier on top of OS scale', () => {
    expect(composeFontSizePt(16, { ...a11y, respectOsFontScale: true, fontScaleMultiplier: 1.25 }, 2.0)).toBe(40);
  });

  it('does not clamp — the Reader owns the final min/max', () => {
    expect(composeFontSizePt(16, { ...a11y, fontScaleMultiplier: 100 }, 1.0)).toBe(1600);
  });
});

describe('toReaderAppearance', () => {
  it('produces a flat, primitive-only payload from DEFAULT_PREFS', () => {
    expect(toReaderAppearance(makePrefs(), ENV)).toEqual({
      colorScheme: 'light',
      fg: '#111111',
      bg: '#ffffff',
      link: THEME_PALETTES.light.link,
      fontFamily: '',
      customFontUri: null,
      fontSizePt: 16,
      lineHeight: 1.5,
      letterSpacingPx: 0,
      marginPx: 16,
      flow: 'paginated',
      spread: 'single',
      zoom: 1.0,
      // a11y: DEFAULT display/text flags are false; reduceMotion 'system' + OS off -> false;
      // announce.pageChanges defaults true.
      reduceMotion: false,
      highContrast: false,
      boldText: false,
      dyslexiaFont: false,
      readableSpacing: false,
      announcePageChanges: true,
    });
  });

  it('resolves reduceMotion host-side (tri-state -> boolean), like system theme', () => {
    const withMotion = (pref: 'system' | 'on' | 'off', osOn: boolean): boolean => {
      const prefs = makePrefs();
      prefs.accessibility.display.reduceMotion = pref;
      return toReaderAppearance(prefs, { ...ENV, osReduceMotionEnabled: osOn }).reduceMotion;
    };
    expect(withMotion('system', true)).toBe(true);
    expect(withMotion('system', false)).toBe(false);
    expect(withMotion('on', false)).toBe(true); // explicit wins over OS
    expect(withMotion('off', true)).toBe(false);
  });

  it('carries the a11y content flags through from accessibility prefs', () => {
    const prefs = makePrefs();
    prefs.accessibility.display.highContrast = true;
    prefs.accessibility.display.boldText = true;
    prefs.accessibility.text.dyslexiaFont = true;
    prefs.accessibility.text.readableSpacing = true;
    prefs.accessibility.announce.pageChanges = false;
    expect(toReaderAppearance(prefs, ENV)).toMatchObject({
      highContrast: true,
      boldText: true,
      dyslexiaFont: true,
      readableSpacing: true,
      announcePageChanges: false,
    });
  });

  it("resolves theme 'system' against the env, not the stored value", () => {
    const prefs = makePrefs({ theme: 'system' });
    expect(toReaderAppearance(prefs, { ...ENV, osColorScheme: 'dark' }).colorScheme).toBe('dark');
    expect(toReaderAppearance(prefs, { ...ENV, osColorScheme: 'light' }).colorScheme).toBe('light');
  });

  it('carries typography, layout and zoom straight through', () => {
    const prefs = makePrefs({
      typography: { size: 20, lineHeight: 1.8, spacing: 2, margins: 24 },
      layout: { flow: 'scrolled-doc', spread: 'double' },
      zoom: { level: 1.5 },
    });
    const appearance = toReaderAppearance(prefs, ENV);
    expect(appearance).toMatchObject({
      fontSizePt: 20,
      lineHeight: 1.8,
      letterSpacingPx: 2,
      marginPx: 24,
      flow: 'scrolled-doc',
      spread: 'double',
      zoom: 1.5,
    });
  });

  it('does not leak any nested contract object — every value is a primitive (or null)', () => {
    // null is allowed for customFontUri; what must never appear is a nested object, which
    // would mean a frozen contract shape survived into the bridge payload.
    const appearance = toReaderAppearance(makePrefs(), ENV);
    for (const value of Object.values(appearance)) {
      const t = typeof value;
      expect(value === null || t === 'string' || t === 'number' || t === 'boolean').toBe(true);
    }
  });
});
