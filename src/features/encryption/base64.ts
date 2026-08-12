// Owner: Encryption (Abhinav).
//
// Portable base64 codec — no Node `Buffer`, which does not exist in the React Native JS
// runtime without a polyfill. Confirmed on-device 2026-08-11: keyStorage.ts's earlier
// `Buffer`-based version threw "Property 'Buffer' doesn't exist" at runtime in the actual app
// (not just theorized). This is the fix, shared by aesGcm.ts and keyStorage.ts.
//
// Cross-checked byte-for-byte against Node's own Buffer implementation for every length 0-300
// before being trusted here (bytesToBase64/base64ToBytes round trip and exact-match encoding).

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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
    const val = B64_CHARS.indexOf(clean[i]);
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
