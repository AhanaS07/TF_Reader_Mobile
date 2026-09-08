// src/shared/contracts/tier.ts
// Access tier — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Download + Encryption (Abhinav). Referenced by Reader, Sync, and the
// catalogue/book object — must be readable off the book/catalogue object before a book is
// opened (BuildPlan.md Phase 0.3), since it's what branches the whole open/download flow.
//
// THIS FILE NO LONGER DECLARES ITS OWN VALUES. It used to spell the three tiers
// `'OA' | 'Subscribed' | 'Elite'`, which was a FOURTH vocabulary for a set of values that already
// had three (B9 in `CONTRACT_ALIGNMENT.md`):
//
//   wokay's own surface          AccessTier    OPEN_ACCESS | SUBSCRIPTION | ELITE
//   the Java seam flambeau reads AccessLevel   OPEN_ACCESS | ENTITLED_UNLIMITED | ENTITLED_CONCURRENT
//   this app, on the wire        LicenceModel  OPEN_ACCESS | SUBSCRIPTION | ELITE
//
// wokay's whole stated point is "same three values in all three places, so a client never
// translates" — and a fourth spelling that nothing used was a translation waiting to happen. It is
// now an alias, so the name stays importable and any future user gets the wire values.
//
// Deleting the alias outright is the cleaner end state and is what B9 actually recommends, but
// this is a Week-1 frozen file and removing an export from the barrel is a Gate conversation.
// Aliasing is the part that can be done unilaterally, because it cannot break a caller.

import type { LicenceModel } from './reading-session';

/**
 * @deprecated Import `LicenceModel` from `reading-session.ts` instead. Kept only so the
 * `AccessTier` name resolves; it carries no distinct values of its own.
 *
 *   OPEN_ACCESS  -> no encryption, no licence, downloadable and readable by anyone.
 *   SUBSCRIPTION -> encrypted + offline-licensed; whole-file decrypt on open (see BuildPlan.md
 *                   "Amendment: whole-file decrypt").
 *   ELITE        -> no download, no offline path at all; read online, in memory only.
 *
 * NOTE the tier is NOT what gates the download button — `Loan.canPersist` is. The server refuses
 * `intent: DOWNLOAD` for ELITE regardless of what the UI offered, and wokay's own guidance is to
 * "use canPersist for the download button, not the tier."
 */
export type AccessTier = LicenceModel;
