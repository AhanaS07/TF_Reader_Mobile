// Owner: Encryption (Abhinav).
//
// Portable UTF-8 codec — no `TextEncoder`/`TextDecoder`, which this codebase does not assume
// exists in the Hermes/RN JS runtime without on-device confirmation (see base64.ts's own
// `Buffer` history: two prior burns — aesGcm.ts and keyStorage.ts — from trusting a global that
// turned out absent on-device). This is that same lesson applied to the one remaining plain-ASCII
// codec in the tree: mockSearchIndex.ts's `asciiEncode`/`asciiDecode` threw above code point 0x7F
// (or, on decode, silently mojibaked UTF-8 bytes) because it was scoped to ASCII-only mock
// content. Real book text is not ASCII-only — a curly apostrophe or an accented name is enough to
// trip it — so anything decoding real extracted text needs a real codec, not a narrower one.
//
// Handles the full Unicode range, including surrogate-pair code points above U+FFFF (e.g. emoji):
// `utf8Encode` combines a high/low surrogate pair from the JS UTF-16 string into one code point
// before emitting its 4-byte UTF-8 sequence; `utf8Decode` does the reverse. Round-trips through
// `utf8Decode(utf8Encode(s)) === s` for every string tested in utf8.test.ts, including BMP
// characters above 0x7F and characters requiring surrogate pairs.

export function utf8Encode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length * 4); // worst case: every code point needs 4 bytes
  let out = 0;
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate. Pair it with the next unit if that's a matching low surrogate; otherwise
      // it's unpaired — ill-formed UTF-16 — and gets replaced with U+FFFD, same as Buffer/
      // TextEncoder do, rather than encoded as a "code point" that isn't a valid Unicode scalar
      // value (surrogate halves are explicitly excluded from valid UTF-8 by RFC 3629).
      const low = i + 1 < str.length ? str.charCodeAt(i + 1) : NaN;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // unpaired low surrogate — same substitution
    }
    if (code < 0x80) {
      bytes[out++] = code;
    } else if (code < 0x800) {
      bytes[out++] = 0xc0 | (code >> 6);
      bytes[out++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      bytes[out++] = 0xe0 | (code >> 12);
      bytes[out++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[out++] = 0x80 | (code & 0x3f);
    } else {
      bytes[out++] = 0xf0 | (code >> 18);
      bytes[out++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[out++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[out++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes.subarray(0, out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let code: number;
    let extraBytes: number;
    if (b0 < 0x80) {
      code = b0;
      extraBytes = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      extraBytes = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      extraBytes = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      extraBytes = 3;
    } else {
      throw new Error(`utf8Decode: invalid UTF-8 leading byte 0x${b0.toString(16)} at index ${i}`);
    }
    if (i + extraBytes >= bytes.length) {
      throw new Error(`utf8Decode: truncated UTF-8 sequence at index ${i}`);
    }
    for (let j = 1; j <= extraBytes; j++) {
      const cb = bytes[i + j];
      if ((cb & 0xc0) !== 0x80) {
        throw new Error(`utf8Decode: invalid UTF-8 continuation byte at index ${i + j}`);
      }
      code = (code << 6) | (cb & 0x3f);
    }
    i += extraBytes + 1;
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
