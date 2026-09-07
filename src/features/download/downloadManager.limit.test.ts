// Own file, deliberately: needs to start from a guaranteed-EMPTY downloads table (a fresh
// module registry per test file gives a fresh in-memory SQLite DB — see downloadManager.test.ts's
// isolation note). This is the regression test for the design decision to use downloadTable
// (counts across ALL books) instead of downloadRepository's single-fixed-BOOK_ID convenience
// methods — see docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md.
//
// REAL FLAMBEAU CONTRACT (2026-08-14): mocks the same three endpoints
// downloadManager.test.ts does (loans, reading-sessions, asset) — see that file's header and
// readingSessionClient.ts for the shapes being mocked here.

import { downloadBook, BOOK_LIMIT } from './downloadManager';
import { DownloadError } from './errors';
import { getDatabase } from '../sync/localDb/database';
import { USER_ID } from '../sync/syncConfig';
import { API_BASE_URL } from './config';
import type { Loan, ReadingSessionResponse } from '@/shared/contracts';

// See downloadManager.test.ts's identical mock for why this exists (2026-08-31 downloads-
// CODE_TAKEN fix): every test here is a fresh, first-time download, so "no existing record" is
// the correct default.
jest.mock('@/features/sync/syncApi', () => ({
  api: {
    list: jest.fn().mockResolvedValue({ data: [], serverTime: '' }),
    restore: jest.fn().mockResolvedValue({ data: {}, serverTime: '' }),
  },
}));

function openAccessLoanFor(bookId: string): Loan {
  return {
    loanId: `loan-${bookId}`,
    itemId: bookId,
    userId: USER_ID,
    licenceModel: 'OPEN_ACCESS',
    status: 'ACTIVE',
    borrowedAt: new Date().toISOString(),
    canPersist: true,
    serverTime: new Date().toISOString(),
  };
}

function sessionFor(bookId: string, content: Uint8Array): ReadingSessionResponse {
  return {
    sessionId: `session-${bookId}`,
    itemId: bookId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverTime: new Date().toISOString(),
    content: {
      url: `http://localhost:4000/fixtures/${bookId}.epub`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      cipherLength: content.length,
      originalLength: content.length,
      mimeType: 'application/epub+zip',
    },
  };
}

function mockFetchFor(loan: Loan, session: ReadingSessionResponse, content: Uint8Array<ArrayBuffer>) {
  return jest.fn().mockImplementation(async (url: string) => {
    if (url === `${API_BASE_URL}/api/v1/loans`) {
      return new Response(JSON.stringify(loan), { status: 200 });
    }
    if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
      return new Response(JSON.stringify(session), { status: 200 });
    }
    if (url === session.content.url) {
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
      const loan = openAccessLoanFor(bookId);
      const session = sessionFor(bookId, content);
      global.fetch = mockFetchFor(loan, session, content);
      await downloadBook(bookId); // must not throw — this is well within the limit
    }

    const overLimitBookId = `limit-test-book-${BOOK_LIMIT}`;
    const overLimitContent = new Uint8Array([99]);
    global.fetch = mockFetchFor(
      openAccessLoanFor(overLimitBookId),
      sessionFor(overLimitBookId, overLimitContent),
      overLimitContent,
    );

    await expect(downloadBook(overLimitBookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_LIMIT_REACHED,
      bookId: overLimitBookId,
    });
  });

  it('re-downloading an ALREADY-downloaded book does not count against the limit a second time', async () => {
    for (let i = 0; i < BOOK_LIMIT; i++) {
      const bookId = `limit-recount-book-${i}`;
      const content = new Uint8Array([i]);
      const loan = openAccessLoanFor(bookId);
      const session = sessionFor(bookId, content);
      global.fetch = mockFetchFor(loan, session, content);
      await downloadBook(bookId);
    }

    // Re-downloading the FIRST of those books again must succeed (update, not a 6th row) even
    // though the table is already AT the limit.
    const bookId = 'limit-recount-book-0';
    const content = new Uint8Array([0]);
    global.fetch = mockFetchFor(openAccessLoanFor(bookId), sessionFor(bookId, content), content);

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
  });
});
