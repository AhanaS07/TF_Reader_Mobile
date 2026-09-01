
import {
  BOOK_ID,
  SERVER_RESOLVES_CONFLICTS,
  SUPPORTS_UPDATED_AFTER,
  USER_ID,
} from './syncConfig';
import { downloadMapper, ENTITY_PATHS } from './localDb/mappers';
import { SYNC_KEYS } from './localDb/schema';
import type { EntityType, OutboxRow } from './localDb/types';
import { nowIso } from './localDb/database';
import { accessibilityTable } from './stores/accessibilityStore';
import { bookmarkTable } from './stores/bookmarkStore';
import { downloadStore, downloadTable } from './stores/downloadStore';
import { highlightTable } from './stores/highlightStore';
import { outboxStore } from './stores/outboxStore';
import { personalizationTable } from './stores/personalizationStore';
import { progressTable } from './stores/progressStore';
import { syncMetadataStore } from './stores/syncMetadataStore';
import { api, ApiError } from './syncApi';
import { applyDownloadRecord, recordEntitlementCheck } from './offlineLock';
import { setSyncRunner } from './syncTrigger';

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

// Registers the actual runner behind syncTrigger.ts's requestSync() - see that file's header
// for why this indirection exists (breaks an import cycle back through every syncable table).
setSyncRunner(() => {
  void syncEngine.run();
});

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
    const table = TABLES[op.entity_type];
    let payload = JSON.parse(op.payload);
    let saved: any = null;

    try {
      if (!SERVER_RESOLVES_CONFLICTS) {
        const serverWins = await serverHasDiverged(op, entityPath);

        if (serverWins && !table.mergeFields) {
          report.conflicts += 1;
          await outboxStore.remove([op.id]);
          continue;
        }

        // A field-merge table (personalization, accessibility) never drops the operation here,
        // even when serverHasDiverged folded in someone else's newer field(s): "the server won
        // on some field" does not mean "my whole pending edit is moot" the way it does for a
        // whole-row table - I may still have OTHER fields that need to reach the server. Instead,
        // rebuild the payload from the row serverHasDiverged just merged into, so this push
        // carries both my own edited fields AND whatever I just adopted - sending the original,
        // pre-merge snapshot here would silently revert the merge the moment it lands.
        if (serverWins && table.mergeFields) {
          const fresh = await table.findById(op.entity_id);
          if (fresh) payload = table.toServerPayload(fresh);
        }
      }

      saved = await send(op, entityPath, payload);
    } catch (error) {
      // A different device's document already occupies this (userId, bookId, locator) slot,
      // under an id we never generated. Not retried under our own id (that would 404) - resolved
      // by adopting theirs and discarding ours entirely: this device's row never existed
      // server-side, so a tombstone would have nothing to propagate to.
      if (error instanceof LocatorCollision) {
        const existing = await findDuplicateRecord(error.entityType, error.payload);
        if (existing) {
          await TABLES[error.entityType].applyServerRecord(existing);
        }
        await TABLES[error.entityType].hardDeleteLocal(op.entity_id);
        report.conflicts += 1;
        await outboxStore.remove([op.id]);
        continue;
      }

      // The server already has a (possibly tombstoned) record for this book+format, under a
      // DIFFERENT id than this device's own - see `DownloadRestoreCollision`. Un-delete THAT
      // record via `restore`, then PUT this device's current fields onto it (restore only
      // reverses the delete; it does not know about whatever changed here since), and adopt the
      // result under its real id. This device's own id never existed server-side, so - same
      // reasoning as `LocatorCollision` - there is nothing to tombstone, only to discard.
      if (error instanceof DownloadRestoreCollision) {
        try {
          const existing = await findExistingDownload(error.payload);
          if (existing) {
            await api.restore<any>('downloads', existing.id);
            // error.payload still carries THIS device's stale id (it was the CREATE body that
            // just got rejected) - sending it as-is would PUT to the real record's URL with a
            // body that disagrees with it about which record this is, and if the response
            // echoes the body's id back, writeRow below writes the "restored" record under the
            // WRONG (stale) id - which hardDeleteLocal then immediately deletes, erasing what
            // was just written. Override it before it goes anywhere near the id.
            const updated = await api.update<any>('downloads', existing.id, {
              ...error.payload,
              id: existing.id,
            });
            // writeRow, NOT applyServerRecord: this is the confirmed, authoritative result of a
            // restore THIS device just performed, not a generic incoming pull that might be
            // stale or adversarial - it must not go through applyServerRecord's sticky-delete
            // guard. That guard's job is to stop a stale/unaware device's edit from undoing
            // ANOTHER device's delete; here it was instead blocking THIS device's own,
            // just-confirmed un-delete, because this id had an old local tombstone from before
            // it was ever deleted server-side (e.g. from an earlier clearAllDownloads()) -
            // applyServerRecord silently returned false, and the code below deleted the stale
            // attempt's row anyway, leaving nothing active locally at all.
            await TABLES.downloads.writeRow(downloadMapper.toRow(updated.data));
            await TABLES[op.entity_type].hardDeleteLocal(op.entity_id);
            report.conflicts += 1;
            await outboxStore.remove([op.id]);
            continue;
          }
        } catch {
          // Falls through to the park-and-preserve branch below - any failure while resolving
          // this (list, restore, or update all reach the network) must not risk the local row,
          // and must not propagate and abort every other queued operation either.
        }
        // Could not find, or could not restore, whatever the server thinks already occupies
        // this scope - do NOT discard the local row on a guess. Unlike LocatorCollision
        // (bookmarks/highlights, trivial content), a download backs an actually-downloaded
        // book: hardDeleteLocal here with nothing to replace it would make an already-downloaded,
        // already-readable book vanish from the local `downloads` table for nothing. Park the
        // operation and leave the local row exactly as it is - the book stays downloaded and
        // usable offline either way, and this is revisited on the next retry rather than losing
        // local state to find out why.
        report.failed += 1;
        await outboxStore.markFailed(op, 'download restore collision: could not resolve');
        continue;
      }

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

      // The payload is unacceptable, or (isNotFound) every recovery already tried above -
      // create-fallback, update-fallback, restore - still came back 404. Either way this ONE
      // operation cannot succeed as sent right now; back it off rather than blocking the queue.
      // Without this, one permanently-failing operation aborts every other operation queued
      // behind it, forever (see the downloads-CODE_TAKEN investigation, 2026-08-31) - a single
      // poison operation must not prevent unrelated ones from syncing.
      if (apiError?.isValidation || apiError?.isNotFound) {
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
  if (op.operation === 'DELETE') return sendDelete(entityPath, op.entity_id, payload, op.entity_type);
  if (op.operation === 'CREATE') return sendCreate(entityPath, op.entity_id, payload, op.entity_type);
  return sendUpdate(entityPath, op.entity_id, payload, op.entity_type);
}

/**
 * Wire field(s) that identify content-duplicate rows for a table where two devices can
 * legitimately generate two different ids for what is semantically the same thing (the same
 * bookmark, the same highlighted span) - see `LocatorCollision` below. Absent for every other
 * table: nothing else has this failure mode, because nothing else can collide on content while
 * differing only by device-minted id.
 */
const DUPLICATE_LOOKUP_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
  bookmarks: ['locator'],
  highlights: ['startLocator', 'endLocator'],
};

/**
 * Thrown by `sendCreate` when the 409 is a genuine content collision - a different device's
 * document already occupies this (userId, bookId, locator) slot under a DIFFERENT id - rather
 * than this device's own dropped-connection retry landing on the SAME id. Distinguished by the
 * server's `message` on the 409 body: `HIGHLIGHT_LOCATOR_DUPLICATION` / `BOOKMARK_LOCATOR_DUPLICATION`
 * mean a collision; anything else (e.g. "Bookmark '<id>' already exists") is the same-id retry,
 * which keeps the existing PUT-to-own-id handling.
 *
 * Not an ApiError subclass on purpose: `push()`'s generic ApiError branches (isConflict,
 * isValidation, ...) must not accidentally swallow this - it needs its own branch, checked first,
 * because resolving it means discarding this device's own id entirely rather than retrying under
 * it - see the note at the `push()` catch site.
 */
class LocatorCollision {
  constructor(
    readonly entityType: EntityType,
    readonly payload: Record<string, unknown>,
  ) {}
}

const LOCATOR_DUPLICATION_MESSAGES = new Set([
  'HIGHLIGHT_LOCATOR_DUPLICATION',
  'BOOKMARK_LOCATOR_DUPLICATION',
]);

function isLocatorDuplication(error: ApiError): boolean {
  return LOCATOR_DUPLICATION_MESSAGES.has(error.body?.message);
}

/**
 * Finds the document that actually owns this (userId, bookId, locator) slot, so it can be
 * adopted under ITS id in place of the one this device generated - see `LocatorCollision`.
 *
 * There is no "find by locator" endpoint, so this lists the whole collection and matches
 * client-side; both collections are scoped to one book and are not expected to be large. A
 * dedicated query is the honest fix if that stops being true.
 */
async function findDuplicateRecord(
  entityType: EntityType,
  payload: Record<string, unknown>,
): Promise<any | null> {
  const fields = DUPLICATE_LOOKUP_FIELDS[entityType];
  if (!fields) return null;

  // The OP'S OWN book, not the hardcoded BOOK_ID constant - a collision on, say,
  // `dev-fixture-pdf` must list that book's bookmarks, not `book-001`'s. Latent since
  // pull() went multi-book (§7, API_CONTRACT_NOTES.md): a duplicate on any book other than
  // the prototype's original hardcoded one would never find its match here and would fall
  // through to the plain PUT-under-own-id path, which 404s the same way DownloadRestoreCollision
  // exists to avoid below.
  const response = await api.list<any>(ENTITY_PATHS[entityType], {
    userId: USER_ID,
    bookId: String(payload.bookId ?? BOOK_ID),
  });

  return (
    (response.data ?? []).find(
      (record: any) =>
        !record.isDeleted &&
        fields.every((field) => JSON.stringify(record[field]) === JSON.stringify(payload[field])),
    ) ?? null
  );
}

/**
 * Thrown by `sendCreate` for `downloads` only, when the 409 is the backend's "this (bookId,
 * format) already has a record, even a soft-deleted one" scope rule (`CODE_TAKEN`) - confirmed
 * against the real backend 2026-08-31: a download tombstoned on a previous delete permanently
 * blocks a plain create for the same book+format, under ANY id, because the uniqueness check
 * runs against every record regardless of `isDeleted` while `findById`/`update` only see live
 * ones. There is nothing to retry under this device's own id - the record that needs to come
 * back to life lives under a DIFFERENT id this device does not know yet, and the only path back
 * from that tombstone is `POST /{id}/restore` on the real one (see `api.restore`).
 */
class DownloadRestoreCollision {
  constructor(readonly payload: Record<string, unknown>) {}
}

function isDownloadScopeCollision(error: ApiError): boolean {
  return error.body?.code === 'CODE_TAKEN';
}

/**
 * Finds this device's book+format under whatever id the server actually stored it, tombstoned or
 * not - `api.list` already sends `includeDeleted=true`. Scoped by the payload's OWN userId/bookId
 * (not the single-book-prototype `USER_ID`/`BOOK_ID` constants `findDuplicateRecord` uses above):
 * a download can be for any book, unlike bookmarks/highlights' single-open-book assumption.
 *
 * Exported for `downloadManager.ts` (Download, Abhinav): checking this BEFORE a create avoids
 * the CODE_TAKEN round trip entirely for the common case (re-downloading a book this device or
 * another one already has server-side history for) - this function's own resolution here in
 * `push()` stays as the safety net for the race that check narrows but cannot close (two devices
 * re-downloading the same book at nearly the same moment), not the primary path for it.
 */
export async function findExistingDownload(payload: Record<string, unknown>): Promise<any | null> {
  const response = await api.list<any>('downloads', {
    userId: payload.userId as string,
    bookId: payload.bookId as string,
  });
  return (response.data ?? []).find((record: any) => record.format === payload.format) ?? null;
}

/**
 * POST, falling back to PUT.
 *
 * The 409 means a previous attempt already created the document and we never
 * saw its response - a dropped connection after the write. Overwriting is the
 * right answer because the payload is a full snapshot, and it is what makes a
 * retried push idempotent rather than a duplicate.
 *
 * UNLESS the 409 is a locator collision (see `LocatorCollision`) or a downloads restore collision
 * (see `DownloadRestoreCollision`) - PUT-ing to our own id in either case would 404, because our
 * id never existed server-side; the document that does exist has someone else's id. Neither case
 * is retried here at all - both are thrown for `push()` to resolve, since resolving them means
 * discarding this device's local row, not sending anything further for it.
 */
async function sendCreate(
  entityPath: string,
  id: string,
  payload: any,
  entityType: EntityType,
): Promise<any> {
  try {
    return (await api.create<any>(entityPath, payload)).data;
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      if (isLocatorDuplication(error)) {
        throw new LocatorCollision(entityType, payload);
      }
      if (entityType === 'downloads' && isDownloadScopeCollision(error)) {
        throw new DownloadRestoreCollision(payload);
      }
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
async function sendUpdate(
  entityPath: string,
  id: string,
  payload: any,
  entityType: EntityType,
): Promise<any> {
  try {
    return (await api.update<any>(entityPath, id, payload)).data;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return sendCreate(entityPath, id, payload, entityType);
    }
    throw error;
  }
}

/**
 * A soft delete, which is the tombstone the design needs - the document stays
 * so the delete can reach other devices.
 */
async function sendDelete(
  entityPath: string,
  id: string,
  payload: any,
  entityType: EntityType,
): Promise<any> {
  try {
    return (await api.remove<any>(entityPath, id)).data;
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isNotFound) throw error;

    // Created and deleted in the same offline session, and the outbox coalesced
    // both into this one DELETE. The record still has to exist before it can be
    // tombstoned, and a create ignores `isDeleted`, so it takes both calls.
    await sendCreate(entityPath, id, payload, entityType);
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
  const since = SUPPORTS_UPDATED_AFTER
    ? await syncMetadataStore.get(SYNC_KEYS.LAST_PULL_TOKEN)
    : null;

  let checkpoint: string | null = null;

  // Every book this device has a local `downloads` row for - NOT discovered from the server.
  // A book only ever enters this list by being downloaded on this device first; pull() refreshes
  // metadata (bookmarks, highlights, progress, is_valid) for books already held, it does not
  // discover new ones. Computed once, up front: `downloads` is itself userBook-scoped and gets
  // pulled inside the same loop below, but its own book list doesn't need to observe that pull's
  // results - a book pulled in via someone else's `downloads` write was, definitionally, already
  // downloaded on THIS device first (see above), so it is already in this list.
  const bookIds = await downloadStore.downloadedBookIds(USER_ID);

  for (const entityType of Object.keys(TABLES) as EntityType[]) {
    const table = TABLES[entityType];
    const targets: (string | undefined)[] = SCOPE[entityType] === 'userBook' ? bookIds : [undefined];

    for (const bookId of targets) {
      const response = await api.list<any>(ENTITY_PATHS[entityType], {
        userId: USER_ID,
        bookId,
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

        // Field-merge tables (personalization, accessibility) only: a pending local edit
        // (synced: 0) survives this merge unchanged - see mergeFieldLevel - but the OUTBOX
        // entry that edit already queued was captured before this merge ran, so it does not yet
        // carry whatever field this pull just adopted from the server. Refresh it to the merged
        // state, or the next push sends the stale pre-merge snapshot and silently reverts that
        // field. Only for a pure pull; serverHasDiverged's own call to applyServerRecord (mid-
        // push, same row) is excluded by construction - see that function's own outbox handling.
        if (applied && table.mergeFields) {
          const fresh = await table.findById(record.id);
          if (fresh && (fresh as { synced: number }).synced === 0) {
            await outboxStore.enqueue(entityType, record.id, 'UPDATE', table.toServerPayload(fresh));
          }
        }
      }

      if (entityType === 'downloads') await recordEntitlementCheck();
    }
  }

  // The checkpoint moves only once everything above has landed in SQLite.
  if (checkpoint) {
    await syncMetadataStore.set(SYNC_KEYS.LAST_PULL_TOKEN, checkpoint);
  }
}
