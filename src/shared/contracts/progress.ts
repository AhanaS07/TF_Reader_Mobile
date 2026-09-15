// src/shared/contracts/progress.ts
// Reading Progress — CAP-7 Reader & Offline (Team t4targaryen)
// CFI (Canonical Fragment Identifier)
// Owner: Personalization (Vaishnavi). Coordinate table shape with Sync (Karthik).
// One progress record per (user, book) — a syncable business entity like
// bookmarks/highlights (its own synced record, client-generated UUID).
// Conflict resolution = LWW (last-write-wins) on updatedAt.
//
// RECONCILED (sync-base freeze): now imports SyncRecordBase from the canonical
// sync-record.ts, not SyncBase from annotations.ts.
import type { SyncRecordBase } from './sync-record';
import type { Locator } from './annotations';

// DB mapping (Day-1 freeze):
//   SQLite  progress: id, user_id, book_id, offset, updated_at, is_deleted, synced
//   Mongo   progress: { _id, userId, bookId, offset, updatedAt, isDeleted }
// Note: no createdAt (unlike bookmarks/highlights).
export interface Progress extends SyncRecordBase {
  bookId: string;
  // Current reading position. Raw integer offset per the freeze; still authoritative for PDF.
  offset: number;
  // Authoritative position addressing per content type. A reflowable EPUB has no stable integer
  // offset (the same character sits at a different offset at a different font size/viewport), so
  // it carries a CFI instead. Nullable: rows written before this column existed send null, and
  // readers fall back to `offset`. Resolves the earlier OPEN item raised with Karthik (Sync).
  locator: Locator | null;
}
