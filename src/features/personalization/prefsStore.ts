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
// LIVE RE-APPLY: this store is the notification channel, NOT the event bus. Ahana's
// prefs-application decision (2026-08-18) is explicit: no bus, and Karthik is not on the
// critical path. Reader subscribes to `subscribe()` below; a `savePrefs`/`resetPrefs`
// notifies subscribers with the fresh record, and Reader re-resolves + re-applies it into
// the WebView with no reopen. This is why the event-bus `PrefsChangedEvent` follow-up that
// used to live here is gone: the singleton store is the single JS-process source of truth,
// so a direct subscription is simpler than a bus and needs no second emitter.
// See READER_PREFS_APPLICATION.md §5.

import type { SharedPrefs } from '@/shared/contracts';
import {
  readSharedPrefs,
  writeSharedPrefs,
  resetSharedPrefs,
} from '@/features/sync/sharedPrefs';
import { syncEngine } from '@/features/sync/syncEngine';

// Caller may change value fields only. Identity + sync bookkeeping (and isDeleted,
// which prefs never set) are the store's job — mirrors the Omit in prefs.ts. A patch
// merges at the TOP level, so a nested group (typography/font/layout/zoom/accessibility)
// is replaced wholesale, not deep-merged — the settings screen sends the full group.
export type PrefsPatch = Partial<
  Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>
>;

/** Notified with the fresh record after every successful write. Returns unsubscribe. */
export type PrefsListener = (prefs: SharedPrefs) => void;

export interface PrefsStore {
  /** Current prefs. Returns DEFAULT_PREFS on first run, before any row is written. */
  getPrefs(): Promise<SharedPrefs>;
  /** Apply a patch, persist it (marked for sync), notify subscribers, and return the re-read result. */
  savePrefs(patch: PrefsPatch): Promise<SharedPrefs>;
  /** Restore defaults (a rewrite + updatedAt bump, not a tombstone), notify subscribers, and return them. */
  resetPrefs(): Promise<SharedPrefs>;
  /**
   * Subscribe to prefs changes. The listener fires AFTER a `savePrefs`/`resetPrefs` write
   * settles, with the fresh record — this is how the Reader re-applies live without a
   * reopen and without an event bus (see the header note). Returns an unsubscribe.
   *
   * Only local writes THROUGH this store notify. A prefs row pulled by Sync from the
   * server does not pass through here, so if that path ever needs to drive a live
   * re-apply it must notify too — call it out then rather than assuming this covers it.
   */
  subscribe(listener: PrefsListener): () => void;
}

// Module-level, matching the store's singleton nature. A Set so the same listener added
// twice is one entry, and unsubscribe is O(1).
const listeners = new Set<PrefsListener>();

function notify(prefs: SharedPrefs): void {
  // A throwing subscriber must not fail the write that already succeeded — mirrors the
  // event-bus contract's "emit never throws to its caller". Snapshot first so a listener
  // that unsubscribes mid-notify does not skip a sibling.
  for (const listener of [...listeners]) {
    try {
      listener(prefs);
    } catch {
      // Swallowed deliberately: the persist is done, and one bad subscriber must not
      // take out the others or the caller.
    }
  }
}

/**
 * PUSH-ON-EDIT: send a just-saved local edit to the server now, instead of waiting for the next
 * app-open/reconnect that `useAutoSync` is edge-triggered on. Fire-and-forget so the local write +
 * live re-apply never block on the network: `syncEngine.run()` drains the outbox entry the write
 * just queued. Offline it fails fast with the outbox intact, and `useAutoSync` still catches up on
 * reconnect — so this only ever syncs SOONER, it is never a dependency of the write succeeding.
 * Concurrent calls share one in-flight run (see syncEngine.run), so rapid edits do not stack.
 */
function pushNow(): void {
  void syncEngine.run();
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
    const fresh = await readSharedPrefs();
    notify(fresh);
    pushNow();
    return fresh;
  },

  async resetPrefs() {
    await resetSharedPrefs();
    const fresh = await readSharedPrefs();
    notify(fresh);
    pushNow();
    return fresh;
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
