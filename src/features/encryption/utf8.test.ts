// Cross-checks utf8Encode/utf8Decode byte-for-byte against Node's own `Buffer` — the independent
// reference implementation, same convention as base64.test.ts. `Buffer` is fine to use HERE (Jest
// runs under Node) as the oracle being checked against; it is exactly what utf8.ts itself must
// never depend on at runtime.
//
// The motivating bug (see mockSearchIndex.ts's history): the ASCII-only codec this file replaces
// threw above code point 0x7F on encode and silently mojibaked on decode. Real book text — a
// curly apostrophe, an accented name, an em-dash — trips both failure modes. These cases are
// exercised explicitly below, not just via random fuzzing.

import { utf8Encode, utf8Decode } from './utf8';

// Excludes the surrogate block (0xd800-0xdfff): those are UTF-16 encoding artifacts, not valid
// Unicode scalar values, so `String.fromCodePoint` on one alone produces a lone surrogate — an
// ill-formed string no well-formed source (parsed EPUB/XML text, JSON) would ever contain. That
// case is real (Buffer/TextEncoder substitute U+FFFD for it) but is tested explicitly below, not
// via fuzzing, since fuzzing it would make round-trip equality assertions fail by definition (you
// cannot round-trip ill-formed UTF-16 through valid UTF-8).
function randomCodePoint(maxExclusive: number, minInclusive = 1): number {
  let cp: number;
  do {
    cp = minInclusive + Math.floor(Math.random() * (maxExclusive - minInclusive));
  } while (cp >= 0xd800 && cp <= 0xdfff);
  return cp;
}

function randomString(length: number, maxCodePoint: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCodePoint(randomCodePoint(maxCodePoint));
  }
  return out;
}

describe('utf8Encode — matches Node Buffer exactly', () => {
  it('pure ASCII', () => {
    const str = 'the quick brown fox jumps over the lazy dog';
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('the exact failure case from the original bug report: curly apostrophe + accented name', () => {
    const str = "Bernard’s café — a novella";
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('Latin-1 supplement (2-byte UTF-8): é, ñ, ü', () => {
    const str = 'café niño über';
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('general BMP above 0x800 (3-byte UTF-8): curly quotes, em-dash, currency signs', () => {
    const str = '“quoted” — €100 — ‘single’';
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('above-BMP code points requiring a UTF-16 surrogate pair (4-byte UTF-8): emoji', () => {
    const str = '📚 reading 😀 offline 🔒';
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('empty string encodes to an empty byte array', () => {
    expect(utf8Encode('')).toEqual(new Uint8Array(0));
  });

  it('matches Node Buffer for 200 random strings across the full code point range, including surrogate pairs', () => {
    for (let i = 0; i < 200; i++) {
      const str = randomString(20, 0x10ffff);
      expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
    }
  });

  it('substitutes U+FFFD for an unpaired high surrogate, matching Buffer', () => {
    const str = String.fromCharCode(0x41, 0xd800, 0x42); // 'A', lone high surrogate, 'B'
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });

  it('substitutes U+FFFD for an unpaired low surrogate, matching Buffer', () => {
    const str = String.fromCharCode(0x41, 0xdc00, 0x42); // 'A', lone low surrogate, 'B'
    expect(utf8Encode(str)).toEqual(new Uint8Array(Buffer.from(str, 'utf8')));
  });
});

describe('utf8Decode — matches Node Buffer exactly, and round-trips utf8Encode', () => {
  it('round-trips the exact failure case from the original bug report', () => {
    const str = "Bernard’s café — a novella";
    expect(utf8Decode(utf8Encode(str))).toBe(str);
  });

  it('round-trips emoji / above-BMP content', () => {
    const str = '📚 reading 😀 offline 🔒';
    expect(utf8Decode(utf8Encode(str))).toBe(str);
  });

  it('decodes Node-produced UTF-8 bytes back to the exact original string, for 200 random strings', () => {
    for (let i = 0; i < 200; i++) {
      const str = randomString(20, 0x10ffff);
      const bytes = new Uint8Array(Buffer.from(str, 'utf8'));
      expect(utf8Decode(bytes)).toBe(str);
    }
  });

  it('round-trips utf8Encode -> utf8Decode for 200 random strings', () => {
    for (let i = 0; i < 200; i++) {
      const str = randomString(20, 0x10ffff);
      expect(utf8Decode(utf8Encode(str))).toBe(str);
    }
  });

  it('empty input decodes to an empty string', () => {
    expect(utf8Decode(new Uint8Array(0))).toBe('');
  });

  it('rejects an invalid leading byte', () => {
    expect(() => utf8Decode(new Uint8Array([0xff]))).toThrow(/invalid UTF-8 leading byte/);
  });

  it('rejects a truncated multi-byte sequence', () => {
    expect(() => utf8Decode(new Uint8Array([0xe2, 0x82]))).toThrow(/truncated UTF-8 sequence/); // '€' missing its 3rd byte
  });

  it('rejects an invalid continuation byte', () => {
    expect(() => utf8Decode(new Uint8Array([0xc3, 0x00]))).toThrow(/invalid UTF-8 continuation byte/);
  });
});
