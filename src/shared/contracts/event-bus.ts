// src/shared/contracts/event-bus.ts
// Cross-capability event bus — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Sync (Karthik), as the component that emits most of these. Consumed by Encryption,
// Reader and Personalization.
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────┐
// │ PROPOSAL — NOT FINALISED, NOT WIRED, NOT IMPLEMENTED.                                   │
// │                                                                                         │
// │ Types, channel names and the interface SHAPE only. There is no bus instance in this      │
// │ file, no subscribe/publish body, and no export from index.ts. Nothing imports it.        │
// │ Deliberate: this exists so the offline-lock signals have a defined carrier to be         │
// │ discussed against, not so anyone can start emitting on it today.                         │
// └─────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY A BUS, AND WHY IT IS THE NARROW OPTION
//
// The alternative is direct calls, and the review that produced this file is the argument
// against them. The withdrawn offline-lock work coupled Sync to entitlement enforcement — Sync
// wrote a column that gated reading. The fix is not a better column; it is that Sync should
// ANNOUNCE what it learned and let the owner of each concern decide what to do.
//
// It is also what keeps the no-cross-module-imports rule enforceable. Sync must not import
// Encryption to tell it a licence was revoked, and Encryption must not import Sync to ask. Both
// depend on this contract instead, which is the only legitimate coupling between capability
// modules.
//
// SCOPE — deliberately small. This is NOT a general application event system, NOT a state
// manager, and NOT a replacement for the stores. One rule: an event reports something that
// ALREADY HAPPENED. It is never a request for work, never a command, and no emitter may depend
// on a subscriber having handled it. Anything that needs a reply is a function call, not an
// event.

import type { BookId, Timestamp } from '../types/primitives';
import type { OfflineLockSignal } from './offline-lock';

/* ────────────────────────────────────────────────────────────────
   CHANNELS
   ────────────────────────────────────────────────────────────────
   Dot-namespaced by emitting capability. `content.*` is Encryption's namespace and is where
   index.ts already places `content.lock` / `content.unlock`, because the SUBJECT is content
   even though Sync is the emitter.
   ──────────────────────────────────────────────────────────────── */

export const EVENT_CHANNELS = {
  /** Entitlement changed for a book. Payload: OfflineLockSignal. */
  CONTENT_LOCK: 'content.lock',
  CONTENT_UNLOCK: 'content.unlock',

  /** A sync run finished. Advisory — for a "last synced" indicator and refresh-on-change. */
  SYNC_COMPLETED: 'sync.completed',
  /** The push queue depth changed. Advisory — for a pending-changes badge. */
  SYNC_QUEUE_CHANGED: 'sync.queueChanged',
  /** Records for one entity type were applied from the server, so any view of them is stale. */
  SYNC_ENTITY_APPLIED: 'sync.entityApplied',

  /** The merged SharedPrefs changed, from either table. Reader re-applies. */
  PREFS_CHANGED: 'prefs.changed',
} as const;

export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];

/* ────────────────────────────────────────────────────────────────
   PAYLOADS
   ──────────────────────────────────────────────────────────────── */

/**
 * Emitted once per completed sync run, successful or not.
 *
 * Carries counts rather than the records themselves: a subscriber that wants data reads it from
 * the store. Putting rows on the bus would make the bus a second copy of the database, which is
 * the failure mode that turns an event system into a state manager.
 */
export interface SyncCompletedEvent {
  pushed: number;
  pulled: number;
  applied: number;
  conflicts: number;
  failed: number;
  /** Present when the run aborted. A run that failed still emits - silence is not a result. */
  error?: string;
  at: Timestamp;
}

export interface SyncQueueChangedEvent {
  /** PENDING + FAILED. Excludes DEAD, matching outboxStore.countPending. */
  pending: number;
  at: Timestamp;
}

/**
 * Records of one entity type were written from the server.
 *
 * Deliberately per-entity rather than one blanket "something changed": a bookmarks pull should
 * not force Reader to re-apply typography.
 */
export interface SyncEntityAppliedEvent {
  entityType: 'progress' | 'bookmarks' | 'highlights' | 'personalization' | 'accessibility' | 'downloads';
  count: number;
  bookId: BookId | null;
  at: Timestamp;
}

/**
 * The merged prefs record changed.
 *
 * Emitted for a local edit AND for a pulled one, because Reader cannot tell the difference and
 * should not have to. Carries no payload: prefs are a singleton, so the subscriber re-reads
 * `readSharedPrefs()` and gets the whole current object rather than trying to patch a diff.
 */
export interface PrefsChangedEvent {
  /** Which half moved. Both tables resolve independently - see the a11y amendment. */
  source: 'personalization' | 'accessibility';
  at: Timestamp;
}

/** Channel-to-payload map. The single place that defines what each channel carries. */
export interface EventPayloads {
  [EVENT_CHANNELS.CONTENT_LOCK]: OfflineLockSignal;
  [EVENT_CHANNELS.CONTENT_UNLOCK]: OfflineLockSignal;
  [EVENT_CHANNELS.SYNC_COMPLETED]: SyncCompletedEvent;
  [EVENT_CHANNELS.SYNC_QUEUE_CHANGED]: SyncQueueChangedEvent;
  [EVENT_CHANNELS.SYNC_ENTITY_APPLIED]: SyncEntityAppliedEvent;
  [EVENT_CHANNELS.PREFS_CHANGED]: PrefsChangedEvent;
}

/* ────────────────────────────────────────────────────────────────
   INTERFACE
   ──────────────────────────────────────────────────────────────── */

export type EventHandler<C extends keyof EventPayloads> = (
  payload: EventPayloads[C],
) => void;

/** Call to stop listening. Returned rather than requiring the handler reference back. */
export type Unsubscribe = () => void;

/**
 * The bus surface. SHAPE ONLY — no implementation in this file.
 *
 * Three properties the implementation will owe, spelled out here because they are contract, not
 * choices:
 *
 *  1. `emit` NEVER THROWS to its caller. A subscriber that throws must not fail the sync run
 *     that announced the event. Sync's job is done at the point it emits.
 *
 *  2. Delivery is SYNCHRONOUS and ordered per channel. Two `sync.entityApplied` events must
 *     arrive in the order emitted, or a subscriber rebuilding a view can settle on stale data.
 *
 *  3. No replay, no buffering. A subscriber that attaches late has missed the event, by design —
 *     a buffer would make this a state store, and the current state already lives in SQLite.
 *     Anything that needs current state reads it; the event only says "now would be a good time
 *     to look".
 */
export interface EventBus {
  emit<C extends keyof EventPayloads>(channel: C, payload: EventPayloads[C]): void;
  on<C extends keyof EventPayloads>(channel: C, handler: EventHandler<C>): Unsubscribe;
  /** Auto-unsubscribes after the first delivery. */
  once<C extends keyof EventPayloads>(channel: C, handler: EventHandler<C>): Unsubscribe;
}

/* ────────────────────────────────────────────────────────────────
   OPEN QUESTIONS
   ──────────────────────────────────────────────────────────────── */

// 1. [Ahana] Is a bus wanted here at all, or should Reader subscribe to stores directly (a
//    zustand/observable pattern) and skip this layer? The bus earns its place for `content.*`,
//    where the emitter and consumer must not import each other. It is much less obviously right
//    for `prefs.changed`, where Reader could simply re-read on focus. Happy to cut the sync.*
//    and prefs.* channels entirely and keep this to the offline-lock signals.
//
// 2. [Whoever owns app bootstrap] Where does the single instance live, and who creates it? A
//    module-level singleton is simplest but is awkward to reset between tests — the same problem
//    `getDatabase()`'s cached promise already has.
//
// 3. [Abhinav] Does Encryption want to SUBSCRIBE to `content.lock`, or would it rather Sync
//    called `keyStorage.removeBek` through a narrow injected port? A subscription inverts the
//    dependency nicely but makes the destruction of key material an implicit consequence of an
//    event, which is arguably too quiet for something unrecoverable.
//
// 4. [All] Error channel? Currently a failed sync run reports via `error` on
//    SyncCompletedEvent, and nothing else emits failures. If more capabilities need to surface
//    errors this wants a real channel with a defined shape, not an optional string.
