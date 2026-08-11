// src/shared/contracts/sync-record.ts
// Sync record base — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Sync (Karthik). CANONICAL base every syncable record extends. Single
// definition — annotations.ts no longer inlines its own SyncBase, prefs.ts no
// longer inlines these fields, and progress.ts imports from here.
//
// Convention (Karthik's sync-layer contract — CLIENT-edit-time LWW):
//   - id / userId are set by the client on create.
//   - updatedAt: the CLIENT stamps it at edit time (wall-time ms). It is the LWW
//     comparison key, so it must exist the moment you write — offline, before any
//     sync. Last EDIT wins, not last arrival. NON-null.
//   - synced: false on create; the sync layer flips it true once the change is
//     acknowledged. NON-null (false is the natural "not yet synced" state).
//   - delete = soft delete: isDeleted=true (tombstone), whole record still sent.
//   - conflict resolution is per-record: LWW on updatedAt for prefs / progress /
//     bookmarks; MERGE/UNION for highlights (updatedAt still present, just not
//     the resolution key there).
import type { Timestamp } from '../types/primitives';

export interface SyncRecordBase {
  id: string;           // client-generated UUID, unique per record
  userId: string;       // owner; sent with every change
  updatedAt: Timestamp; // client wall-time ms, stamped at edit time. LWW key.
  isDeleted: boolean;   // true = tombstoned (soft delete)
  synced: boolean;      // false on create; set true once synced
}