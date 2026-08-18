// src/features/personalization/readerAppearance.ts
// Owner: Personalization (Vaishnavi).
//
// The "writes" half of the prefs-application stage (WEBVIEW_BRIDGE.md's forecast:
// "Prefs applied to the rendition — Vaishnavi writes, Ahana applies"). It resolves a
// SharedPrefs — a frozen src/shared/contracts/ type — into ReaderAppearance, a FLAT,
// primitive-only value the Reader applies to the epub.js rendition. It does NOT touch
// the bridge or src/features/reader/; it produces the payload the bridge will carry.
//
// WHY THIS SHAPE EXISTS — it keeps a frozen contract OFF the WebView bridge.
// WEBVIEW_BRIDGE.md's trigger 3 (the sharp one) fires when a type owned by
// src/shared/contracts/ crosses into the untypechecked WebView JS: `tsc` walks every TS
// consumer of a frozen contract and walks straight past the .html, so hand-copying a
// frozen shape silently removes the WebView from that freeze's blast radius. The
// established way past it — `goTo` unwrapping Locator -> `.cfi`, and openEpub/openPdf
// routing ContentFormat by command NAME rather than value — is "resolve host-side, send
// a primitive". ReaderAppearance is exactly that: a bridge-local shape, not a frozen
// one, so applying prefs no longer forces SharedPrefs across the boundary.
//
// This does NOT remove the need to convert the WebView to a typechecked build first.
// ReaderAppearance is multi-field, so trigger 1 (a case past ~3 fields) still fires and
// the conversion is still the first task of this stage. What it removes is the SHARPER
// trigger, and it shrinks the blast radius: only primitives cross, all owned by this
// file and readerBridge.ts. See READER_PREFS_APPLICATION.md.

import type { FontPrefs, SharedPrefs, Theme } from '@/shared/contracts';
import { resolveFontScale } from '@/shared/contracts';

/**
 * The three OS-level inputs prefs resolution needs but SharedPrefs cannot carry, because
 * they are device state, not stored preferences.
 *
 * `osColorScheme` resolves `theme: 'system'` HOST-SIDE, so the WebView is handed a
 * concrete 'light'/'dark' and never has to know what "system" means. That is deliberate:
 * the WebView holding "system" would mean it also has to observe OS appearance changes,
 * which is state RN already models (trigger 5). Resolving here keeps the WebView stateless
 * about appearance — it just renders the colours it is given.
 *
 * `osFontScale` is the OS Dynamic Type scale (1.0 = no scaling), fed into the §6 text-
 * scale composition below.
 */
export interface AppearanceEnv {
  /** RN `Appearance.getColorScheme()`, coalesced to 'light' when the OS reports null. */
  osColorScheme: 'light' | 'dark';
  /** OS font-scale setting. 1.0 = none. */
  osFontScale: number;
}

/** The concrete colour scheme a theme resolves to — 'system' is already gone by here. */
export type ResolvedColorScheme = 'light' | 'dark' | 'sepia';

/**
 * A flat, primitive-only description of how the Reader should render, resolved from a
 * SharedPrefs. This is the payload the bridge will carry once the WebView is a
 * typechecked build; keep it flat and free of any src/shared/contracts/ type (see the
 * header for why).
 */
export interface ReaderAppearance {
  // ---- theme (resolved: 'system' is already mapped to a concrete scheme) ----
  colorScheme: ResolvedColorScheme;
  /** Body text colour. */
  fg: string;
  /** Page background colour — set on the host #viewer AND inside each chapter. */
  bg: string;
  /** Hyperlink colour. */
  link: string;

  // ---- font ----
  /**
   * CSS font-family to FORCE on body, or '' to leave the book's own font untouched.
   * `family: 'system'` resolves to '' — the baseline deliberately does not set
   * font-family (see the template's baselineCss note), so "system" means "don't
   * override", not "impose a system stack". The Reader appends its own fallback.
   */
  fontFamily: string;
  /**
   * A user-supplied font file, or null. NOTE the transport caveat in
   * READER_PREFS_APPLICATION.md: the WebView cannot fetch a file:// URI, so a real custom
   * font has to arrive as bytes (a data: URI / base64), not this path. Carried through
   * unresolved so the resolution decision stays in one place once it is made.
   */
  customFontUri: string | null;

  // ---- typography ----
  /**
   * The user's chosen base size in POINTS, after the §6 text-scale composition
   * (base × OS scale × a11y multiplier). The Reader still owns viewport scaling and the
   * final min/max clamp — `readerMetrics()` already scales its input by viewport width,
   * so this is the value that REPLACES the template's hand-copied BASELINE_FONT_SIZE_PX,
   * not the final rendered px. See composeFontSizePt() for the ratification caveat.
   */
  fontSizePt: number;
  /** Line-height multiplier (e.g. 1.5). Replaces BASELINE_LINE_HEIGHT. */
  lineHeight: number;
  /** Letter/word spacing in px. 0 = none (the template omits the rule entirely at 0). */
  letterSpacingPx: number;
  /** Page margin in px. Replaces BASELINE_MARGIN_PX. */
  marginPx: number;

  // ---- layout ----
  /** rendition.flow(...) — the value the template's READER_FLOW constant becomes. */
  flow: 'paginated' | 'scrolled-doc';
  /** rendition.spread(...). */
  spread: 'single' | 'double';

  // ---- zoom ----
  /**
   * 1.0 = 100%. Meaningful for the PDF renderer (pdf.js scale) and images; a reflowable
   * EPUB scales through fontSizePt instead, so the EPUB renderer may ignore this. Carried
   * through rather than dropped so the one payload serves both renderers.
   */
  zoom: number;
}

/**
 * Palettes per resolved scheme. Values chosen to match the reader's existing inline
 * colours (#111111 on #ffffff) so 'light' is a no-op against today's hard-coded look.
 *
 * Contrast is NOT expressed here: `accessibility.display.highContrast` is the single
 * source of truth for contrast (see accessibility.ts), and it is Hruthik's to apply on
 * top of whichever scheme this picks — deliberately independent of colour scheme so a
 * user can run dark + high contrast, which the deprecated `theme: 'highContrast'` could
 * not express.
 */
export const THEME_PALETTES: Record<ResolvedColorScheme, { fg: string; bg: string; link: string }> = {
  light: { fg: '#111111', bg: '#ffffff', link: '#1a4f8b' },
  dark: { fg: '#e6e6e6', bg: '#121212', link: '#6ea8fe' },
  sepia: { fg: '#5b4636', bg: '#f4ecd8', link: '#8a5a2b' },
};

/**
 * Map a Theme to a concrete scheme, resolving 'system' from the OS.
 *
 * `'highContrast'` is deprecated and migrated away on READ (migratePrefs / prefs-row.ts),
 * so it should never reach here from a stored record. Handled defensively anyway — it
 * falls back to the OS scheme rather than throwing, because a resolver that crashes on a
 * legacy value is worse than one that picks a sane colour and lets highContrast (the flag)
 * do the contrast work. `default` keeps this total if the Theme union ever grows.
 */
export function resolveColorScheme(theme: Theme, osColorScheme: 'light' | 'dark'): ResolvedColorScheme {
  switch (theme) {
    case 'light':
    case 'dark':
    case 'sepia':
      return theme;
    case 'system':
      return osColorScheme;
    case 'highContrast':
      return osColorScheme;
    default:
      return osColorScheme;
  }
}

/** Resolve theme -> concrete scheme + its palette, in one step. */
export function resolveTheme(
  theme: Theme,
  osColorScheme: 'light' | 'dark',
): { colorScheme: ResolvedColorScheme; fg: string; bg: string; link: string } {
  const colorScheme = resolveColorScheme(theme, osColorScheme);
  return { colorScheme, ...THEME_PALETTES[colorScheme] };
}

/**
 * Resolve FontPrefs to what the reader applies.
 *
 * `family: 'system'` -> '' (don't override). Any other value is passed through verbatim
 * as a CSS font-family value; the Reader wraps it with a fallback. Empty/whitespace is
 * treated as 'system' so a blank setting never forces an unnamed family.
 */
export function resolveFont(font: FontPrefs): { fontFamily: string; customFontUri: string | null } {
  const family = font.family.trim();
  const override = family === '' || family === 'system' ? '' : family;
  return {
    fontFamily: override,
    customFontUri: font.customFontUri ?? null,
  };
}

/**
 * The §6 text-scale composition (API_CONTRACT_NOTES.md §6): base pt, then OS scale (if
 * opted in), then the a11y user multiplier.
 *
 *   effectivePt = typography.size × resolveFontScale(a11y.text, osFontScale)
 *
 * `resolveFontScale` already computes `(respectOsFontScale ? osFontScale : 1) ×
 * fontScaleMultiplier`, so this is that value multiplied by the pt base — additive to
 * today's a11y behaviour, not a reorder.
 *
 * >>> PROPOSED, PENDING RATIFICATION. <<< prefs.ts DECISION LOG #4 leaves typography.size's
 * units (pt vs scale factor) open, and treating `size` as pt is the proposal in §6, not a
 * settled contract. It is a joint Ahana + Vaishnavi call. Until it closes, the number this
 * returns is only correct if `size` is points; if the units land as a scale factor instead,
 * this multiply becomes the wrong operation and must change. No clamp here on purpose —
 * §6 gives the final min/max to the Reader.
 */
export function composeFontSizePt(
  typographySize: number,
  a11yText: SharedPrefs['accessibility']['text'],
  osFontScale: number,
): number {
  return typographySize * resolveFontScale(a11yText, osFontScale);
}

/**
 * Resolve a whole SharedPrefs into the flat ReaderAppearance the bridge will carry.
 *
 * This is the single "resolve host-side, send primitives" seam for prefs. Everything it
 * reads from a frozen contract stops here; nothing downstream of the payload it returns
 * sees a src/shared/contracts/ type.
 */
export function toReaderAppearance(prefs: SharedPrefs, env: AppearanceEnv): ReaderAppearance {
  const theme = resolveTheme(prefs.theme, env.osColorScheme);
  const font = resolveFont(prefs.font);

  return {
    colorScheme: theme.colorScheme,
    fg: theme.fg,
    bg: theme.bg,
    link: theme.link,

    fontFamily: font.fontFamily,
    customFontUri: font.customFontUri,

    fontSizePt: composeFontSizePt(prefs.typography.size, prefs.accessibility.text, env.osFontScale),
    lineHeight: prefs.typography.lineHeight,
    letterSpacingPx: prefs.typography.spacing,
    marginPx: prefs.typography.margins,

    flow: prefs.layout.flow,
    spread: prefs.layout.spread,

    zoom: prefs.zoom.level,
  };
}
