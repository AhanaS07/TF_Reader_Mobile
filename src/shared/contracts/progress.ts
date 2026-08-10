// /shared/progress.ts
// Reading Progress — CAP-7 Reader & Offline (Team t4targaryen)
//CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi). Coordinate table shape with Sync (Karthik).
// One progress record per (user, book) — a syncable business entity like
// bookmarks/highlights (its own synced record, client-generated UUID).
// Conflict resolution = LWW (last-write-wins) on updatedAt.

import type { SyncBase } from './annotations';

// DB mapping (Day-1 freeze):
//   SQLite  progress: id, user_id, book_id, offset, updated_at, is_deleted, synced
//   Mongo   progress: { _id, userId, bookId, offset, updatedAt, isDeleted }
// Note: no createdAt (unlike bookmarks/highlights).
export interface Progress extends SyncBase {
  bookId: string;
  // Current reading position. Raw integer offset per the freeze.
  // OPEN (confirm w/ Karthik): EPUB reflowable needs a stable anchor (CFI) —
  // an integer offset may not restore position correctly. PDF is fine on page/offset.
  offset: number;
}
