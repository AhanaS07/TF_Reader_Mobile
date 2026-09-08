// Owner: Reader (Ahana).
//
// Stage 1 of the 20 MB whole-book verification: does the DECRYPT half survive a real book, and
// what does each hop cost? This is the cheapest check that can reveal "this doesn't work at all",
// so it runs before any device work and before a 20 MB fixture exists.
//
// WHY THIS TESTS THE SEAM AND NOT getBookBase64(): that function calls ensureSeeded(), which pulls
// expo-asset and `require('*.epub')`. Under Jest the require resolves through moduleNameMapper to
// jest.assetStub.js (which exports the number 1), and Asset.fromModule cannot survive that. So this
// exercises the same hops in the same order — store -> getBook -> bytesToBase64 — reached directly.
//
// THE NUMBERS HERE ARE A LOWER BOUND, NOT A MEASUREMENT. Jest runs on V8; the app runs Hermes, and
// there is no hermes VM binary in the repo to run this under (ios/Pods/hermes-engine/destroot/bin/
// ships only hermesc and hermes-lit). Hermes byte-loop cost is measurable only on device. Treat
// this table as "the shape of the cost and the floor of its size".
//
// Mocking is inherited, not declared: real AES-256-GCM (Node crypto) via
// __mocks__/react-native-aes-gcm-crypto.js, real file I/O (Node fs, temp dir) via
// __mocks__/expo-file-system.js, in-memory keychain via __mocks__/react-native-keychain.js. Same
// setup as contentStore.test.ts — no jest.mock() calls needed.

import * as crypto from 'crypto';

import { bytesToBase64 } from '@/features/encryption/base64';
import { encrypt } from '@/features/encryption/aesGcm';
import { getBook } from '@/features/encryption/contentProvider';
import { contentStore, MAX_DECRYPTED_BYTES } from '@/features/encryption/contentStore';
import { storeBek } from '@/features/encryption/keyStorage';
import { ContentError } from '@/shared/contracts';
import type { EncryptedPackage, LocalLicenceRecord } from '@/shared/contracts';

// THIRD COPY of these builders. The other two are contentStore.test.ts:29-89 and
// contentStore.edgecases.test.ts:32-95. They are duplicated rather than shared because importing
// from a .test.ts would execute that file's describe blocks. Extracting them to src/shared/testing/
// (Reader-owned) is the right fix and is deliberately left as a follow-up rather than smuggled into
// a measurement change.
function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function licenceFor(bookId: string): LocalLicenceRecord {
  return {
    licenceId: `lic-${bookId}`,
    itemId: bookId,
    keyFingerprint: 'sha256:test-fingerprint',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    canPersist: true,
    rights: { print: false },
  };
}

async function buildEncryptedPackage(
  bookId: string,
  plaintext: Uint8Array,
  key: Uint8Array
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  return {
    bookId,
    format: 'EPUB',
    content: payload.content,
    encryption: {
      algorithm: 'AES-256-GCM',
      layout: 'nonce(12) || ciphertext || tag(16)',
      wrappedBek: 'not-a-real-wrap-in-this-test',
      wrapAlgorithm: 'RSA-OAEP-256',
      keyId: 'master-v1',
      keyFingerprint: 'sha256:test-fingerprint',
    },
    licence: licenceFor(bookId),
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
  };
}

const MB = 1024 * 1024;
const SIZES_MB = [1, 5, 10, 20, 24];

interface Row {
  mb: number;
  encryptMs: number;
  storeMs: number;
  getBookMs: number;
  base64Ms: number;
  b64Chars: number;
}

const rows: Row[] = [];

describe('Stage 1: whole-book RAM budget and per-hop cost', () => {
  // it.each keeps each size an independent test so one failure names its own size rather than
  // collapsing the whole sweep into a single red.
  it.each(SIZES_MB)(
    'a %i MB book round-trips through store -> getBook -> bytesToBase64',
    async (mb) => {
      // Distinct bookId per case: contentStore's module-level `sessions` and `packageCache` maps are
      // never reset between tests (contentStore.edgecases.test.ts:354-357 warns about exactly this).
      const bookId = `budget-probe-${mb}mb`;
      const size = mb * MB;
      const key = randomKey();
      const plaintext = plaintextOf(size, `budget probe ${mb}MB`);

      try {
        const tEncrypt = Date.now();
        const pkg = await buildEncryptedPackage(bookId, plaintext, key);
        const encryptMs = Date.now() - tEncrypt;

        // Pre-seed the raw BEK: resolveRawKey() prefers the keychain cache over unwrapping
        // wrappedBek, which is a placeholder here. This is the same fast path a second open of a
        // real book takes, and it keeps RSA out of the timings.
        await storeBek(bookId, key);

        const tStore = Date.now();
        await contentStore.store(pkg);
        const storeMs = Date.now() - tStore;

        const tGetBook = Date.now();
        const bytes = await getBook(bookId);
        const getBookMs = Date.now() - tGetBook;

        const tBase64 = Date.now();
        const base64 = bytesToBase64(bytes);
        const base64Ms = Date.now() - tBase64;

        rows.push({ mb, encryptMs, storeMs, getBookMs, base64Ms, b64Chars: base64.length });

        // Structural assertions only — timings are reported, never asserted on. A wall-clock
        // threshold here would be a flaky test that fails on a loaded CI box and tells us nothing
        // about Hermes anyway.
        expect(bytes.length).toBe(size);
        expect(Buffer.from(bytes).equals(Buffer.from(plaintext))).toBe(true);
        expect(base64.length).toBe(Math.ceil(size / 3) * 4);
      } finally {
        // destroy(), not close(): close() zeroes the plaintext but leaves the ciphertext in the
        // module-level packageCache, so a five-size sweep would retain every ciphertext at once and
        // could OOM the Jest worker on the largest cases. That retention is itself a finding for
        // Stage 7 — here it just has to be worked around to keep the sweep bounded.
        await contentStore.destroy(bookId);
      }
    },
    180_000
  );

  it('a book one byte over MAX_DECRYPTED_BYTES is refused at store(), before it is ever persisted', async () => {
    // Was: store() accepted it and only getBook() refused it afterward — the write/read asymmetry
    // AUDIO_MEMORY_REPORT.md measured against a real 150MB audio package (accepted on disk,
    // isAvailableOffline() === true, then a permanent decrypt failure on every read). store() now
    // enforces the same budget the read path always has, so this fails at write time instead —
    // nothing is ever persisted for getBook() to reject afterward.
    const bookId = 'budget-probe-over-cap';
    const key = randomKey();
    const plaintext = plaintextOf(MAX_DECRYPTED_BYTES + 1, 'one byte over the cap');

    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await expect(contentStore.store(pkg)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  }, 180_000);

  afterAll(() => {
    if (rows.length === 0) return;

    const header = ['MB', 'encrypt', 'store', 'getBook', 'base64', 'b64 chars'];
    const table = rows.map((r) => [
      String(r.mb),
      `${r.encryptMs}ms`,
      `${r.storeMs}ms`,
      `${r.getBookMs}ms`,
      `${r.base64Ms}ms`,
      r.b64Chars.toLocaleString('en-US'),
    ]);

    const widths = header.map((h, i) =>
      Math.max(h.length, ...table.map((row) => row[i].length))
    );
    const line = (cells: string[]): string =>
      cells.map((c, i) => c.padStart(widths[i])).join('  ');

    // This test exists to report numbers; the table IS the deliverable that goes to Encryption
    // (Abhinav) for the aesGcm.ts double-base64 hop. No eslint-disable needed — `no-console` is not
    // enabled in this config, and adding a directive for it fails --max-warnings=0 as unused.
    console.log(
      [
        '',
        '[STAGE1] whole-book decrypt cost (V8/Jest — a LOWER BOUND for Hermes on device)',
        '  getBook = base64-encode(ciphertext) + native AES-GCM + base64-decode(plaintext)',
        '  base64  = the SECOND encode, for the WebView transport (readerAssets.ts:83)',
        '',
        line(header),
        line(widths.map((w) => '-'.repeat(w))),
        ...table.map(line),
        '',
      ].join('\n')
    );
  });
});
