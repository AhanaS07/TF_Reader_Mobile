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
import { resolveFontScale, resolveReduceMotion } from '@/shared/contracts';

/**
 * The OS-level inputs prefs resolution needs but SharedPrefs cannot carry, because they
 * are device state, not stored preferences.
 *
 * All three resolve their pref HOST-SIDE, so the WebView is handed concrete values and
 * never has to observe the OS itself — that OS state is something RN already models
 * (trigger 5). `osColorScheme` resolves `theme: 'system'`; `osFontScale` feeds the text-
 * scale composition; `osReduceMotionEnabled` resolves the tri-state `reduceMotion`. The
 * Reader re-resolves and re-sends when any of these change (see READER_PREFS_APPLICATION.md §5).
 */
export interface AppearanceEnv {
  /** RN `Appearance.getColorScheme()`, coalesced to 'light' when the OS reports null. */
  osColorScheme: 'light' | 'dark';
  /** OS font-scale setting. 1.0 = none. */
  osFontScale: number;
  /** OS "reduce motion" accessibility setting (iOS Reduce Motion / Android Remove animations). */
  osReduceMotionEnabled: boolean;
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
   * through rather than dropped so the one payload serves both renderers. Pinch-zoom
   * inside the WebView is ruled out (Ahana) — zoom changes arrive only through prefs.
   */
  zoom: number;

  // ---- accessibility (composed into this ONE payload) ----
  //
  // These are Hruthik's contract (accessibility.ts), carried here rather than sent as a
  // second command: Ahana holds "one command, one resolve seam", and Hruthik's
  // WEBVIEW_A11Y_FINDINGS.md §3.7 requires announce.pageChanges to reach the WebView
  // through this same composed-prefs path — there is no "applied on top" that is not a
  // second command. This file only RESOLVES them to primitives; their apply-time meaning
  // (e.g. dyslexiaFont's precedence over fontFamily, the contrast recipe) is
  // Reader/Hruthik's, at apply time.
  /** display.reduceMotion, RESOLVED against the OS (tri-state -> boolean). Suppress page-turn animation when true. */
  reduceMotion: boolean;
  /** display.highContrast — the single source of truth for contrast, independent of colorScheme. */
  highContrast: boolean;
  /** display.boldText — heavier font weight throughout. */
  boldText: boolean;
  /** text.dyslexiaFont — OpenDyslexic; precedence over fontFamily is decided at apply time. */
  dyslexiaFont: boolean;
  /** text.readableSpacing — looser line/word spacing preset. */
  readableSpacing: boolean;
  /** announce.pageChanges — gate the WebView's polite page-change announcement (§3.7, defaults true). */
  announcePageChanges: boolean;
  /**
   * announce.chapterChanges — the same gate for chapter boundaries (defaults true).
   *
   * ITS OWN FIELD RATHER THAN SHARING `announcePageChanges`, because `AccessibilityPrefs` already
   * separates them and they are genuinely different volumes of speech: a page turn fires constantly,
   * a chapter change a handful of times a book. A reader who turned pages off has not asked to stop
   * being told which chapter they are in.
   */
  announceChapterChanges: boolean;
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
 * RATIFIED (Ahana, 2026-08-18, closing prefs.ts DECISION LOG #4 / API_CONTRACT_NOTES §6):
 * `typography.size` is ABSOLUTE POINTS and the composition is exactly `size ×
 * resolveFontScale(...)`. No clamp here on purpose — the Reader owns the final bound, and
 * it clamps the VIEWPORT factor (0.94–1.375), not the product.
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
  const { display, text, announce } = prefs.accessibility;

  return {
    colorScheme: theme.colorScheme,
    fg: theme.fg,
    bg: theme.bg,
    link: theme.link,

    fontFamily: font.fontFamily,
    customFontUri: font.customFontUri,

    fontSizePt: composeFontSizePt(prefs.typography.size, text, env.osFontScale),
    lineHeight: prefs.typography.lineHeight,
    letterSpacingPx: prefs.typography.spacing,
    marginPx: prefs.typography.margins,

    flow: prefs.layout.flow,
    spread: prefs.layout.spread,

    zoom: prefs.zoom.level,

    // a11y — resolved to primitives here; meaning applied Reader/Hruthik-side.
    reduceMotion: resolveReduceMotion(display.reduceMotion, env.osReduceMotionEnabled),
    highContrast: display.highContrast,
    boldText: display.boldText,
    dyslexiaFont: text.dyslexiaFont,
    readableSpacing: text.readableSpacing,
    announcePageChanges: announce.pageChanges,
    announceChapterChanges: announce.chapterChanges,
  };
}
