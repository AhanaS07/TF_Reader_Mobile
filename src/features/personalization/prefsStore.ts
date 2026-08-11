// /features/personalization/prefsStore.ts
// Personalization store (STUB) — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). Day-2 deliverable: "stub the
// personalization store (settings → SQLite via Karthik's schema, marked for sync)."
//
// STUB: persists SharedPrefs IN MEMORY only, behind the PrefsStore interface.
// The on-device SQLite store isn't in this repo yet (Karthik's SQLite/Mongo live
// in the backend repo; src/features/sync is a .gitkeep). We depend ONLY on the
// frozen contract (SyncRecordBase, in shared/contracts) — not on the DB. When an
// on-device SQLite adapter lands, add a SqlitePrefsStore implementing this same
// interface and swap it in with no caller changes.
//
// Prefs are a per-user SINGLETON. Every write stamps updatedAt and sets
// synced=false ("marked for sync"). LWW on updatedAt (see prefs.ts).
//
// NO DELETE: prefs has no delete op (per prefs.ts). isDeleted comes from the
// frozen SyncRecordBase and is REQUIRED by the type, so it must exist — we pin it
// to false and never expose a way to change it.

import { SharedPrefs, DEFAULT_PREFS } from '@/shared/contracts';

// Caller may change value fields only. Identity + sync bookkeeping (and isDeleted,
// which we don't use) are the store's job — mirrors the Omit in prefs.ts.
export type PrefsPatch = Partial<
  Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>
>;

export interface PrefsStore {
  getPrefs(userId: string): SharedPrefs;                     // seeds DEFAULT_PREFS on first access
  savePrefs(userId: string, patch: PrefsPatch): SharedPrefs; // merge + stamp + mark dirty
  resetPrefs(userId: string): SharedPrefs;                   // restore defaults (still a write)
}

// Injectable — no hard uuid dep yet (Karthik fixes the client UUID scheme Day 4).
type IdGen = () => string;
type Clock = () => number;

const stubId: IdGen = () => `prefs-stub-${Math.floor(Math.random() * 1e9)}`;
const wallClock: Clock = () => Date.now();

export class InMemoryPrefsStore implements PrefsStore {
  private byUser = new Map<string, SharedPrefs>();

  constructor(private genId: IdGen = stubId, private now: Clock = wallClock) {}

  getPrefs(userId: string): SharedPrefs {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const seeded: SharedPrefs = {
      id: this.genId(),
      userId,
      ...DEFAULT_PREFS,
      isDeleted: false, // required by SyncRecordBase; pinned — no delete op
      updatedAt: this.now(),
      synced: true,     // seeded defaults aren't a user edit → not dirty yet
    };
    this.byUser.set(userId, seeded);
    return seeded;
  }

  savePrefs(userId: string, patch: PrefsPatch): SharedPrefs {
    const current = this.getPrefs(userId);
    const next: SharedPrefs = {
      ...current,
      ...patch,
      updatedAt: this.now(), // LWW stamp
      synced: false,         // marked for sync → Karthik's outbox
    };
    this.byUser.set(userId, next);
    return next;
  }

  resetPrefs(userId: string): SharedPrefs {
    // Reset = rewrite + updatedAt bump, NOT a tombstone (per prefs.ts).
    return this.savePrefs(userId, { ...DEFAULT_PREFS });
  }
}
