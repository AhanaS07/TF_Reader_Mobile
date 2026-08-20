import {
  BOOK_ID,
  SERVER_RESOLVES_CONFLICTS,
  SUPPORTS_UPDATED_AFTER,
  USER_ID,
} from './syncConfig';
import { ENTITY_PATHS } from './localDb/mappers';
import { SYNC_KEYS } from './localDb/schema';
import type { EntityType, OutboxRow } from './localDb/types';
import { nowIso } from './localDb/database';
import { accessibilityTable } from './stores/accessibilityStore';
import { bookmarkTable } from './stores/bookmarkStore';
import { downloadTable } from './stores/downloadStore';
import { highlightTable } from './stores/highlightStore';
import { outboxStore } from './stores/outboxStore';
import { personalizationTable } from './stores/personalizationStore';
import { progressTable } from './stores/progressStore';
import { syncMetadataStore } from './stores/syncMetadataStore';
import { api, ApiError } from './syncApi';
import { applyDownloadRecord, recordEntitlementCheck } from './offlineLock';

/** One place that knows how to apply a server record for each entity type. */
const TABLES = {
  progress: progressTable,
  bookmarks: bookmarkTable,
  highlights: highlightTable,
  personalization: personalizationTable,
  accessibility: accessibilityTable,
  downloads: downloadTable,
} as const;

/**
 * `personalization` and `accessibility` are user scoped and carry no book_id,
 * so their collection GETs must not be filtered by one.
 */
const SCOPE: Record<EntityType, 'user' | 'userBook'> = {
  progress: 'userBook',
  bookmarks: 'userBook',
  highlights: 'userBook',
  downloads: 'userBook',
  personalization: 'user',
  accessibility: 'user',
};

export interface SyncReport {
  pushed: number;
  conflicts: number;
  failed: number;
  pulled: number;
  applied: number;
  error?: string;
}

let inFlight: Promise<SyncReport> | null = null;

/**
 * The Sync Manager, talking to the Mongo backend's per-entity CRUD endpoints.
 *
 * Push first so the server has our changes before we ask what it has, then pull. Three
 * invariants:
 *   1. An outbox row is removed only after the server has acknowledged it.
 *   2. The pull checkpoint advances only after every pulled change is applied.
 *   3. A stale local edit never overwrites a newer server record. Whoever does
 *      the comparison, the later `updatedAt` wins.
 *
 * The entitlement check (`B6`) is no longer a separate step: `downloads.isValid` is written
 * server-side now, so pulling `downloads` like any other collection IS the check - see
 * `offlineLock.ts`.
 */
export const syncEngine = {
  /** Concurrent calls share one run rather than racing each other. */
  run(): Promise<SyncReport> {
    if (!inFlight) {
      inFlight = execute().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  },

  isRunning(): boolean {
    return inFlight !== null;
  },
};

async function execute(): Promise<SyncReport> {
  const report: SyncReport = {
    pushed: 0,
    conflicts: 0,
    failed: 0,
    pulled: 0,
    applied: 0,
  };

  try {
    await push(report);
    await pull(report);
  } catch (error) {
    // A transient failure aborts the run with the queue intact. Whatever was
    // pushed before it stays pushed; nothing is lost and nothing is duplicated.
    report.error = error instanceof Error ? error.message : String(error);
  }

  return report;
}

// ------------------------------------------------------------------- PUSH

/**
 * Drains the outbox one operation at a time, oldest first.
 *
 * There is no batch endpoint, so acknowledgement is per operation - which is
 * strictly better for a connection that drops mid-drain: the operations already
 * sent are already cleared, and the rest are still queued in order.
 */
async function push(report: SyncReport): Promise<void> {
  const pending = await outboxStore.listPending();

  for (const op of pending) {
    const entityPath = ENTITY_PATHS[op.entity_type];
    const payload = JSON.parse(op.payload);
    let saved: any = null;

    try {
      if (!SERVER_RESOLVES_CONFLICTS) {
        const serverWins = await serverHasDiverged(op, entityPath);
        if (serverWins) {
          report.conflicts += 1;
          await outboxStore.remove([op.id]);
          continue;
        }
      }

      saved = await send(op, entityPath, payload);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;

      // Reserved for a server that compares timestamps itself and keeps its own
      // copy. This one does not, and `send` already absorbs the 409 that a
      // duplicate create returns, so nothing reaches here today.
      if (apiError?.isConflict) {
        report.conflicts += 1;
        if (apiError.body) {
          await TABLES[op.entity_type].applyServerRecord(apiError.body);
        }
        await outboxStore.remove([op.id]);
        continue;
      }

      // The payload is unacceptable. Back it off rather than blocking the queue.
      if (apiError?.isValidation) {
        report.failed += 1;
        await outboxStore.markFailed(op, apiError.message);
        continue;
      }

      // Offline, timed out, or a server fault: stop the run and keep the queue.
      throw error;
    }

    // Only now - after acknowledgement - is it safe to clear the queue.
    report.pushed += 1;
    await outboxStore.remove([op.id]);

    // Take the server's copy of the record, which carries the `updatedAt` it actually stored.
    // When it declines, the row was edited mid-push and is deliberately left unsynced - the
    // fresh outbox entry covers it.
    //
    // A 204 leaves nothing to adopt, so the row is just marked synced. This used to read
    // `!adopted && !saved`, where `adopted` is always false whenever `saved` is null - the
    // first half could never change the outcome.
    if (saved) {
      await TABLES[op.entity_type].adoptPushResult(saved, payload.updatedAt);
    } else {
      await TABLES[op.entity_type].markSynced([op.entity_id]);
    }
  }

  await syncMetadataStore.set(SYNC_KEYS.LAST_PUSH_AT, nowIso());
}

/** Dispatches one outbox operation and returns the record the server stored. */
function send(op: OutboxRow, entityPath: string, payload: any): Promise<any> {
  if (op.operation === 'DELETE') return sendDelete(entityPath, op.entity_id, payload);
  if (op.operation === 'CREATE') return sendCreate(entityPath, op.entity_id, payload);
  return sendUpdate(entityPath, op.entity_id, payload);
}

/**
 * POST, falling back to PUT.
 *
 * The 409 means a previous attempt already created the document and we never
 * saw its response - a dropped connection after the write. Overwriting is the
 * right answer because the payload is a full snapshot, and it is what makes a
 * retried push idempotent rather than a duplicate.
 */
async function sendCreate(entityPath: string, id: string, payload: any): Promise<any> {
  try {
    return (await api.create<any>(entityPath, payload)).data;
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      return (await api.update<any>(entityPath, id, payload)).data;
    }
    throw error;
  }
}

/**
 * PUT, falling back to POST.
 *
 * PUT is not an upsert here, and a 404 is expected rather than exceptional: a
 * record created offline and edited twice more arrives as a single coalesced
 * UPDATE, because the outbox keeps only the newest operation per record. The
 * server has never seen it, so it has to be created.
 */
async function sendUpdate(entityPath: string, id: string, payload: any): Promise<any> {
  try {
    return (await api.update<any>(entityPath, id, payload)).data;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return sendCreate(entityPath, id, payload);
    }
    throw error;
  }
}

/**
 * A soft delete, which is the tombstone the design needs - the document stays
 * so the delete can reach other devices.
 */
async function sendDelete(entityPath: string, id: string, payload: any): Promise<any> {
  try {
    return (await api.remove<any>(entityPath, id)).data;
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isNotFound) throw error;

    // Created and deleted in the same offline session, and the outbox coalesced
    // both into this one DELETE. The record still has to exist before it can be
    // tombstoned, and a create ignores `isDeleted`, so it takes both calls.
    await sendCreate(entityPath, id, payload);
    return (await api.remove<any>(entityPath, id)).data;
  }
}

/**
 * Has anyone else written this record since we last looked?
 *
 * A plain PUT overwrites blindly, so without this the device that reconnects
 * last wins regardless of when it actually made the edit. Once the Mongo
 * services do this comparison themselves, set SERVER_RESOLVES_CONFLICTS and
 * this extra GET disappears.
 *
 * The test is *not* which `updatedAt` is larger. It cannot be: the server
 * discards the timestamp we send and stamps its own, so comparing the two
 * compares a phone clock against a server clock and a few seconds of skew is
 * enough to throw away a page turn. Instead we compare the server's current
 * `updatedAt` against `server_updated_at`, the value it had when this device
 * last saw it. Unchanged means nothing happened there and our edit is safe;
 * different means a genuine concurrent write, and the server's copy wins.
 *
 * A null base version means the server has never acknowledged this record to
 * us. Since ids are minted on the device as UUIDs, any document already sitting
 * under that id is one of our own earlier pushes whose response was lost - so
 * that is not a conflict either, and overwriting it is exactly right.
 */
async function serverHasDiverged(
  op: OutboxRow,
  entityPath: string,
): Promise<boolean> {
  const local = await TABLES[op.entity_type].findById(op.entity_id);
  const base = local?.server_updated_at ?? null;
  if (!base) return false;

  let record: any;
  try {
    record = (await api.findById<any>(entityPath, op.entity_id)).data;
  } catch (error) {
    // Gone from the server entirely, so there is nothing to lose by writing.
    // Any other failure propagates: a push must not proceed on an unread check.
    if (error instanceof ApiError && error.isNotFound) return false;
    throw error;
  }

  if (!record?.updatedAt || record.updatedAt === base) return false;

  // Someone else wrote there since we last looked. Adopt their copy - but only report a
  // resolved conflict (and let `push` drop our operation) if it actually took:
  // `applyServerRecord`'s LWW guard can and does refuse to overwrite a local row that is itself
  // newer, in which case our edit still needs to reach the server, not vanish from the queue.
  return TABLES[op.entity_type].applyServerRecord(record);
}

// ------------------------------------------------------------------- PULL

/**
 * Reads each collection back and merges it into SQLite.
 *
 * Six GETs, one per entity type. `includeDeleted=true` is essential: without the
 * tombstones, a record deleted on another device would come back to life here.
 */
async function pull(report: SyncReport): Promise<void> {
  // NOTE: userBook entities are filtered by the single hard-coded BOOK_ID, so this pulls one
  // book and one book only - a second book on the same device would never sync. That is a
  // deliberate prototype limitation, not an oversight, but the reader is multi-book by
  // construction, so this loop and BOOK_ID both have to take a book list before it ships.
  const since = SUPPORTS_UPDATED_AFTER
    ? await syncMetadataStore.get(SYNC_KEYS.LAST_PULL_TOKEN)
    : null;

  let checkpoint: string | null = null;

  for (const entityType of Object.keys(TABLES) as EntityType[]) {
    const table = TABLES[entityType];
    const response = await api.list<any>(ENTITY_PATHS[entityType], {
      userId: USER_ID,
      bookId: SCOPE[entityType] === 'userBook' ? BOOK_ID : undefined,
      updatedAfter: since ?? undefined,
    });

    // The first response's clock is a lower bound for the whole pull, so a
    // record written while we were mid-pull lands inside the next window rather
    // than being skipped.
    if (checkpoint === null) checkpoint = response.serverTime;

    for (const record of response.data ?? []) {
      report.pulled += 1;
      // Last-Write-Wins, and device-local columns (local_path) are preserved. `downloads` goes
      // through applyDownloadRecord instead of the table directly - same LWW guard underneath,
      // but it also diffs isValid and emits content.lock/content.unlock on a real change (B6).
      const applied =
        entityType === 'downloads'
          ? await applyDownloadRecord(record)
          : await table.applyServerRecord(record);
      if (applied) report.applied += 1;
    }

    if (entityType === 'downloads') await recordEntitlementCheck();
  }

  // The checkpoint moves only once everything above has landed in SQLite.
  if (checkpoint) {
    await syncMetadataStore.set(SYNC_KEYS.LAST_PULL_TOKEN, checkpoint);
  }
}
