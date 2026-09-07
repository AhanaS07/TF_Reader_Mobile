// src/shared/contracts/accessibility.ts
// Accessibility preferences — CAP-7 Reader & Offline.
//
// This file defines the SHAPE of the accessibility block. `SharedPrefs` in prefs.ts embeds it
// as `accessibility`, the same way it extends `SyncRecordBase` from sync-record.ts, so every
// consumer still reads one merged prefs object and this file still owns every a11y type,
// default, guard and resolver.
//
//     sync-record.ts    ──imported by──>  prefs.ts   (extends SyncRecordBase)
//     accessibility.ts  ──imported by──>  prefs.ts   (accessibility: AccessibilityPrefs)
//
// Applied universally per user, like the rest of the prefs record — NOT scoped
// per book.
//
// AMENDED (a11y persistence, Sync — resolves prefs.ts STILL-OPEN #1):
// This block PERSISTS AND SYNCS AS ITS OWN RECORD, with its own row, its own endpoint and its
// own `updatedAt`. It previously read "NOT a synced record… no accessibility endpoint, no
// accessibility table, no separate updatedAt", which described the composed SHAPE and was then
// read as a storage mandate.
//
// Why the change: folding a11y onto the prefs singleton gave both blocks ONE `updatedAt`, and
// conflict resolution for prefs is whole-record LWW. Two devices — one changing `tts.rate`, the
// other changing `theme` — would resolve by picking one whole record, silently discarding the
// other edit. For a reading preference that is annoying; for an accessibility setting a user
// depends on, it is a correctness failure. Two records resolve independently, so neither edit
// can be lost to the other.
//
// What did NOT change: this is a storage decision, not a shape decision. `AccessibilityPrefs`
// still carries no identity or sync fields of its own — the canary in __typecheck__.ts still
// pins that — and consumers still receive it composed into `SharedPrefs`. Sync joins the two
// rows on read and splits them on write (see features/sync/sharedPrefs.ts); Reader and the
// settings UI never see the seam.
//
// Owner note: the shape here remains Accessibility's (Hruthik). Only the persistence sentence
// moved, and it moved into Sync's area. Flag it if the split causes trouble at the settings-UI
// layer.

/* ────────────────────────────────────────────────────────────────
   VALUE TYPES
   ──────────────────────────────────────────────────────────────── */

/**
 * Reduced motion is a TRI-STATE, not a boolean.
 *
 * A boolean cannot express "follow the OS": once written, `false` is ambiguous
 * between "the user turned it off" and "the user never chose, and the OS says
 * off". That distinction is not recoverable later.
 *
 * Consumers must resolve this against live OS state via `resolveReduceMotion`
 * rather than reading the stored value directly.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

export const REDUCE_MOTION_VALUES = ['system', 'on', 'off'] as const;

/** TTS highlight granularity. */
export type TtsHighlightMode = 'none' | 'word' | 'sentence';

export const TTS_HIGHLIGHT_MODE_VALUES = ['none', 'word', 'sentence'] as const;

/** Inclusive bounds for `tts.rate`. */
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 3.0;

/**
 * Inclusive bounds for `tts.pitch`. The intersection of both native ranges: iOS
 * `AVSpeechUtterance.pitchMultiplier` hard-clamps to 0.5-2.0, and Android's
 * `TextToSpeech.setPitch` accepts the same range without an OEM-unsafe ceiling.
 */
export const TTS_PITCH_MIN = 0.5;
export const TTS_PITCH_MAX = 2.0;

/* ────────────────────────────────────────────────────────────────
   PREFERENCE BLOCKS
   ────────────────────────────────────────────────────────────────
   Grouped text / display / tts / announce so the shape maps 1:1 onto the
   persisted a11y.* namespace — `accessibility.tts.rate` ⇄ `a11y.tts.rate` —
   and matches the nesting prefs.ts already uses for font / typography /
   layout / zoom.
   ──────────────────────────────────────────────────────────────── */

/** Text rendering and scaling. */
export interface A11yTextPrefs {
  /** OpenDyslexic. */
  dyslexiaFont: boolean;
  /**
   * Honour the OS font-scale setting.
   *
   * OVERLAP: interacts with `typography.size` in prefs.ts, whose units are not
   * yet agreed (pt vs scale factor). Three knobs scale text — typography.size,
   * this, and fontScaleMultiplier — and their composition order is undecided.
   */
  respectOsFontScale: boolean;
  /** Additional user multiplier applied on top of OS scaling. 1.0 = none. */
  fontScaleMultiplier: number;
  /** Looser line/word spacing preset for readability. */
  readableSpacing: boolean;
}

/** Visual presentation. */
export interface A11yDisplayPrefs {
  /** Heavier font weight throughout. */
  boldText: boolean;
  /**
   * Single source of truth for contrast.
   *
   * prefs.ts still carries a deprecated `Theme` variant `'highContrast'`. This
   * flag wins; the theme variant exists only so old records parse. Keeping
   * contrast separate from colour scheme lets a user run dark + high contrast,
   * which the theme variant could not express.
   */
  highContrast: boolean;
  /** Tri-state — resolve with `resolveReduceMotion` before applying. */
  reduceMotion: ReduceMotion;
  /** Enlarged hit targets for reader controls. */
  largeTouchTargets: boolean;
  /** Enlarged TTS / audio transport controls. */
  largeAudioControls: boolean;
}

/**
 * Text-to-speech.
 *
 * Library: react-native-tts. Requires an Expo Development Build — it is a
 * native module and is not present in standard Expo Go.
 */
export interface A11yTtsPrefs {
  /** Master switch. */
  enabled: boolean;
  /** Platform voice identifier; null = platform default. */
  voiceId: string | null;
  /** Speech rate. Valid range TTS_RATE_MIN..TTS_RATE_MAX. */
  rate: number;
  /** Speech pitch. */
  pitch: number;
  /** Not read yet — persisted now so the shape does not move later. */
  highlightMode: TtsHighlightMode;
  /** Continue reading into the next chapter without user input. */
  autoContinueChapter: boolean;
  /**
   * Keep speaking when the app backgrounds.
   * Unverified on both platforms — neither TTS library's documented API
   * guarantees it, so this needs a device spike before it is exposed in the UI.
   */
  backgroundPlayback: boolean;
}

/**
 * Screen-reader announcements on navigation.
 *
 * Announcements must be deliberate: a page turn should not re-announce the
 * whole page, every control, or unrelated content. Over-announcing interrupts
 * the book, which is the failure mode that matters most in a reading app.
 */
export interface A11yAnnouncePrefs {
  pageChanges: boolean;
  chapterChanges: boolean;
}

/** The accessibility block of the prefs record. */
export interface AccessibilityPrefs {
  text: A11yTextPrefs;
  display: A11yDisplayPrefs;
  tts: A11yTtsPrefs;
  announce: A11yAnnouncePrefs;
  /**
   * Extra a11y labels for TalkBack / VoiceOver.
   *
   * SCOPE WARNING: this reaches native React Native controls only. It does NOT
   * affect EPUB content inside the WebView — that accessibility tree is built
   * from the DOM and is unreachable from React Native props. Do not let the
   * name imply otherwise when wiring the settings UI.
   */
  screenReaderHints: boolean;
}

/* ────────────────────────────────────────────────────────────────
   DEFAULTS
   ────────────────────────────────────────────────────────────────
   Note the four that are not "off": respectOsFontScale,
   tts.autoContinueChapter, announce.pageChanges, announce.chapterChanges.
   ──────────────────────────────────────────────────────────────── */

/**
 * Shared reference — do NOT mutate, and do not rely on a shallow spread to
 * detach it. "Reset to defaults" must deep-copy (e.g. structuredClone) or every
 * reset will hand out the same nested objects.
 */
export const DEFAULT_ACCESSIBILITY_PREFS: AccessibilityPrefs = {
  text: {
    dyslexiaFont: false,
    respectOsFontScale: true,
    fontScaleMultiplier: 1.0,
    readableSpacing: false,
  },
  display: {
    boldText: false,
    highContrast: false,
    reduceMotion: 'system',
    largeTouchTargets: false,
    largeAudioControls: false,
  },
  tts: {
    enabled: false,
    voiceId: null,
    rate: 1.0,
    pitch: 1.0,
    highlightMode: 'sentence',
    autoContinueChapter: true,
    backgroundPlayback: false,
  },
  announce: {
    pageChanges: true,
    chapterChanges: true,
  },
  screenReaderHints: false,
};

/** Fresh, fully detached copy of the defaults. Use this for "reset". */
export function createDefaultAccessibilityPrefs(): AccessibilityPrefs {
  return {
    text: { ...DEFAULT_ACCESSIBILITY_PREFS.text },
    display: { ...DEFAULT_ACCESSIBILITY_PREFS.display },
    tts: { ...DEFAULT_ACCESSIBILITY_PREFS.tts },
    announce: { ...DEFAULT_ACCESSIBILITY_PREFS.announce },
    screenReaderHints: DEFAULT_ACCESSIBILITY_PREFS.screenReaderHints,
  };
}

/* ────────────────────────────────────────────────────────────────
   GUARDS
   ──────────────────────────────────────────────────────────────── */

export function isValidTtsRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TTS_RATE_MIN &&
    value <= TTS_RATE_MAX
  );
}

export function isValidTtsPitch(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TTS_PITCH_MIN &&
    value <= TTS_PITCH_MAX
  );
}

export function isValidReduceMotion(value: unknown): value is ReduceMotion {
  return (REDUCE_MOTION_VALUES as readonly unknown[]).includes(value);
}

export function isValidTtsHighlightMode(value: unknown): value is TtsHighlightMode {
  return (TTS_HIGHLIGHT_MODE_VALUES as readonly unknown[]).includes(value);
}

/* ────────────────────────────────────────────────────────────────
   RESOLVERS & MIGRATION
   ────────────────────────────────────────────────────────────────
   These encode rules that are part of the contract itself — how a stored value
   becomes an applied value.
   ──────────────────────────────────────────────────────────────── */

/**
 * Collapses the tri-state against live OS state.
 *
 * Reader should call this rather than reading `display.reduceMotion` directly —
 * the stored value alone cannot tell it whether to suppress the page-turn
 * animation.
 */
export function resolveReduceMotion(
  preference: ReduceMotion,
  osReduceMotionEnabled: boolean,
): boolean {
  if (preference === 'system') return osReduceMotionEnabled;
  return preference === 'on';
}

/**
 * Read-time migration for records written before the tri-state change.
 *
 * `false` maps to `'system'`, not `'off'`: the old default was false, so a
 * stored false is overwhelmingly "never touched" rather than "explicitly
 * disabled". This does silently upgrade the rare user who genuinely disabled it
 * to following the OS — acceptable, because the alternative pins every
 * untouched user to "ignore the OS", which is the worse failure for an
 * accessibility setting.
 */
export function migrateReduceMotion(stored: boolean | ReduceMotion): ReduceMotion {
  if (typeof stored === 'boolean') return stored ? 'on' : 'system';
  return stored;
}

/**
 * Resolves the effective text scale.
 *
 * PLACEHOLDER ORDER: OS scale applies only when the user opted in, then the
 * user multiplier applies on top. `typography.size` is deliberately not
 * consumed here until its units are agreed.
 */
export function resolveFontScale(
  prefs: A11yTextPrefs,
  osFontScale: number,
): number {
  const base = prefs.respectOsFontScale ? osFontScale : 1.0;
  return base * prefs.fontScaleMultiplier;
}
