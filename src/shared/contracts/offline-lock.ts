// src/shared/contracts/offline-lock.ts
// Offline lock — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: JOINT — Sync (Karthik) + Encryption (Abhinav). index.ts has always reserved this file
// and named the `content.lock` / `content.unlock` signals that live here.
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────┐
// │ PROPOSAL — NOT FINALISED, NOT WIRED, NOT IMPLEMENTED.                                   │
// │                                                                                         │
// │ Types and signal shapes only. Nothing in the app imports this file and the barrel export │
// │ in index.ts stays commented out until Encryption signs off. Deliberately no functions,   │
// │ no store, no bus instance — a joint contract has to be agreed before it is built, and    │
// │ the last attempt at this shipped an implementation instead of an agreement.              │
// └─────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY THIS FILE EXISTS AT ALL
//
// Sync's first attempt at offline entitlement was withdrawn in review, and the reason is the
// thing this contract has to fix. That attempt added a `downloads.is_valid` column driven by
// `GET /api/v1/licences/book/{id}/expired` — a SECOND source of entitlement truth, from a
// different backend collection than the `SignedLicence` that ships inside the
// `EncryptedPackage` and that Encryption already verifies at decrypt time. Two sources that
// can disagree in both directions, with `is_valid` also being a synced column, so one device's
// verdict propagated to every other device.
//
// The division of labour below is the correction:
//
//   Encryption OWNS ENFORCEMENT. It already refuses to decrypt an expired licence, offline
//   included, from `SignedLicence.expiresAt` — raising ContentError.LICENCE_EXPIRED. That is
//   the only gate. Nothing Sync writes can open a book that Encryption will not decrypt, and
//   nothing Sync fails to write can close one.
//
//   Sync OWNS TRANSPORT AND NOTIFICATION. It is the component that talks to the server, so it
//   is the one that learns a licence was revoked before the cached copy expires. It reports
//   that; it does not act on it.
//
// The signals are therefore ADVISORY, with exactly one privileged exception (`revoked`, below)
// where Sync asks Encryption to destroy key material. Every other signal is a hint for UI
// messaging and cache housekeeping.

import type { BookId, Timestamp } from '../types/primitives';

/* ────────────────────────────────────────────────────────────────
   LOCK STATE
   ──────────────────────────────────────────────────────────────── */

/**
 * Why a book is locked, when it is.
 *
 * `unknown` is first and is the default for a reason: a device that has not reached the server
 * has NOT learned that a book is fine, and it has not learned that it is revoked either. The
 * withdrawn implementation collapsed those two into "valid", which is why a book with no
 * licence document read as readable.
 *
 * Q4 RESOLVED (2026-08-26): `memory-only` (Elite / `canPersist: false`) is NOT a lock concern.
 * The licence model is known at download time and never changes without an explicit new licence.
 * Lock signals exist for the UNEXPECTED — revocation from the server, or expiry discovered only
 * after caching. Elite status is neither. Removed from LockReason.
 */
export type LockReason =
  /** Never asked, or asked and could not reach the server. Carries no verdict either way. */
  | 'unknown'
  /** The server says this licence no longer entitles the user. Privileged — see LockSignal. */
  | 'revoked'
  /** `SignedLicence.expiresAt` has passed. Encryption detects this alone, offline, unaided. */
  | 'expired';

export interface LockState {
  bookId: BookId;
  /**
   * Whether the book may be OPENED.
   *
   * ADVISORY. Encryption is the gate; this is what the UI reads to explain itself. A consumer
   * must never treat `locked: false` as permission to bypass `getBook()`.
   */
  locked: boolean;
  reason: LockReason;
  /** From `SignedLicence.expiresAt`. ISO-8601 UTC on the wire, so kept as a string. */
  expiresAt: string | null;
  /**
   * When this verdict was last confirmed against the server.
   *
   * Null means never. This is the field that distinguishes "asked, and the book is fine" from
   * "never asked" — a distinction a boolean cannot carry, and whose absence was the specific
   * defect in the withdrawn version.
   */
  lastConfirmedAt: Timestamp | null;
}

/* ────────────────────────────────────────────────────────────────
   SIGNALS
   ────────────────────────────────────────────────────────────────
   The `content.lock` / `content.unlock` pair index.ts refers to. Sync emits, Encryption and
   Reader subscribe. Carried over the event bus in event-bus.ts.
   ──────────────────────────────────────────────────────────────── */

export const OFFLINE_LOCK_EVENTS = {
  LOCK: 'content.lock',
  UNLOCK: 'content.unlock',
} as const;

/**
 * Sync learned that a book should be locked.
 *
 * PRIVILEGED CASE — `reason: 'revoked'` is the one signal that asks Encryption to act: destroy
 * the stored BEK for this book (`keyStorage.ts` already documents this trigger — "when Sync's
 * offline-lock signal fires"). Revocation is the case Encryption CANNOT detect on its own,
 * because the cached licence is still within `expiresAt`; only the server knows.
 *
 * Every other reason is advisory. In particular `'expired'` needs no action at all — Encryption
 * already refuses it from the licence itself. Sync emitting it is a UI convenience.
 *
 * FAIL-OPEN, and this is a contract requirement rather than an implementation detail: being
 * offline, timing out, or hitting an undeployed endpoint MUST NOT emit a lock. Revoking a book
 * because the Wi-Fi dropped is a worse failure than checking again a moment later. The
 * consequence is explicit and accepted: a revocation only lands once the device actually
 * reaches the server, so a revoked book stays readable while the device stays offline. Closing
 * that window needs an anti-rollback high-water-mark, which is Phase 6 and not this contract.
 */
export interface LockSignal {
  type: typeof OFFLINE_LOCK_EVENTS.LOCK;
  bookId: BookId;
  reason: Exclude<LockReason, 'unknown'>;
  /** When the server actually told us. Not the device's guess. */
  observedAt: Timestamp;
}

/**
 * Sync learned that a previously locked book is entitled again — a renewed licence, or a
 * revocation that was itself reversed.
 *
 * Purely advisory: it never grants access on its own. Encryption re-checks the licence when the
 * book is next opened, and if the new licence has not actually arrived the book stays shut
 * regardless of this signal.
 */
export interface UnlockSignal {
  type: typeof OFFLINE_LOCK_EVENTS.UNLOCK;
  bookId: BookId;
  observedAt: Timestamp;
}

export type OfflineLockSignal = LockSignal | UnlockSignal;

/* ────────────────────────────────────────────────────────────────
   OPEN QUESTIONS — for the joint session, not to be resolved unilaterally
   ──────────────────────────────────────────────────────────────── */

// 1. [Abhinav] Which endpoint is authoritative for revocation? The withdrawn version used
//    `GET /api/v1/licences/book/{id}/expired`, a bare boolean from a collection unrelated to
//    the licence inside the EncryptedPackage. If revocation instead arrives as a re-issued
//    SignedLicence via the download/licence endpoint, Sync should not be polling at all — it
//    should be refreshing the licence, and this whole signal collapses into that refresh.
//
// 2. [Abhinav] Does `reason: 'revoked'` destroy the BEK immediately, or mark it for destruction?
//    Immediate destruction is unrecoverable: if the revocation was wrong, or the licence is
//    renewed a minute later, the book must be re-downloaded in full. keyStorage.removeBek is
//    written for the immediate reading; confirm that is intended.
//
// 3. [Karthik] Does lock state persist locally, and if so where? It deliberately has no column
//    in the sync schema right now — that was the duplicate source of truth. If the UI needs to
//    explain a lock across an app restart it needs to be somewhere, but it must be a CACHE of
//    Encryption's verdict, never an input to it, and it must not be a synced column: one
//    device's verdict must not propagate as another device's truth.
//
// Q4 RESOLVED (2026-08-26): `memory-only` is NOT a lock concern. Elite status is known at
// download time and does not change unexpectedly. Removed from LockReason type. Elite books are
// simply never available offline; no signal needed.
//
// Q5 RESOLVED (2026-08-26): `reason: 'unknown'` means "never pulled" — Reader should render it
// as "status unknown" or remain silent in the UI. Do NOT claim entitlement. The absence of
// confirmation is itself the message: if a device has not reached the server since download, it
// has not confirmed this book is still entitled. Show uncertainty, not a false guarantee.
