// src/shared/contracts/prefs.ts
// Shared Preferences object — CAP-7 Reader & Offline (Team t4targaryen)
// CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi).
// Co-owned freeze with Reader (Ahana) — Reader APPLIES this object to the
// epub.js rendition API / pdf.js. Personalization only WRITEs it.
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
import type { AccessibilityPrefs } from './accessibility';
import type { SyncRecordBase } from './sync-record';

export type Theme = 'light' | 'dark' | 'sepia' | 'system' | 'highContrast'; // high-contrast is a theme variant

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

// Accessibility now lives in its own file — see ./accessibility.ts.
//
// RESOLVED, NO LONGER PROVISIONAL. This file used to declare a flat
// four-boolean `AccessibilityPrefs` under a "PROVISIONAL — NEEDS HRUTHIK'S
// SIGN-OFF" note, because folding his surface in here moved a boundary that was
// his. Hruthik published the real shape (FINAL, 2026-09-02) and it is nested
// four groups deep, so the declaration moved out to the owner's own file and
// this one only composes it.
//
// IMPORTED, NOT RE-EXPORTED. The barrel exports both files, so re-exporting
// `AccessibilityPrefs` from here would give it two export paths and make the
// barrel ambiguous. One declaration, one home.

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
export const DEFAULT_PREFS: Omit<
  SharedPrefs,
  'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'
> = {
  theme: 'system',
  font: { family: 'system' },
  typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 },
  layout: { flow: 'paginated', spread: 'single' },
  zoom: { level: 1.0 },
  // Every value below is the contract's own default (Hruthik, v1.1 §2). Three
  // are deliberately NOT `false`: `respectOsFontScale` starts on because
  // ignoring the OS setting by default is the hostile choice, and both
  // `announce` flags start on for the same reason.
  //
  // `reduceMotion` DEFAULTS TO 'system', NOT 'off' — the whole point of the
  // tri-state is that "follow the OS" is the honest starting position.
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
    // Ahana's group. Empty here because no field in it is ours to default.
    tts: {},
    announce: {
      pageChanges: true,
      chapterChanges: true,
    },
    screenReaderHints: false,
  },
};
