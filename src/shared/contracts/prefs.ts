// src/shared/contracts/prefs.ts
// Shared Preferences object — CAP-7 Reader & Offline.
//
// Prefs are a per-user SINGLETON: one record per user, applied across ALL books
// (not scoped per book). Reader APPLIES this object to the epub.js rendition
// API / pdf.js; Personalization WRITEs it.
//
// Annotations (bookmarks/highlights) are NOT here — see annotations.ts.
// Accessibility field shapes are NOT here — see accessibility.ts. That block is
// composed into this record, the same way SyncRecordBase is; it is NOT a
// separate synced record.
//
// Identity/sync fields (id, userId, updatedAt, isDeleted, synced) come from
// SyncRecordBase and are not redeclared; updatedAt / synced stay non-null.
// There is no `bookId` — prefs apply universally per user.
//
// Conflict resolution is LWW on `updatedAt`, stamped by the client at edit time
// so it works offline. There is no real delete op for a singleton, so
// `isDeleted` stays false except on account cleanup — "reset to defaults" is a
// rewrite plus an updatedAt bump, not a tombstone.
import type { SyncRecordBase } from './sync-record';
import type { AccessibilityPrefs } from './accessibility';
import { DEFAULT_ACCESSIBILITY_PREFS } from './accessibility';

export type Theme =
  | 'light'
  | 'dark'
  | 'sepia'
  | 'system'
  /**
   * @deprecated Use `accessibility.display.highContrast` instead.
   * High contrast was representable twice — as a theme variant and as an
   * accessibility flag — with no defined precedence for
   * `theme: 'dark' + highContrast: true`. The flag is now the single source of
   * truth, so contrast stays independent of colour scheme. Kept in the union
   * only so existing persisted records still parse; migrate on read.
   */
  | 'highContrast';

export interface FontPrefs {
  family: string; // e.g. 'Georgia', 'system'
  customFontUri?: string; // user-supplied font file
}

export interface TypographyPrefs {
  size: number; // units not yet agreed (pt vs scale factor)
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

export interface SharedPrefs extends SyncRecordBase {
  // Identity/sync fields (id, userId, updatedAt, isDeleted, synced) come from
  // SyncRecordBase. No bookId — prefs are a per-user singleton.
  theme: Theme;
  font: FontPrefs;
  typography: TypographyPrefs;
  layout: LayoutPrefs;
  zoom: ZoomPrefs;
  accessibility: AccessibilityPrefs; // shape owned by accessibility.ts
}

// Defaults + reset (Feature Breakdown §5: "defaults + reset; live preview").
// Omits every identity/sync field from the base — just the values.
// `isDeleted` MUST be in this list: it comes from SyncRecordBase, so leaving it
// out makes DEFAULT_PREFS fail to satisfy the Omit.
//
// The accessibility defaults are owned by accessibility.ts and referenced, not
// restated — otherwise the two drift. NOTE: this is a shared reference, so
// "reset to defaults" must deep-copy rather than shallow-spread (see
// createDefaultAccessibilityPrefs()).
export const DEFAULT_PREFS: Omit<
  SharedPrefs,
  'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'
> = {
  theme: 'system',
  font: { family: 'system' },
  typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 },
  layout: { flow: 'paginated', spread: 'single' },
  zoom: { level: 1.0 },
  accessibility: DEFAULT_ACCESSIBILITY_PREFS,
};

// ============================================================================
// DECISION LOG
// ============================================================================

// The a11y types, constants, validators and resolvers (AccessibilityPrefs and
// its A11y* blocks, ReduceMotion, TtsHighlightMode, TTS_RATE_MIN/MAX,
// REDUCE_MOTION_VALUES, resolveReduceMotion, migrateReduceMotion) are NOT
// declared here — accessibility.ts owns them, and contracts/index.ts
// re-exports both files. Re-declaring them here makes the star exports
// ambiguous (TS2308) and collides with the import above (TS2440).

// SETTLED — Accessibility (Hruthik):
//   * reduceMotion is a tri-state ('system' | 'on' | 'off'), not a boolean.
//   * All 18 Day-1 accessibility fields fold into this record (+ dev_T4's
//     screenReaderHints). No second accessibility store, no second endpoint.
//   Both live in accessibility.ts. The knock-on effects below are NOT settled.

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
