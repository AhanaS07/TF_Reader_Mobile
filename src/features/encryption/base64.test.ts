// Cross-checks bytesToBase64/base64ToBytes byte-for-byte against Node's own `Buffer` — the
// verification base64.ts's own header has always claimed ("cross-checked... for every length
// 0-300 before being trusted here") but which, until now, lived only in that comment, not in a
// committed test. `Buffer` is fine to use HERE (Jest runs under Node, this file never ships to
// the RN runtime) as the independent reference implementation being checked against — it is
// exactly what base64.ts itself must never depend on at runtime (see its own header).

import { bytesToBase64, base64ToBytes } from './base64';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// Jest's `toEqual`/`toHaveProperty`-style matchers walk large typed arrays through generic,
// per-element deep-equality machinery that is NOT optimized for this — on a 5MB Uint8Array that
// costs low tens of SECONDS of matcher overhead alone, dwarfing (and completely hiding) the
// actual function-under-test's own runtime, which is milliseconds (confirmed by benchmarking
// bytesToBase64/base64ToBytes in isolation, outside Jest, during this fix). A raw loop is the
// correct tool for comparing large typed arrays in a test; `toEqual` stays for the small (0-300
// byte) cases below, where its overhead is negligible.
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`byte mismatch at index ${i}: expected ${expected[i]}, got ${actual[i]}`);
    }
  }
}

describe('bytesToBase64 — matches Node Buffer exactly', () => {
  it('every length 0..300 (the range the file header has always claimed)', () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytes(length);
      const expected = Buffer.from(bytes).toString('base64');
      expect(bytesToBase64(bytes)).toBe(expected);
    }
  });

  it('an empty input encodes to an empty string', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('a large payload (5MB) — the actual size class a real book decrypt hits', () => {
    const bytes = randomBytes(5 * 1024 * 1024);
    const expected = Buffer.from(bytes).toString('base64');
    expect(bytesToBase64(bytes)).toBe(expected);
  });

});

describe('base64ToBytes — matches Node Buffer exactly, and round-trips bytesToBase64', () => {
  it('every length 0..300, decoding Node-produced base64', () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytes(length);
      const encoded = Buffer.from(bytes).toString('base64');
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
  });

  it('round-trips bytesToBase64 -> base64ToBytes for every length 0..300', () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytes(length);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips a large payload (5MB)', () => {
    const bytes = randomBytes(5 * 1024 * 1024);
    expectBytesEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });

  it('rejects a character outside the base64 alphabet', () => {
    expect(() => base64ToBytes('abc$')).toThrow(/invalid character/);
  });

  it('handles 0, 1, and 2 trailing "=" padding characters', () => {
    // 3 raw bytes -> no padding; 2 raw bytes -> one "="; 1 raw byte -> two "=".
    expect(base64ToBytes(bytesToBase64(randomBytes(3)))).toHaveLength(3);
    expect(base64ToBytes(bytesToBase64(randomBytes(2)))).toHaveLength(2);
    expect(base64ToBytes(bytesToBase64(randomBytes(1)))).toHaveLength(1);
  });
});
