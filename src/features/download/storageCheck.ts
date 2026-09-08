// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 3 step 1 / Phase 4: a storage-space gate before downloading. MIN_FREE_BYTES
// is a GENERIC floor, not the real book's size — ContentLicenceResponse (content-licence.ts) has
// no size field, so the exact byte count is only known AFTER the encrypted asset is fetched, too
// late to gate on. 100MB is comfortably above contentStore.ts's own 25MB whole-book RAM budget
// (MAX_DECRYPTED_BYTES), leaving headroom for the ciphertext (slightly larger than plaintext,
// nonce+tag overhead) plus whatever else already lives on the device.

import { Paths } from 'expo-file-system';

export const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100MB

export function checkAvailableStorage(minBytes: number = MIN_FREE_BYTES): boolean {
  return Paths.availableDiskSpace >= minBytes;
}
