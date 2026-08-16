// /features/personalization/prefsStore.ts
// Personalization store (STUB) — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). Day-2 deliverable: "stub the
// personalization store (settings → SQLite via Karthik's schema, marked for sync)."
//
// STUB: persists SharedPrefs IN MEMORY only, behind the PrefsStore interface.
// We depend ONLY on the frozen contract (SyncRecordBase, in shared/contracts) —
// not on the DB.
//
// SUPERSEDED, AND CURRENTLY UNREFERENCED — decide before building on it.
// The swap this file was written to anticipate ("when an on-device SQLite adapter
// lands, add a SqlitePrefsStore implementing this same interface") did not happen
// through this interface. Sync landed its own on-device layer instead:
// features/sync/stores/personalizationStore.ts + accessibilityStore.ts behind
// features/sync/sharedPrefs.ts's readSharedPrefs() / writeSharedPrefs(), which
// merge both tables into one SharedPrefs and are the real persisted read path.
// Nothing in src/ imports PrefsStore or InMemoryPrefsStore any more (this file and
// its test are the only references).
//
// So this is either the settings-screen-facing seam that Sync's stores get plugged
// into, or it is dead code to delete. That is Personalization's call, not Reader's
// — it is only flagged here so the next reader does not treat an unreferenced stub
// as the live store. Its own value is intact either way: freshDefaultPrefs() below
// is the one place that solves prefs.ts:79's shared-reference trap, and the two
// cross-user aliasing tests are the only coverage of it.
//
// Prefs are a per-user SINGLETON. Every write stamps updatedAt and sets
// synced=false ("marked for sync"). LWW on updatedAt (see prefs.ts).
//
// NO DELETE: prefs has no delete op (per prefs.ts). isDeleted comes from the
// frozen SyncRecordBase and is REQUIRED by the type, so it must exist — we pin it
// to false and never expose a way to change it.

import { SharedPrefs, DEFAULT_PREFS, createDefaultAccessibilityPrefs } from '@/shared/contracts';

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

// DEFAULT_PREFS' nested value objects (font/typography/layout/zoom/accessibility)
// are shared singletons — see prefs.ts / accessibility.ts's "shared reference,
// do NOT mutate" note on DEFAULT_ACCESSIBILITY_PREFS. Seeding a new user or
// resetting one must hand out FRESH copies of each nested object, or every
// user — and every reset — ends up sharing the exact same nested objects:
// mutate one user's accessibility block and every other "independent" user's
// record changes too. This is a per-user SINGLETON store; defaults must not
// be aliased across users.
function freshDefaultPrefs(): typeof DEFAULT_PREFS {
  return {
    ...DEFAULT_PREFS,
    font: { ...DEFAULT_PREFS.font },
    typography: { ...DEFAULT_PREFS.typography },
    layout: { ...DEFAULT_PREFS.layout },
    zoom: { ...DEFAULT_PREFS.zoom },
    accessibility: createDefaultAccessibilityPrefs(),
  };
}

export class InMemoryPrefsStore implements PrefsStore {
  private byUser = new Map<string, SharedPrefs>();

  constructor(private genId: IdGen = stubId, private now: Clock = wallClock) {}

  getPrefs(userId: string): SharedPrefs {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const seeded: SharedPrefs = {
      id: this.genId(),
      userId,
      ...freshDefaultPrefs(),
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
    return this.savePrefs(userId, freshDefaultPrefs());
  }
}
