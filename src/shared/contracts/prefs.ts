// src/shared/contracts/prefs.ts
// ============================================================================
// Shared Preferences object — CAP-7 Reader & Offline (Team t4targaryen)
// Owner: Personalization (Vaishnavi).
// Co-owned freeze with Reader (Ahana) — Reader APPLIES this object to the
// epub.js rendition API / pdf.js. Personalization only WRITEs it.
// Accessibility block co-owned by Accessibility (Hruthik).
//
// WHAT THIS FILE IS
// -----------------
// A reconciliation of two contracts that were written independently:
//
//   (a) dev_T4 `src/shared/contracts/prefs.ts`  — 4 accessibility booleans,
//       folded into prefs, marked "PROVISIONAL — NEEDS HRUTHIK'S SIGN-OFF"
//   (b) the Day-1 Accessibility freeze           — 18 accessibility fields,
//       7 of them frozen as the shared-preferences contribution
//
// Everything outside `accessibility` is carried over from dev_T4 UNCHANGED,
// including its comments. All edits are inside the accessibility block, plus
// one deprecation on `Theme`.
//
// SIGN-OFF STATUS: the dev_T4 file asked Accessibility to confirm the shape and
// the ownership before treating the fold-in as frozen. This file is that
// response.
//
//   SETTLED by Accessibility (Hruthik):
//     * reduceMotion is a TRI-STATE, not a boolean.
//     * All 18 Day-1 accessibility fields fold into this record (+ dev_T4's
//       screenReaderHints = 19). No second a11y store.
//
//   STILL OPEN — these need other owners, not Accessibility. See the list at
//   the bottom of this file.
//
// CFI (Canonical Fragment Identifier)
//
// Annotations (bookmarks/highlights) are NOT here — see annotations.ts.
//
// Carries id + userId like every other synced record. Prefs are a per-user
// SINGLETON — one record per user, applied across ALL books (NOT scoped per
// book). Conflict resolution = LWW on `updatedAt`, client-edit-time: the client
// stamps updatedAt when the user changes a setting (offline-capable), and that
// timestamp settles two devices editing the same user's prefs.
//
// RECONCILED (sync-base freeze): id / userId / updatedAt / isDeleted / synced
// come from SyncRecordBase — they are NOT redeclared here. updatedAt / synced
// stay non-null. The only genuinely new field is `isDeleted`; prefs is a
// per-user singleton with no real delete op, so it stays false except on
// optional account-cleanup ("reset to defaults" is a rewrite + updatedAt bump,
// NOT a tombstone).
//
// MERGE NOTE (T4_Ahana -> dev_T4): `bookId` was REMOVED here, keeping the
// dev_T4 decision that prefs apply universally per user. The SyncRecordBase
// extraction from T4_Ahana is kept, so the two changes are combined rather than
// one overwriting the other.

import type { SyncRecordBase } from './sync-record';

export type Theme =
  | 'light'
  | 'dark'
  | 'sepia'
  | 'system'
  /**
   * @deprecated Use `accessibility.display.highContrast` instead.
   * High contrast remains in the union so existing persisted records still parse.
   * Migrate on read.
   */
  | 'highContrast';

export interface FontPrefs {
  family: string; // e.g. 'Georgia', 'system'
  customFontUri?: string; // user-supplied font file
}

export interface TypographyPrefs {
  size: number; // agree units with Ahana (pt vs scale factor)
  lineHeight: number; // multiplier, e.g. 1.5
  spacing: number; // letter/word spacing → themes.override
  margins: number; // page margin
}

export interface LayoutPrefs {
  flow: 'paginated' | 'scrolled-doc'; // rendition.flow(...)
  spread: 'single' | 'double'; // rendition.spread()
}

export interface ZoomPrefs {
  level: number; // 1.0 = 100%; PDF/image zoom
}

// ============================================================================
// ACCESSIBILITY
// ============================================================================

// Applied universally per user, like the rest of this record.

// [SETTLED — Accessibility] All 18 Day-1 fields live here, plus dev_T4's
// `screenReaderHints` (19 total).

// The dev_T4 version held 4 booleans. The Day-1 freeze identified 18 fields —
// all of them user preferences, none of them runtime state. Keeping only 4 here
// would have left the other 14 on a second store, which is exactly what folding
// a11y into prefs was meant to eliminate.

// Grouped into tts / text / display / announce rather than left flat. Two
// reasons: it matches this file's existing nesting (font, typography, layout,
// zoom), and it maps 1:1 onto the persisted `a11y.*` namespace agreed on Day 1 —
// `accessibility.tts.rate` ⇄ `a11y.tts.rate`. Flat would have meant 19 sibling
// keys and a hand-maintained name mapping. The nesting is presentation only; it
// can be flattened without touching the field set if anyone objects.

/**
 * reduceMotion is a TRI-STATE, not a boolean. [SETTLED — Accessibility]
 *
 * dev_T4 had `reduceMotion: boolean` defaulting to false. A boolean cannot
 * express "follow the OS": once written, `false` is ambiguous between "the user
 * turned it off" and "the user never chose, and the OS says off". The
 * distinction is not recoverable later, so the lossy shape cannot be fixed
 * after it ships.
 *
 * The SHAPE is settled. The knock-on is not: the default moves from `false` to
 * `'system'`, so out of the box we now honour the OS reduced-motion setting
 * instead of ignoring it. That still needs Ahana, since Reader is what
 * suppresses the page-turn animation.
 *
 * Reader must resolve this against live OS state (see `resolveReduceMotion`)
 * rather than reading the stored value directly.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

/**
 * TTS highlight granularity.
 * UNCONFIRMED union — the Day-1 schema states only the `sentence` default, not
 * the domain. Word- and sentence-level sync are deferred past Week 1, so
 * nothing reads this yet; confirm before it is wired up.
 */
export type TtsHighlightMode = 'none' | 'word' | 'sentence';

/** Text rendering and scaling. */
export interface A11yTextPrefs {
  /** OpenDyslexic. Was `AccessibilityPrefs.dyslexiaFont` in dev_T4. */
  dyslexiaFont: boolean;

  /**
   * Honour the OS font-scale setting.
   * [OVERLAP] Interacts with `typography.size`, which Ahana flagged as
   * "agree units (pt vs scale factor)". Three knobs now scale text:
   * typography.size, this, and fontScaleMultiplier. Settle the composition
   * order with Ahana — see OPEN DECISIONS.
   */
  respectOsFontScale: boolean;

  /** Additional user multiplier applied on top of OS scaling. */
  fontScaleMultiplier: number;

  /** Looser line/word spacing preset for readability. */
  readableSpacing: boolean;
}

/** Visual presentation. */
export interface A11yDisplayPrefs {
  /** Heavier font weight throughout. */
  boldText: boolean;

  /** Single source of truth for contrast — see the `Theme` deprecation. */
  highContrast: boolean;

  /** Tri-state; resolve against OS before applying. */
  reduceMotion: ReduceMotion;

  /** Enlarged hit targets for reader controls. */
  largeTouchTargets: boolean;

  /** Enlarged TTS / audio transport controls. */
  largeAudioControls: boolean;
}

/**
 * Text-to-speech. Library: react-native-tts (Day-1 selection; requires an Expo
 * Development Build, not standard Expo Go).
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

  /** Deferred past Week 1 — persisted now so the shape does not move later. */
  highlightMode: TtsHighlightMode;

  /** Continue reading into the next chapter without user input. */
  autoContinueChapter: boolean;

  /** Keep speaking when the app backgrounds. Unverified on both platforms. */
  backgroundPlayback: boolean;
}

/**
 * Screen-reader announcements on navigation.
 * Announcements must be deliberate — a page turn should not re-announce the
 * whole page, every control, or unrelated content.
 */
export interface A11yAnnouncePrefs {
  pageChanges: boolean;
  chapterChanges: boolean;
}

export interface AccessibilityPrefs {
  text: A11yTextPrefs;
  display: A11yDisplayPrefs;
  tts: A11yTtsPrefs;
  announce: A11yAnnouncePrefs;

  /**
   * Extra a11y labels for TalkBack / VoiceOver.
   * From dev_T4; not in the Day-1 model, kept as-is.
   *
   * NOTE: this only reaches native React Native controls. It does NOT affect
   * EPUB content inside the WebView — that accessibility tree is produced by
   * the DOM and is unreachable from React Native props. Day-1 finding; do not
   * let the flag name imply otherwise.
   */
  screenReaderHints: boolean;
}

export interface SharedPrefs extends SyncRecordBase {
  // Identity/sync fields (id, userId, updatedAt, isDeleted, synced) come from
  // SyncRecordBase. No bookId — prefs are a per-user singleton.
  theme: Theme;
  font: FontPrefs;
  typography: TypographyPrefs;
  layout: LayoutPrefs;
  zoom: ZoomPrefs;
  accessibility: AccessibilityPrefs;
}

// Defaults + reset (Feature Breakdown §5: "defaults + reset; live preview").
// Omits every identity/sync field from the base — just the values.
// `isDeleted` MUST be in this list: it comes from SyncRecordBase, so leaving it
// out makes DEFAULT_PREFS fail to satisfy the Omit.
//
// Accessibility defaults are the Day-1 schema defaults. Two are not `false`:
// `respectOsFontScale` is true (we follow the OS unless told otherwise) and the
// two `announce` flags are true.
export const DEFAULT_PREFS: Omit<
  SharedPrefs,
  'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'
> = {
  theme: 'system',
  font: { family: 'system' },
  typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 },
  layout: { flow: 'paginated', spread: 'single' },
  zoom: { level: 1.0 },
  accessibility: {
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
  },
};

// ============================================================================
// CONSTRAINTS
// ============================================================================

/** Inclusive bounds for `accessibility.tts.rate`. Day-1 freeze. */
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 3.0;

export const REDUCE_MOTION_VALUES = ['system', 'on', 'off'] as const;

// ============================================================================
// RESOLVERS
// ============================================================================

// Two functions in an otherwise type-only contract file. They are
// here because both encode a rule that is part of the contract itself — how a
// stored value becomes an applied value. Move them to a sibling module if the
// team would rather keep contracts declaration-only.

/**
 * Collapses the tri-state against live OS state. Reader should call this rather
 * than reading `accessibility.display.reduceMotion` directly.
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
 * disabled". This does silently upgrade the rare user who really did turn it
 * off to following the OS — acceptable, since the alternative pins every
 * untouched user to "ignore the OS", which is the worse failure for an
 * accessibility setting.
 */
export function migrateReduceMotion(
  stored: boolean | ReduceMotion,
): ReduceMotion {
  if (typeof stored === 'boolean') return stored ? 'on' : 'system';
  return stored;
}

// ============================================================================
// DECISION LOG — status before this replaces prefs.ts
// ============================================================================

// SETTLED — Accessibility (Hruthik):
//   * reduceMotion is a tri-state ('system' | 'on' | 'off'), not a boolean.
//   * All 18 Day-1 accessibility fields fold into this record (+ dev_T4's
//     screenReaderHints). No second accessibility store, no second endpoint.
//   Both are implemented above. The knock-on effects below are NOT settled.

// STILL OPEN:
//
// 1. [Sync owner] Folding a11y onto the prefs singleton means a11y
//    edits and reader-pref edits share ONE `updatedAt`. Two devices — one
//    changing ttsRate, the other changing theme — resolve by whole-record LWW,
//    so one edit is silently discarded. Per-field LWW, or a separate a11y
//    record, or accept the loss. This is the cost of the fold-in and it should
//    be an explicit choice, not a side effect. (Day-1 sync questions Q1/Q4).
//
// 2. [Ahana] reduceMotion default moves false -> 'system', so reduced motion is
//    now honoured out of the box and Reader must suppress the page-turn
//    animation for users whose OS setting is on. Confirm.
//
// 3. [Vaishnavi] Theme 'highContrast' is deprecated in favour of
//    accessibility.display.highContrast. Needs a read-time migration
//    (theme === 'highContrast' -> theme: 'dark' | 'light' + highContrast: true)
//    and removal from the theme picker.
//
// 4. [Ahana + Vaishnavi] Three knobs now scale text: typography.size,
//    text.respectOsFontScale, text.fontScaleMultiplier. Agree the composition
//    order and the units question already flagged on typography.size.
//
// 5. [Accessibility] TtsHighlightMode's union beyond 'sentence' is inferred,
//    not specified. Nothing reads it until word/sentence sync leaves the
//    deferred list, but confirm before it does.