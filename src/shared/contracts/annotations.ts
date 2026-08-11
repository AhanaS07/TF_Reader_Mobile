// src/shared/contracts/annotations.ts
// Bookmarks & Highlights — CAP-7 Reader & Offline (Team t4targaryen)
// CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi). Coordinate table shape with Sync (Karthik).
// Each annotation is its OWN synced record in SQLite (a growing collection),
// unlike SharedPrefs which is a singleton — see prefs.ts.
//
// Conflict resolution:
//   Bookmarks  → LWW on updatedAt (client-edit-time).
//   Highlights → MERGE / UNION across devices (NOT LWW).
//
// RECONCILED (sync-base freeze): the inline `SyncBase` that used to live here has
// moved to sync-record.ts as `SyncRecordBase` — now carries userId, and
// updatedAt / synced are NON-null (the client stamps updatedAt at edit time;
// synced defaults false). Bookmark/Highlight extend it. If any teammate code
// still imports `SyncBase` from here, switch it to `SyncRecordBase` from
// './sync-record'.
import type { SyncRecordBase } from './sync-record';

// Position addressing differs by content type (Reader emits this):
//   EPUB → CFI string (epub.js text-selection anchor)
//   PDF  → page number (+ optional offset)
// RECONCILED (format casing): discriminants are UPPERCASE to match ContentFormat
// (PDF | EPUB | AUDIO) in primitives.ts — no more 'epub' / 'EPUB' split.
export type Locator =
  | { type: 'EPUB'; cfi: string }
  | { type: 'PDF'; page: number; offset?: number };

export interface Bookmark extends SyncRecordBase {
  bookId: string;
  chapterId?: string;
  locator: Locator;
  name?: string; // optional user-given name (DB column: `name`)
  createdAt: number; // on create, updatedAt is stamped to the same client ms
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | string;

export interface Highlight extends SyncRecordBase {
  bookId: string;
  // A highlight spans a range. Stored FLAT (two locators) to match the DB
  // freeze — NOT nested under a `range` object:
  //   startLocator -> start_locator (SQLite) / startLocator (Mongo)
  //   endLocator   -> end_locator   (SQLite) / endLocator   (Mongo)
  // Dropped per Day-1 freeze: `offset`, `note`, `selectedText` (no columns).
  startLocator: Locator;
  endLocator: Locator;
  color: HighlightColor;
  createdAt: number;
}