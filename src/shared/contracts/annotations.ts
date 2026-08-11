// /shared/annotations.ts
// Bookmarks & Highlights — CAP-7 Reader & Offline (Team t4targaryen)
//CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi). Coordinate table shape with Sync (Karthik).
// Each annotation is its OWN synced record in SQLite (a growing collection),
// unlike SharedPrefs which is a singleton — see prefs.ts.
//
// Conflict resolution:
//   Bookmarks  → LWW on updatedAt.
//   Highlights → MERGE / UNION across devices (NOT LWW).

// Shared sync base — matches Karthik's { id, updatedAt, isDeleted, synced },
// plus userId. Sent with every change: delete → isDeleted=true; update → whole record.
export interface SyncBase {
  id: string; // client-generated UUID — unique id per record / change
  userId: string; // owner; sent with every change
  updatedAt: number | null; // null on create; sync layer (Karthik) sets it
  isDeleted: boolean; // true = tombstoned (soft delete)
  synced: boolean | null; // null on create; set once synced
}

// Position addressing differs by content type (Reader emits this):
//   EPUB → CFI string (epub.js text-selection anchor)
//   PDF  → page number (+ optional offset)
export type Locator =
  | { type: 'epub'; cfi: string }
  | { type: 'pdf'; page: number; offset?: number };

export interface Bookmark extends SyncBase {
  bookId: string;
  chapterId?: string;
  locator: Locator;
  name?: string; // optional user-given name (DB column: `name`)
  createdAt: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | string;

export interface Highlight extends SyncBase {
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
