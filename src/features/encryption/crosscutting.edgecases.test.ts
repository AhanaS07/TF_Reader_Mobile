// Cross-file adversarial pass over the whole encryption module (aesGcm.ts, cipherLayout.ts,
// keyStorage.ts, deviceKeypair.ts, contentStore.ts, contentProvider.ts, base64.ts), looking
// specifically for places where one file's assumption about another file's guarantee doesn't
// actually hold at runtime — NOT re-testing what contentStore.test.ts / contentStore.edgecases.ts
// / deviceKeypair.*.test.ts already cover (unwrapBek stub, BEK length checks, close()-races-
// decryptBook, licence.signature not verified, metadata JSON syntax corruption — all already
// documented in docs/build-status.md).
//
// FOUND AND FIXED, 2026-08-12: two real bugs in contentStore.ts, both regression-tested below.
//
// (1) Open-access content wasn't re-validated against recorded lengths on a cold read.
// contentStore.ts's length/integrity invariant (`assertLengthInvariant`, and — for encrypted
// packages only — aesGcm.ts's `assertCipherLayout`) was enforced at store()-time and again at
// decrypt-time FOR ENCRYPTED PACKAGES (assertCipherLayout runs inside aesGcm.decrypt(), which
// contentStore.decryptBook() always calls for `pkg.encryption !== null`). For OPEN-ACCESS packages
// (`pkg.encryption === null` — audio, or open-access text), decryptBook() just did
// `plaintext = new Uint8Array(pkg.content)` — nothing re-validated that `pkg.content.length` still
// matched the `cipherLength`/`originalLength` recorded in the persisted meta.json. A book stored
// correctly, then corrupted/truncated/extended on disk before the NEXT cold read (loadPersisted(),
// reached whenever packageCache has no in-memory entry — the normal "app was closed and reopened"
// path), would decrypt "successfully" with silently wrong-length content instead of rejecting.
// Fixed by calling `assertLengthInvariant(pkg)` at the top of decryptBook()'s `run()`, covering
// both paths uniformly instead of relying on the encrypted-only assertCipherLayout check.
//
// (2) openSession() unconditionally read the whole file into RAM before MAX_DECRYPTED_BYTES was
// ever checked. See the second describe block below for detail. Fixed by checking
// `parsed.originalLength` against the budget inside loadPersisted(), using the already-read small
// meta.json, BEFORE reading the (potentially huge) content file's bytes at all.

import { File, Directory, Paths } from 'expo-file-system';
import { contentStore, MAX_DECRYPTED_BYTES } from './contentStore';
import { ContentFailure } from '@/shared/contracts';

// Mirrors contentStore.ts's own private path scheme (STORE_DIR / contentFile / metaFile) exactly,
// so this test can plant a persisted package directly on disk WITHOUT going through store() —
// store() would re-run assertLengthInvariant and reject the very mismatch we're deliberately
// creating. Writing the files directly simulates the realistic case: the package was written
// correctly by a past, valid store() call, and something (disk error, manual tamper, partial
// write) truncated content.bin afterwards, before this session's first cold read.
const STORE_DIR = new Directory(Paths.document, 'tf-reader-content');
function contentFilePath(bookId: string): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.content.bin`);
}
function metaFilePath(bookId: string): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.meta.json`);
}

function writeRaw(file: File, content: string | Uint8Array): void {
  if (!file.parentDirectory.exists) {
    file.parentDirectory.create({ intermediates: true });
  }
  if (file.exists) file.delete();
  file.create();
  file.write(content);
}

describe('FIXED: open-access content is re-validated against recorded lengths on a cold read', () => {
  it('rejects ContentFailure for a truncated on-disk content.bin instead of decrypting wrong-length data', async () => {
    const bookId = 'crosscut-oa-truncated-1';
    const fullLength = 1000;
    const truncatedLength = 400; // simulates a partial write / disk corruption after store()

    const truncatedContent = new Uint8Array(truncatedLength).fill(7);

    // Plant a persisted package directly: meta.json says the book is `fullLength` bytes (as a
    // correct store() call would have recorded), but the actual content.bin on disk is shorter.
    // No in-memory packageCache entry exists for this bookId (we never called contentStore.store()
    // in this process for it), so contentStore.openSession() below is FORCED through the
    // loadPersisted() disk-read path — exactly the "app cold start" scenario this bug lives in.
    writeRaw(contentFilePath(bookId), truncatedContent);
    writeRaw(
      metaFilePath(bookId),
      JSON.stringify({
        bookId,
        format: 'AUDIO',
        encryption: null,
        licence: null,
        cipherLength: fullLength,
        originalLength: fullLength,
        mimeType: 'audio/mpeg',
        hasIndex: false,
      })
    );

    await contentStore.openSession(bookId);

    // Fail-closed: a book whose on-disk content no longer matches its recorded length is
    // corrupted and must be rejected, the same way tampered ciphertext is for encrypted packages
    // (see contentStore.test.ts's "rejects with ContentFailure(INTEGRITY_FAILED) when the
    // ciphertext is tampered"). Before the fix this resolved with the truncated 400-byte buffer,
    // silently, no error at all.
    await expect(contentStore.decryptBook(bookId)).rejects.toBeInstanceOf(ContentFailure);
  });
});

describe('FIXED: openSession() checks MAX_DECRYPTED_BYTES before reading the whole file into RAM', () => {
  // contentStore.ts's file header claims "MAX_DECRYPTED_BYTES is a hard, enforced cap (checked
  // before AND after decrypt)". Before this fix, the only check was inside decryptBook()'s run(),
  // comparing pkg.originalLength / plaintext.length against the cap — openSession() (via
  // resolvePackage -> loadPersisted) called `contentFile(bookId).bytesSync()` UNCONDITIONALLY,
  // reading the entire on-disk file into a Uint8Array with no size guard at all, before
  // decryptBook() (and its budget check) was ever invoked. So for any book loaded from disk (the
  // normal cold-start path), the full, potentially-oversized allocation already happened by the
  // time openSession() resolved, regardless of whether the caller ever called decryptBook() at
  // all. Fixed by checking `parsed.originalLength` (from the small meta.json read) against the
  // budget inside loadPersisted(), before ever reading the content file's bytes.
  it('openSession() rejects for a book whose on-disk content already exceeds MAX_DECRYPTED_BYTES, before reading its bytes', async () => {
    const bookId = 'crosscut-oa-oversized-1';
    const oversizedLength = MAX_DECRYPTED_BYTES + 1024;
    const oversizedContent = new Uint8Array(oversizedLength).fill(3);

    // Planted directly on disk (not via contentStore.store()) — self-consistent lengths, so this
    // isn't the length-invariant bug above; this is a genuinely oversized, internally-honest
    // package that just happens to be over budget, landing on disk the same way a corrupted
    // download or a tampered metadata/content pair could.
    writeRaw(contentFilePath(bookId), oversizedContent);
    writeRaw(
      metaFilePath(bookId),
      JSON.stringify({
        bookId,
        format: 'AUDIO',
        encryption: null,
        licence: null,
        cipherLength: oversizedLength,
        originalLength: oversizedLength,
        mimeType: 'audio/mpeg',
        hasIndex: false,
      })
    );

    // Per contentStore.ts's own "hard, enforced cap" claim: a book this large must never get
    // this far. Before the fix, openSession() happily resolved, proving it had already read the
    // full oversized file into RAM with zero budget guard.
    await expect(contentStore.openSession(bookId)).rejects.toBeInstanceOf(ContentFailure);
  }, 30_000);
});
