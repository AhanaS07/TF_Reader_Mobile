import { PUSH_ON_ENQUEUE_DEBOUNCE_MS } from './syncConfig';

/**
 * The seam that lets a local write ask for a sync run without importing `syncEngine.ts` directly.
 *
 * `syncableTable.ts`'s `saveLocal()` runs for every one of the six syncable tables -
 * `syncEngine.ts` imports every one of those tables' own store modules (`TABLES`), each of which
 * calls `createSyncableTable` from `syncableTable.ts`. So `syncableTable.ts` importing
 * `syncEngine.ts` directly would close a real cycle: syncableTable.ts -> syncEngine.ts ->
 * (progressStore.ts | bookmarkStore.ts | ...) -> syncableTable.ts. `syncEngine.ts` registers
 * itself here once at module load instead; `saveLocal()` calls `requestSync()`, never
 * `syncEngine.run()`.
 *
 * Debounced rather than called straight through: a burst of writes to the SAME record (e.g.
 * `progressStore.savePosition()` on every relocate while flipping through a book) would
 * otherwise fire one full network round trip per write. Waiting for a quiet period after the
 * LAST write in a burst lets one run pick up everything queued during it - the outbox already
 * coalesces same-record ops into one pending row (`outboxStore.enqueue`'s own doc comment); this
 * just keeps sync runs from outrunning that coalescing.
 */
let runner: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Called once, by syncEngine.ts, at module load. */
export function setSyncRunner(fn: () => void): void {
  runner = fn;
}

/** Called by `saveLocal()` after every local edit. A no-op until syncEngine.ts has registered. */
export function requestSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runner?.();
  }, PUSH_ON_ENQUEUE_DEBOUNCE_MS);
  // Node's Timeout (Jest/tests) exposes unref(); React Native's numeric timer id does not, so
  // this is a no-op there and a real one under Jest - without it, a debounce left pending when a
  // test file finishes holds that worker process open until it force-exits.
  (timer as unknown as { unref?: () => void }).unref?.();
}
