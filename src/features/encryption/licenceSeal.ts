// Owner: Encryption (Abhinav).
//
// On-device tamper seal for a persisted LocalLicenceRecord — "Option C" from the B4 discussion in
// thisWeek.md / FAIL_CLOSED_AUDIT.md. B4 itself is now RULED ON (CONTRACT_ALIGNMENT.md, 2026-09-03):
// no wire contract signs a licence, and nobody is building one, so the type was renamed from
// `SignedLicence` and its `signature` field deleted rather than kept as an unverified placeholder
// (`licenceSignature.ts` and its RS256 stub are gone in the same change). This module is the
// replacement guarantee — a DIFFERENT one, see the ceiling below — not a stopgap for the old field.
//
// What this DOES do: `contentStore.ts`'s meta.json persists the licence as plain JSON, so anyone
// with file access to the device can hand-edit `expiresAt` with a text editor and nothing catches
// it. This module seals the licence with the SAME device-bound key already protecting the book's
// own content (the book's own BEK, already wrapped via the device keystore) — no new key type,
// no new keychain entry. contentStore.ts persists the seal alongside the plaintext licence and,
// at decrypt time, decrypts the seal and trusts THAT copy for the expiry check rather than
// whatever the plaintext `licence` fields say. Editing the plaintext without also producing a
// matching seal (which needs the device to unwrap the real BEK) no longer changes what gets
// enforced.
//
// CEILING, stated once rather than re-argued at each call site: the sealing key lives ON this
// device, wrapped in its own keystore. A sufficiently compromised device (root/jailbreak, able to
// invoke this app's own crypto calls) could still ask the app to re-seal a forged licence — the
// way it could not forge a real RS256 signature whose private key never left a server. This raises
// the bar past a plaintext-JSON edit; it is not the same guarantee Option A (a real server
// signature) would have been.

import type { LocalLicenceRecord } from '@/shared/contracts';
import { encrypt, decrypt } from './aesGcm';
import { utf8Encode, utf8Decode } from './utf8';
import { bytesToBase64, base64ToBytes } from './base64';

export interface SealedLicence {
  content: string; // base64 of nonce(12)||ciphertext||tag(16) over the canonical licence JSON
  originalLength: number;
}

/** Seal `licence` under `rawKey` (the book's own unwrapped BEK). Called once, at store() time,
 *  while the licence is still the untampered copy fresh off the network. */
export async function sealLicence(licence: LocalLicenceRecord, rawKey: Uint8Array): Promise<SealedLicence> {
  const payload = await encrypt(utf8Encode(JSON.stringify(licence)), rawKey);
  return { content: bytesToBase64(payload.content), originalLength: payload.originalLength };
}

/**
 * Decrypt `seal` under `rawKey` and return the licence it was sealed over — the TRUSTED copy,
 * not whatever a caller's own (possibly hand-edited) licence object says.
 *
 * Returns `null` on any failure: a bad GCM tag (wrong key, or content re-encrypted without the
 * real one), truncated/corrupt bytes, or JSON that doesn't parse are all treated identically —
 * "this seal doesn't vouch for anything" — fail closed rather than try to tell tamper apart from
 * disk corruption, which callers wouldn't act on any differently anyway.
 */
export async function openSealedLicence(seal: SealedLicence, rawKey: Uint8Array): Promise<LocalLicenceRecord | null> {
  try {
    const content = base64ToBytes(seal.content);
    const plaintext = await decrypt(
      { content, cipherLength: content.length, originalLength: seal.originalLength },
      rawKey
    );
    return JSON.parse(utf8Decode(plaintext)) as LocalLicenceRecord;
  } catch {
    return null;
  }
}
