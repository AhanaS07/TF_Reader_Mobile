// src/shared/contracts/tier.ts
// Access tier — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Download + Encryption (Abhinav). Referenced by Reader, Sync, and the
// catalogue/book object — must be readable off the book/catalogue object before a book is
// opened (BuildPlan.md Phase 0.3), since it's what branches the whole open/download flow.
//
//   OA         -> no encryption, no licence, downloadable and readable by anyone.
//   Subscribed -> encrypted + offline-licensed; whole-file decrypt on open (see BuildPlan.md
//                 "Amendment: whole-file decrypt").
//   Elite      -> no download, no offline path at all; read via Sync's seat + signed URL.
export type AccessTier = 'OA' | 'Subscribed' | 'Elite';
