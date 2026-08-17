// /features/personalization/prefsStore.ts
// Personalization prefs store — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). The settings-screen-facing seam for reading
// and writing the user's SharedPrefs.
//
// It does NOT own storage. The persisted, SQLite-backed layer is Sync's
// (features/sync/stores/personalizationStore.ts + accessibilityStore.ts, behind
// features/sync/sharedPrefs.ts), which merges the two tables into one SharedPrefs,
// seeds DEFAULT_PREFS on first run, and marks every write for sync. This wrapper is
// a thin, settings-facing adapter over that seam: `readSharedPrefs` / `writeSharedPrefs`
// / `resetSharedPrefs` are the legitimate coupling point (their public read/write API),
// so Personalization consumes them rather than reaching into Sync's stores or schema.
//
// This REPLACES the former in-memory `InMemoryPrefsStore` stub, which persisted only
// for the process lifetime and was never wired to anything. The shared-reference trap
// that stub's `freshDefaultPrefs()` guarded no longer exists here: every read
// reconstructs fresh nested objects from SQLite rows, and reset hands back a detached
// copy on Sync's side (`resetSharedPrefs` -> `structuredClone(DEFAULT_PREFS)`).
//
// Prefs are a per-user SINGLETON. There is no `userId` argument: the persisted layer
// is single-account today (Sync's `USER_ID` constant); when auth lands and identity
// becomes real, the account-vs-device question (see API_CONTRACT_NOTES.md §4) decides
// whether this signature grows one.
//
// FOLLOW-UP (not wired yet): a write should emit `PrefsChangedEvent` (event-bus.ts) so
// Reader re-reads and re-applies. There is no event-bus RUNTIME in the repo yet — the
// channel is contract-only — so there is nothing to publish through. Add the emit here
// (or in Sync's write path) the moment a bus lands.

import type { SharedPrefs } from '@/shared/contracts';
import {
  readSharedPrefs,
  writeSharedPrefs,
  resetSharedPrefs,
} from '@/features/sync/sharedPrefs';

// Caller may change value fields only. Identity + sync bookkeeping (and isDeleted,
// which prefs never set) are the store's job — mirrors the Omit in prefs.ts. A patch
// merges at the TOP level, so a nested group (typography/font/layout/zoom/accessibility)
// is replaced wholesale, not deep-merged — the settings screen sends the full group.
export type PrefsPatch = Partial<
  Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>
>;

export interface PrefsStore {
  /** Current prefs. Returns DEFAULT_PREFS on first run, before any row is written. */
  getPrefs(): Promise<SharedPrefs>;
  /** Apply a patch, persist it (marked for sync), and return the re-read result. */
  savePrefs(patch: PrefsPatch): Promise<SharedPrefs>;
  /** Restore defaults (a rewrite + updatedAt bump, not a tombstone) and return them. */
  resetPrefs(): Promise<SharedPrefs>;
}

export const prefsStore: PrefsStore = {
  getPrefs() {
    return readSharedPrefs();
  },

  async savePrefs(patch) {
    // Merge onto the current object. writeSharedPrefs stamps id/userId/updatedAt/
    // synced itself and ignores those on its input, so spreading the whole record
    // (rather than stripping them) is harmless and keeps this a one-liner merge.
    const current = await readSharedPrefs();
    await writeSharedPrefs({ ...current, ...patch });
    return readSharedPrefs();
  },

  async resetPrefs() {
    await resetSharedPrefs();
    return readSharedPrefs();
  },
};
