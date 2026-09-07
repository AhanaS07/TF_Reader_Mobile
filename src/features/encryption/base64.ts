// Owner: Encryption (Abhinav).
//
// Portable base64 codec — no Node `Buffer`, which does not exist in the React Native JS
// runtime without a polyfill. Confirmed on-device 2026-08-11: keyStorage.ts's earlier
// `Buffer`-based version threw "Property 'Buffer' doesn't exist" at runtime in the actual app
// (not just theorized). This is the fix, shared by aesGcm.ts, keyStorage.ts, deviceKeypair.ts,
// and (via readerAssets.ts) the Reader's WebView bridge.
//
// PERFORMANCE, not just correctness (2026-08-13): this is a genuine hot path, not an edge case.
// aesGcm.ts's encrypt/decrypt round-trip a FULL book (up to contentStore.ts's 25MB budget)
// through bytesToBase64/base64ToBytes on every call — the native crypto module's bridge takes
// base64 strings, not raw bytes, so a single decrypt already means ciphertext-in and
// plaintext-out each cross that bridge as base64 — and readerAssets.ts base64-encodes the
// decrypted book a THIRD time for the WebView bridge.
//
// The original decode scanned the 64-character alphabet with `String.indexOf` for every input
// character — O(64n) character comparisons for an n-byte payload. Fixed below with an O(1)
// lookup table. MEASURED ON-DEVICE (not just Node), real Hermes, iPhone 17 simulator + Pixel
// 8 Pro emulator, 20MB round-trip: decode went from ~3.0s to ~1.7-2.2s. A real, verified win.
//
// The original encode built its output by repeated string concatenation (`result += ...`).
// This LOOKS like the same class of problem as decode's indexOf scan, and was rewritten the same
// way once (fill a typed array by index, then join in chunks) — but on-device measurement
// (same two devices, same 20MB payload) showed that version was SLOWER than the original `+=`
// loop on both: iOS 1.9-2.0s (original) vs 2.8s (chunked-rewrite); Android 1.7-1.8s (original)
// vs 2.4s (chunked-rewrite). A second alternative (array-of-chars + single `.join('')`, no
// chunking) didn't beat the original either. Conclusion, from measurement rather than
// assumption: Hermes's `+=` on strings is already fine for this workload, and encode is
// deliberately left AS THE ORIGINAL ALGORITHM below — do not "optimize" this again without a
// fresh on-device (not Node-only) measurement to justify it. Node/V8 numbers are not a reliable
// proxy for Hermes here; the two engines disagreed about which version was faster.

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse lookup: base64 character CODE -> its 6-bit value, or -1 if the code isn't in the
// alphabet. Replaces decode's old `B64_CHARS.indexOf(char)` scan (O(64) per character) with an
// O(1) array index. Sized to the ASCII range — every valid base64 character is ASCII, so
// anything else is rejected by the `code < 128` guard below before this is even indexed.
const REVERSE = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  REVERSE[B64_CHARS.charCodeAt(i)] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    result += B64_CHARS[(triplet >> 18) & 0x3f];
    result += B64_CHARS[(triplet >> 12) & 0x3f];
    result += b1 === undefined ? '=' : B64_CHARS[(triplet >> 6) & 0x3f];
    result += b2 === undefined ? '=' : B64_CHARS[triplet & 0x3f];
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIdx = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const val = code < 128 ? REVERSE[code] : -1;
    if (val === -1) throw new Error(`base64ToBytes: invalid character "${clean[i]}"`);
    bitBuffer = (bitBuffer << 6) | val;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIdx++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return bytes;
}
