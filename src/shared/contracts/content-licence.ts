// src/shared/contracts/content-licence.ts
// Content-licence HTTP response — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Download + Encryption (Abhinav). Response shape for `GET /books/:id/content-licence`
// — merged endpoint per BuildPlan.md Phase 0.5 (manifest + licence combined; nothing depended
// on the split).
//
// Reconciled 2026-08-11 against the now-canonical `content-provider.ts` (Ahana, sourced
// verbatim from the wokay backend spec): `encryption`/`licence` below reuse
// `EncryptionDescriptor`/`SignedLicence` directly instead of a parallel, independently-named
// shape, since those field names ARE the real wire format, not just an on-device convention.
//
// Fields deliberately NOT here, and why:
//   - `uid`      — not part of the licence anywhere in the canonical contract; the request is
//                  already scoped to the authenticated user. (Download's own LOCAL metadata
//                  record still needs a userId per BuildPlan.md Phase 4.7 — that's a different,
//                  unrelated type, not this wire response.)
//   - `start`    — canonical `SignedLicence` only carries `expiresAt`. Phase 6's anti-rollback
//                  high-water-mark can be seeded from local receipt time instead of a
//                  server-provided start date.
//   - `tier`     — redundant: BuildPlan.md Phase 0.3 already has tier on the catalogue/book
//                  object before this endpoint is ever called. Tier is also implicit here in
//                  the null-ness of `encryption`/`licence` (both null => OA) and
//                  `licence.canPersist` (false => Elite).
//
// Whole-file decrypt (BuildPlan.md "Amendment: whole-file decrypt", 2026-08-11): one AES-GCM
// payload for the entire file, matching `EncryptedPackage.content` — see
// src/features/encryption/cipherLayout.ts.
//
// DRAFT — written against a mock backend, not a confirmed backend contract yet.

import type { BookId, ContentFormat } from '../types/primitives';
import type { EncryptionDescriptor, SignedLicence } from './content-provider';

export interface ContentLicenceResponse {
  bookId: BookId;
  format: ContentFormat;
  mimeType: string; // e.g. "application/pdf", "application/epub+zip"

  // Download-only fields — not part of EncryptedPackage, needed before it can be constructed.
  encryptedFileUrl: string;
  checksum: string; // sha256 of the encrypted file, verified after download before store()

  // Reused verbatim from content-provider.ts. Both null => OA (open access, no encryption).
  encryption: EncryptionDescriptor | null;
  licence: SignedLicence | null;
}
