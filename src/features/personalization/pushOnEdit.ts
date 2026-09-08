// src/features/personalization/pushOnEdit.ts
// Owner: Personalization (Vaishnavi).
//
// One shared "push-on-edit" nudge for the local writes this capability makes (prefs, bookmarks,
// highlights). Every such write already persists to SQLite AND enqueues its sync outbox entry in one
// transaction, so it is durable and offline-safe on its own. This is only about LATENCY: without it,
// a change made while the app is already online sits in the outbox until the next app-open/reconnect
// that `useAutoSync` is edge-triggered on (it fires on the offline -> online transition and on mount,
// not on an edit). For a bookmark or highlight the user just made, "syncs on the next reconnect" reads
// as "did not sync", so we kick a run right after the write.

import { syncEngine } from '@/features/sync/syncEngine';

/**
 * Drain the outbox now, rather than waiting for `useAutoSync`'s next edge. Fire-and-forget on purpose:
 * the local write has already succeeded and returned, so the sync must never block it or fail it.
 *   - Offline, `syncEngine.run()` fails fast with the outbox intact, and `useAutoSync` still catches
 *     up on the next reconnect — so this only ever makes a change sync SOONER, never a precondition of
 *     it being saved.
 *   - Concurrent calls share one in-flight run (see `syncEngine.run`), so rapid edits (bookmark then
 *     highlight then another) collapse into one drain rather than stacking network calls.
 *   - `run()` resolves a `SyncReport` and does not reject (its `execute` catches transient failures
 *     into `report.error`), so `void` here cannot leave an unhandled rejection.
 */
export function pushNow(): void {
  void syncEngine.run();
}
