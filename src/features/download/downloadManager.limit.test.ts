// Own file, deliberately: needs to start from a guaranteed-EMPTY downloads table (a fresh
// module registry per test file gives a fresh in-memory SQLite DB — see downloadManager.test.ts's
// isolation note). This is the regression test for the design decision to use downloadTable
// (counts across ALL books) instead of downloadRepository's single-fixed-BOOK_ID convenience
// methods — see docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md.

import * as crypto from 'crypto';
import { downloadBook, BOOK_LIMIT } from './downloadManager';
import { DownloadError } from './errors';
import { getDatabase } from '../sync/localDb/database';
import type { ContentLicenceResponse } from '@/shared/contracts';

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function openAccessLicenceFor(bookId: string, content: Uint8Array): ContentLicenceResponse {
  return {
    bookId,
    format: 'EPUB',
    mimeType: 'application/epub+zip',
    encryptedFileUrl: `http://localhost:4000/fixtures/${bookId}.epub`,
    checksum: sha256Hex(content),
    encryption: null,
    licence: null,
  };
}

// Uint8Array<ArrayBuffer>, not the bare (ArrayBufferLike-generic) `Uint8Array`: TS 6's DOM lib
// types Response's BodyInit/BufferSource as the ArrayBuffer-specific variant, and every caller
// here passes a `new Uint8Array([...])` literal, which infers as exactly this type already.
function mockFetchFor(licence: ContentLicenceResponse, content: Uint8Array<ArrayBuffer>) {
  return jest.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/content-licence')) {
      return new Response(JSON.stringify(licence), { status: 200 });
    }
    if (url === licence.encryptedFileUrl) {
      return new Response(content, { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}

describe('downloadBook — 5-book limit, across DIFFERENT book IDs, starting from an empty table', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Jest resets the module registry (and therefore getDatabase()'s in-memory SQLite instance)
  // once PER TEST FILE, not per `it` — see this file's own header comment. That guarantees the
  // FIRST test below starts empty, but without this, the SECOND test would inherit the first
  // test's 5 rows and hit BOOK_LIMIT_REACHED on its very first (brand-new) bookId, never getting
  // to exercise what it's actually testing. Same pattern as
  // sync/repositories/otherRepositories.test.ts's beforeEach.
  beforeEach(async () => {
    const db = await getDatabase();
    await db.execAsync('DELETE FROM downloads; DELETE FROM outbox;');
  });

  it(`allows exactly ${BOOK_LIMIT} distinct books, then rejects the ${BOOK_LIMIT + 1}th with BOOK_LIMIT_REACHED`, async () => {
    for (let i = 0; i < BOOK_LIMIT; i++) {
      const bookId = `limit-test-book-${i}`;
      const content = new Uint8Array([i, i + 1, i + 2]);
      const licence = openAccessLicenceFor(bookId, content);
      global.fetch = mockFetchFor(licence, content);
      await downloadBook(bookId); // must not throw — this is well within the limit
    }

    const overLimitBookId = `limit-test-book-${BOOK_LIMIT}`;
    const overLimitContent = new Uint8Array([99]);
    global.fetch = mockFetchFor(openAccessLicenceFor(overLimitBookId, overLimitContent), overLimitContent);

    await expect(downloadBook(overLimitBookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_LIMIT_REACHED,
      bookId: overLimitBookId,
    });
  });

  it('re-downloading an ALREADY-downloaded book does not count against the limit a second time', async () => {
    for (let i = 0; i < BOOK_LIMIT; i++) {
      const bookId = `limit-recount-book-${i}`;
      const content = new Uint8Array([i]);
      const licence = openAccessLicenceFor(bookId, content);
      global.fetch = mockFetchFor(licence, content);
      await downloadBook(bookId);
    }

    // Re-downloading the FIRST of those books again must succeed (update, not a 6th row) even
    // though the table is already AT the limit.
    const bookId = 'limit-recount-book-0';
    const content = new Uint8Array([0]);
    global.fetch = mockFetchFor(openAccessLicenceFor(bookId, content), content);

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
  });
});
