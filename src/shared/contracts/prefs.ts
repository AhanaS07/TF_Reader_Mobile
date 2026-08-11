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
import type { SyncRecordBase } from './sync-record';

export type Theme =
  | 'light'
  | 'dark'
  | 'sepia'
  | 'system'
  | 'highContrast'; // high-contrast is a theme variant

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

// Accessibility flags — booleans only, applied universally per user like the
// rest of this record.
//
// PROVISIONAL — NEEDS HRUTHIK'S SIGN-OFF. Accessibility (Hruthik) previously
// owned these on a SEPARATE endpoint/record, and this file used to say so
// explicitly. Folding them in here makes prefs the single per-user settings
// record, but it moves a boundary that was another owner's, and it means these
// flags now sync on the prefs record (LWW on updatedAt) rather than his own.
// Confirm the shape and the ownership before treating this as frozen.
export interface AccessibilityPrefs {
  dyslexiaFont: boolean; // OpenDyslexic — previously noted as Hruthik's
  highContrast: boolean; // pairs with Theme 'highContrast'
  reduceMotion: boolean; // honour reduced-motion, suppress page-turn animation
  screenReaderHints: boolean; // extra a11y labels for TalkBack / VoiceOver
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
    dyslexiaFont: false,
    highContrast: false,
    reduceMotion: false,
    screenReaderHints: false,
  },
};
