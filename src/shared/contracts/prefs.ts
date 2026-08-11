// src/shared/contracts/prefs.ts
// Shared Preferences object — CAP-7 Reader & Offline (Team t4targaryen)
// CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi).
// Co-owned freeze with Reader (Ahana) — Reader APPLIES this object to the
// epub.js rendition API / pdf.js. Personalization only WRITEs it.
//
// Accessibility is NOT here — Accessibility (Hruthik) owns it and syncs it via a
// SEPARATE endpoint/record. Annotations (bookmarks/highlights) are also NOT here
// — see annotations.ts.
//
// Carries id + userId + bookId like every other synced record. Because it carries
// bookId, prefs are scoped PER (user, book) — one record per book, not a per-user
// singleton. Conflict resolution = LWW on `updatedAt`, client-edit-time: the
// client stamps updatedAt when the user changes a setting (offline-capable), and
// that timestamp settles two devices editing the same book's prefs.
//
// RECONCILED (sync-base freeze): id / userId / updatedAt / isDeleted / synced come
// from SyncRecordBase. Nullability is UNCHANGED from the original prefs.ts —
// updatedAt / synced stay non-null. The only genuinely new field is `isDeleted`;
// prefs is a singleton per (user, book) with no real delete op, so it stays false
// except on optional library-removal cleanup ("reset to defaults" is a rewrite +
// updatedAt bump, NOT a tombstone).
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
  // NOTE: OpenDyslexic lives in Accessibility (Hruthik's endpoint), not here.
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

export interface SharedPrefs extends SyncRecordBase {
  // Identity/sync fields (id, userId, updatedAt, isDeleted, synced) come from
  // SyncRecordBase. bookId is the book scope — this is what makes prefs per-book.
  bookId: string;

  theme: Theme;
  font: FontPrefs;
  typography: TypographyPrefs;
  layout: LayoutPrefs;
  zoom: ZoomPrefs;
}

// Defaults + reset (Feature Breakdown §5: "defaults + reset; live preview").
// Omits every identity/sync field from the base plus bookId — just the values.
export const DEFAULT_PREFS: Omit<
  SharedPrefs,
  'id' | 'userId' | 'bookId' | 'updatedAt' | 'isDeleted' | 'synced'
> = {
  theme: 'system',
  font: { family: 'system' },
  typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 },
  layout: { flow: 'paginated', spread: 'single' },
  zoom: { level: 1.0 },
};