// Owner: Encryption (Abhinav).
//
// Produces a whole-file AES-256-GCM encrypted sample "book" under `samples/`, using the real
// production `encrypt`/`decrypt` from ../aesGcm (not a duplicate implementation) — then
// round-trip decrypts it back and verifies the result, so this script is itself a test, not
// just a generator.
//
// Confirmed against Ahana's canonical content-provider.ts and the earlier "whole-file decrypt"
// amendment: ONE nonce/tag for the entire book, no per-chapter chunking, no manifest needed.
//
// Run: npx tsx src/features/encryption/scripts/generateSampleBook.ts
// (tsx, not ts-node — this repo's toolchain doesn't have ts-node; tsx is used the same way it
// was for the aesGcm/cipherLayout verification scripts earlier this session.)
//
// Never use a fixed key like the one below outside mock/dev tooling — same rule as
// mock-backend/fixtures/genFixtures.js's testBEK, just tracked in git instead of gitignored,
// since `samples/` is meant to be a shared, committed fixture per the repo README.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { encrypt, decrypt } from '../aesGcm';
import { assertCipherLayout } from '../cipherLayout';

const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', '..', 'samples');

// Fixed, clearly-fake 32-byte test key (all-zero-derived, not random) — deliberately
// unambiguous that this is not a real secret.
const TEST_KEY = Buffer.alloc(32, 0x42); // 32 bytes of 0x42, not random — a real BEK must be.

const SAMPLE_BOOK_TEXT = Buffer.from(
  Array.from(
    { length: 40 },
    (_, i) =>
      `Chapter placeholder line ${i + 1}. This is representative plaintext standing in for a ` +
      `whole book body under the whole-file AES-256-GCM design — one nonce/tag for the entire ` +
      `file, no per-chapter chunking, no manifest. Not a real EPUB/PDF container structure.\n`
  ).join(''),
  'utf8'
);

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = encrypt(new Uint8Array(SAMPLE_BOOK_TEXT), TEST_KEY);
  assertCipherLayout(payload); // structural self-check before writing anything

  const outPath = path.join(OUTPUT_DIR, 'sample-book.epub.enc');
  fs.writeFileSync(outPath, Buffer.from(payload.content));

  const meta = {
    key: TEST_KEY.toString('base64'),
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    checksum: crypto.createHash('sha256').update(payload.content).digest('hex'),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'sample-book.meta.json'), JSON.stringify(meta, null, 2));

  console.log('Wrote', outPath, `(${payload.content.length} bytes)`);
  console.log('Meta:', meta);

  // Self-test: decrypt what we just wrote, from disk, independently of the in-memory payload
  // object above — this exercises the actual on-disk artifact, not just the JS object.
  const rereadContent = new Uint8Array(fs.readFileSync(outPath));
  const decrypted = decrypt(
    { content: rereadContent, cipherLength: meta.cipherLength, originalLength: meta.originalLength },
    TEST_KEY
  );

  if (Buffer.compare(Buffer.from(decrypted), SAMPLE_BOOK_TEXT) !== 0) {
    throw new Error('SELF-TEST FAILED: decrypted content does not match original plaintext');
  }
  console.log('Self-test PASSED: round-trip decrypt of the on-disk file matches the original plaintext.');

  // Tamper check, same spirit as Phase 1 item 4 — corrupt one byte and confirm it's caught.
  // Two separate try/catches so "did not throw" (a failure) can't be swallowed by the same
  // catch that's supposed to report the expected-throw success case.
  const corrupted = new Uint8Array(rereadContent);
  corrupted[20] ^= 0xff;
  let decryptOfCorruptedThrew = false;
  try {
    decrypt({ content: corrupted, cipherLength: meta.cipherLength, originalLength: meta.originalLength }, TEST_KEY);
  } catch {
    decryptOfCorruptedThrew = true;
  }
  if (!decryptOfCorruptedThrew) {
    throw new Error('SELF-TEST FAILED: corrupted content did not throw on decrypt');
  }
  console.log('Self-test PASSED: corrupting one byte correctly fails the GCM auth-tag check.');
}

main();
