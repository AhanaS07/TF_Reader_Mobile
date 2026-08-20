// Owner: Encryption (Abhinav).
//
// Whole-file decrypt (2026-08-11 amendment — see BuildPlan.md "Amendment: whole-file
// decrypt"): a book (text or audio) is encrypted as ONE AES-GCM payload — one nonce, one
// ciphertext, one tag for the entire file. There is no per-chapter chunk map anymore.
//
// A type checker can guarantee `content`, `cipherLength`, and `originalLength` all exist on a
// CipherPayload. It cannot guarantee they agree with each other. A corrupted metadata record
// (e.g. a wrong length written during the download step) would still satisfy the type and
// reach decrypt as garbage. assertCipherLayout is what actually catches that, so it must run
// before the payload is handed to decrypt — not just at the type boundary.

export interface CipherPayload {
  content: Uint8Array; // full encoded bytes: nonce (12B) + ciphertext + GCM tag (16B)
  cipherLength: number; // recorded length of `content`, stored alongside download metadata
  originalLength: number; // plaintext length before encryption
}

export const NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

export function assertCipherLayout(payload: CipherPayload): void {
  const { content, cipherLength, originalLength } = payload;
  const expected = NONCE_BYTES + originalLength + GCM_TAG_BYTES;

  if (content.length !== cipherLength || cipherLength !== expected) {
    throw new Error(
      `Cipher layout mismatch: content.length=${content.length}, cipherLength=${cipherLength}, ` +
        `expected 12 + originalLength(${originalLength}) + 16 = ${expected}`,
    );
  }
}
