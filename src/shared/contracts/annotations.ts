// src/shared/contracts/annotations.ts
// Bookmarks & Highlights — CAP-7 Reader & Offline (Team t4targaryen)
// CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi). Coordinate table shape with Sync (Karthik).
// Each annotation is its OWN synced record in SQLite (a growing collection),
// unlike SharedPrefs which is a singleton — see prefs.ts.
//
// Conflict resolution:
//   Bookmarks  → MERGE / UNION across devices (NOT LWW).
//   Highlights → MERGE / UNION across devices (NOT LWW).
// Both rely on the same mechanism: each add() mints a fresh client UUID, so
// records from different devices never collide on id and simply accumulate.
// This holds only because neither has an update-in-place path today — there
// is no renameBookmark/editBookmark. If one is ever added, an edit to the
// same id from two devices needs its OWN resolution decision; it does not
// fall out of this union behavior for free.
//
// RECONCILED (sync-base freeze): the inline `SyncBase` that used to live here has
// moved to sync-record.ts as `SyncRecordBase` — now carries userId, and
// updatedAt / synced are NON-null (the client stamps updatedAt at edit time;
// synced defaults false). Bookmark/Highlight extend it. If any teammate code
// still imports `SyncBase` from here, switch it to `SyncRecordBase` from
// './sync-record'.
import type { SyncRecordBase } from './sync-record';

// Position addressing differs by content type (Reader emits this):
//   EPUB  → CFI string (epub.js text-selection anchor)
//   PDF   → page number (+ optional offset)
//   AUDIO → elapsed time within a track (there is no page and no CFI in a waveform)
// RECONCILED (format casing): discriminants are UPPERCASE to match ContentFormat
// (PDF | EPUB | AUDIO) in primitives.ts — no more 'epub' / 'EPUB' split.
export type Locator =
  | { type: 'EPUB'; cfi: string }
  | { type: 'PDF'; page: number; offset?: number }
  // `positionMs`, not seconds and not a float: matches what every audio engine in this stack
  // already reports natively, and an integer survives a JSON round trip and a SQLite INTEGER
  // column without the float-equality ambiguity a fractional second would introduce into LWW
  // comparisons. `trackId` is optional - a single-file audiobook (everything shipped today) has
  // no meaningful track identity; a multi-track book cannot be addressed without one.
  //
  // Progress.offset is NOT NULL and carries no meaning for AUDIO - every AUDIO progress row
  // writes `offset: 0` as a required-but-unused placeholder. `positionMs` here is the only real
  // position; do not mirror it into `offset` (seconds or otherwise) - that recreates exactly the
  // "two addressing schemes behind one integer" ambiguity this variant exists to avoid.
  | { type: 'AUDIO'; positionMs: number; trackId?: string };

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
