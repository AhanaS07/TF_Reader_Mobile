// Owner: Encryption (Abhinav).
//
// Licence signature verification seam — RS256, matching `SignedLicence.signature.alg`
// (content-provider.ts).
//
// STUBBED TODAY: always returns `true`. Real verification is blocked on two items:
//   - B4: neither published contract (wokay / flambeau) carries a signed-licence
//     artifact or specifies an RS256 verification algorithm. The `signature` field
//     on `SignedLicence` is synthesized client-side (`downloadManager.ts`) and
//     contentStore.ts never verifies it (pre-existing, documented gap — see its
//     file header).
//   - C7: the `keyFingerprint` digest recipe is a guess (CONTRACT_ALIGNMENT.md),
//     and the check now fails closed, so a wrong guess rejects every encrypted
//     download.
//
// When either item is resolved, flip this to real RS256 verification. The seam is
// wired into both the online path (`licenseCheck.ts`) and the offline fallback
// (`contentStore.getPersistedLicenceStatus` consumers), so flipping here reaches all
// call sites with no further wiring.

import type { SignedLicence } from '@/shared/contracts';

/**
 * Verify the RS256 signature on a `SignedLicence`. Always returns `true` today —
 * the stub exists so every call site is wired for fail-closed behaviour once real
 * verification lands, without needing a redesign.
 *
 * Called by `licenseCheck.ts` (online success + offline fallback) before any
 * content is fetched or decrypted.
 */
export function verifyLicenceSignature(_licence: SignedLicence): boolean {
  // TODO: real RS256 verify once B4/C7 are resolved — see file header.
  return true;
}
