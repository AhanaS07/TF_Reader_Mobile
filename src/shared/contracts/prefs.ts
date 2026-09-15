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
  // ABSOLUTE POINTS, not a scale factor — ratified 2026-08-18, DECISION LOG #4. The
  // user's chosen base size; the two accessibility scale knobs multiply it rather
  // than duplicating it.
  size: number;
  lineHeight: number; // multiplier, e.g. 1.5
  // Letter/word spacing, in px. 0 = none, and a consumer should OMIT the rule at 0
  // rather than emit `letter-spacing: 0` for a book's own CSS to lose to.
  //
  // NOT via `themes.override`, which this comment used to say. epub.js's Themes
  // cannot carry the reader's stylesheet at all — Themes.inject() reads `rules` and
  // `url` and never `serialized`, so a CSS-text theme is silently skipped for every
  // chapter loaded after the call. Reader applies typography through
  // Contents.addStylesheetCss + a hooks.content handler instead
  // (reader-epub.template.html, baselineCss). Corrected because the wrong mechanism
  // in a frozen contract's comment is what an applier reads first.
  spacing: number;
  margins: number; // page margin, in px
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
//   Both live in accessibility.ts. Its knock-on effects are the log below; #2 and #4
//   closed on 2026-08-18, #3 and #5 are still open.

// RESOLVED:
//
// 1. [Sync owner] SETTLED — a SEPARATE a11y record. Folding a11y onto the prefs
//    singleton meant a11y edits and reader-pref edits shared ONE `updatedAt`, so two
//    devices — one changing ttsRate, the other changing theme — resolved by whole-record
//    LWW and one edit was silently discarded. Of the three options offered (per-field LWW,
//    a separate a11y record, accept the loss), the separate record is taken: per-field LWW
//    needs per-field timestamps the wire format does not carry, and accepting the loss is
//    not acceptable for a setting a user depends on to read at all.
//
//    Accessibility now persists and syncs as its own record, with its own row, endpoint and
//    `updatedAt`. accessibility.ts is amended to match. The COMPOSED SHAPE is unchanged:
//    `SharedPrefs.accessibility` is still an `AccessibilityPrefs`, still carries no identity
//    or sync fields, and consumers still read one merged object — Sync joins the two rows on
//    read and splits them on write (features/sync/sharedPrefs.ts).
//
//    Recorded as the explicit choice this item asked for rather than a side effect.
//    (Day-1 sync questions Q1/Q4.)
//
// 2. [Ahana] SETTLED 2026-08-18 — CONFIRMED. reduceMotion's default moves false ->
//    'system', reduced motion is honoured out of the box, and Reader owns suppressing
//    the page-turn animation when it resolves true. Resolved HOST-SIDE via
//    resolveReduceMotion(pref, osReduceMotionEnabled) and delivered to the WebView as a
//    plain boolean on the prefs payload — same reason 'system' themes resolve host-side:
//    OS state is RN's to observe, and a WebView observing it would be state RN also
//    models (WEBVIEW_BRIDGE.md trigger 5).
//
//    Worth recording what confirming it actually costs today: NOTHING, because the
//    reader has no animation to suppress. There is no `transition`, `animation`,
//    `@keyframes` or `prefers-reduced-motion` in either WebView template or
//    ReaderScreen.tsx, and epub.js page turns are instant display() calls. So this is
//    not a feature to build but a constraint on whoever adds the first page-turn
//    animation, which is exactly the kind of obligation that evaporates when the person
//    who agreed to it moves on. readerTemplate.test.ts pins it: an unguarded transition
//    or animation in a template fails a build. Confirmed rather than deferred BECAUSE
//    it is free — deferring a free 'yes' is how a default ships unhonoured.
//
// 4. [Ahana + Vaishnavi] SETTLED 2026-08-18 — typography.size is ABSOLUTE POINTS, and
//    the three knobs compose base-then-OS-then-user:
//
//      effectivePt = typography.size                          // chosen base, in pt
//                  × (respectOsFontScale ? osFontScale : 1.0) // OS Dynamic Type
//                  × fontScaleMultiplier                      // extra a11y multiplier
//
//    i.e. exactly resolveFontScale() (accessibility.ts) multiplied by the pt base —
//    additive to today's behaviour, not a reorder — implemented in
//    features/personalization/readerAppearance.ts (composeFontSizePt). Points because
//    DEFAULT_PREFS already commits size: 16, which is only sensible as 16pt, and because
//    a `size` that was a multiplier would duplicate fontScaleMultiplier and leave the
//    user's base size unrepresentable. resolveFontScale continues to EXCLUDE size on
//    purpose: composition belongs to the consumer, not to this freeze.
//
//    Reader owns the final device fit, and the shape of it is the non-obvious half:
//    it clamps the VIEWPORT FACTOR, not the product. Clamping the product (what
//    readerMetrics did while the base was a hand-copied constant) silently caps a large
//    accessibility multiplier at the fixed maximum, which is precisely the user who
//    cannot work around it. See WEBVIEW_BRIDGE.md, "The font-size clamp".
//
//    Proposal + rationale: features/personalization/API_CONTRACT_NOTES.md §6.
//    (Sync's note that the local `personalization` table once defaulted these to scale
//    factors is moot — its schema and mappers already moved onto DEFAULT_PREFS.)
//
// STILL OPEN:
//
// 3. [Vaishnavi] Theme 'highContrast' is deprecated in favour of
//    accessibility.display.highContrast. Needs a read-time migration
//    (theme === 'highContrast' -> theme: 'dark' | 'light' + highContrast: true)
//    and removal from the theme picker.
//
// 5. [Accessibility] TtsHighlightMode's union beyond 'sentence' is inferred,
//    not specified. Nothing reads it until word/sentence sync leaves the
//    deferred list, but confirm before it does.
