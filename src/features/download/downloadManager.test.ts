// Integration-style test: real contentStore (real filesystem via __mocks__/expo-file-system.js,
// real AES-GCM math via the manual native-module mocks), real downloadTable (real SQLite via
// __mocks__/expo-sqlite.js), mocked global.fetch only. Proves the FULL orchestration order and
// every failure branch, and specifically the 5-book-limit-across-different-books behavior that
// motivated using downloadTable instead of downloadRepository (see the design doc).
//
// REAL FLAMBEAU CONTRACT (2026-08-14): downloadBook now hits THREE endpoints, not two —
// `POST /api/v1/loans` (borrowLoan), `POST /api/v1/reading-sessions` (openReadingSession), then
// the asset itself at `session.content.url` (and `session.index.url`, if present) — instead of the
// old mock-shaped `GET /books/:id/content-licence` + asset. See readingSessionClient.ts and
// src/shared/contracts/reading-session.ts for the real shapes being mocked here.

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { downloadBook } from './downloadManager';
import { downloadTable } from '../sync/stores/downloadStore';
import { USER_ID } from '../sync/syncConfig';
import { contentStore, decryptSearchIndex, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { encrypt } from '../encryption/aesGcm';
import { generateDeviceKeypair, wrapBek } from '../encryption/deviceKeypair';
import { DownloadError } from './errors';
import { Paths } from 'expo-file-system';
import { API_BASE_URL } from './config';
import type { FlambeauError, Loan, ReadingSessionResponse } from '@/shared/contracts';

// A plain OPEN_ACCESS loan — canPersist:true (open access always persists; there's no key
// material to protect by refusing to write it), no dueAt (open access never expires, per
// reading-session.ts's own header).
function openAccessLoanFor(bookId: string, overrides?: Partial<Loan>): Loan {
  return {
    loanId: `loan-${bookId}`,
    itemId: bookId,
    userId: USER_ID,
    licenceModel: 'OPEN_ACCESS',
    status: 'ACTIVE',
    borrowedAt: new Date().toISOString(),
    canPersist: true,
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

// `content.originalLength` defaults to `content.length` (open access: content IS plaintext, no
// nonce/tag overhead) — callers exercising the encrypted branch override it via `overrides`.
function sessionFor(
  bookId: string,
  content: Uint8Array,
  overrides?: Partial<ReadingSessionResponse>,
): ReadingSessionResponse {
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
    ...overrides,
  };
}

// Mocks fetch across all the URLs downloadBook now hits: borrow, session, the main asset, and
// (if `session.index` is set) the index asset. Same "one jest.fn switching on url" shape the old
// two-URL mockFetchFor used, extended to three/four destinations instead of two.
function mockFetchFor(
  loan: Loan,
  session: ReadingSessionResponse,
  content: Uint8Array<ArrayBuffer>,
  indexBytes?: Uint8Array<ArrayBuffer>,
) {
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
    if (session.index && url === session.index.url) {
      return new Response(indexBytes ?? new Uint8Array(), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}

describe('downloadBook — happy path', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores the book via contentStore and records a downloads row, never touching plaintext-on-disk outside contentStore', async () => {
    const bookId = 'happy-path-book';
    const content = new Uint8Array([10, 20, 30, 40, 50]); // open access: content IS plaintext
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content);
    global.fetch = mockFetchFor(loan, session, content);

    await downloadBook(bookId);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
    const rows = await downloadTable.listActive(USER_ID);
    const row = rows.find((r) => r.book_id === bookId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('COMPLETED');
    expect(row!.local_path).toBeNull();
  });

  it('re-downloading the SAME book updates its existing row rather than creating a second one', async () => {
    const bookId = 'repeat-download-book';
    const content = new Uint8Array([1, 2, 3]);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content);
    global.fetch = mockFetchFor(loan, session, content);

    await downloadBook(bookId);
    const firstRows = await downloadTable.listActive(USER_ID);
    const firstRow = firstRows.find((r) => r.book_id === bookId)!;

    await downloadBook(bookId);
    const secondRows = await downloadTable.listActive(USER_ID);
    const matching = secondRows.filter((r) => r.book_id === bookId);

    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(firstRow.id);
  });
});

// Matches deviceKeypair.ts's internal constant — duplicated here only for the scoped keychain
// cleanup below, exactly as contentStore.test.ts does it (deviceKeypair.ts exposes no reset).
const DEVICE_PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

describe('downloadBook — the ENCRYPTED (Subscription) path, for real', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  // Every other test in this file uses an open-access session (encryption/licence both null),
  // which never exercises computeOriginalLength's ENCRYPTED branch (cipherLength - NONCE - TAG).
  // This one does, against real AES-GCM bytes and a real RSA-OAEP-wrapped BEK — the same
  // generateDeviceKeypair -> wrapBek -> store -> decryptBook path contentStore.test.ts's
  // "end-to-end via the real device keypair" block proves for contentStore alone, driven here
  // through downloadBook instead. It CAN fail: an off-by-one in that subtraction makes
  // contentStore.store()'s own assertLengthInvariant reject the package outright
  // (ContentFailure(INTEGRITY_FAILED)), and a wrong nonce/tag split makes decryptBook reject.
  //
  // `loan.canPersist: true` is the load-bearing bit for THIS describe block's name: it is what
  // makes downloadManager.ts derive `intent: 'DOWNLOAD'` (not hardcoded) — see this file's header.
  it('downloads, stores and decrypts an AES-256-GCM book with a real wrapped BEK', async () => {
    const bookId = 'encrypted-subscription-book';
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const bek = new Uint8Array(crypto.randomBytes(32));

    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);

    // aesGcm.encrypt returns a CipherPayload whose `content` is nonce(12)||ciphertext||tag(16) —
    // exactly the bytes the mock backend would serve at content.url.
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);

    const keyFingerprint = 'sha256:downloadmanager-encrypted-test';
    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true, // Subscription, not Elite: persists to disk
      dueAt: new Date(Date.now() + 86_400_000).toISOString(), // +1 day — the offline reopen window
    });
    const session = sessionFor(bookId, encryptedBytes, {
      content: {
        url: `http://localhost:4000/fixtures/${bookId}.epub.enc`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        cipherLength: encryptedBytes.length,
        originalLength: plaintext.length, // the PLAINTEXT length, per SignedUrl's own shape
        mimeType: 'application/epub+zip',
      },
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek,
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint,
      },
    });
    global.fetch = mockFetchFor(loan, session, encryptedBytes);

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    // Full round trip: the bytes downloadBook handed to store() really do decrypt back to the
    // original plaintext, via the real device private key and the real GCM tag check.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });
});

describe('downloadBook — the ELITE (online-only) path, for real', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  // `loan.canPersist: false` is the whole point of this test: it proves `intent` comes out
  // 'STREAM' (not hardcoded 'DOWNLOAD', which the real backend would refuse for ELITE with
  // 403 DOWNLOAD_NOT_PERMITTED — see downloadManager.ts's header) AND that the flow still
  // succeeds end-to-end for it — contentStore.ts's `isElite` (licence.canPersist === false)
  // handles the "writes nothing to disk/keychain" part, unchanged by this migration.
  it('requests intent STREAM for canPersist:false and still fetches, decrypts, but never persists to disk', async () => {
    const bookId = 'elite-online-only-book';
    const plaintext = new Uint8Array([21, 22, 23, 24, 25]);
    const bek = new Uint8Array(crypto.randomBytes(32));

    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);

    const keyFingerprint = 'sha256:downloadmanager-elite-test';
    let requestedIntent: string | undefined;
    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'ELITE',
      canPersist: false,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const session = sessionFor(bookId, encryptedBytes, {
      content: {
        url: `http://localhost:4000/fixtures/${bookId}.epub.enc`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        cipherLength: encryptedBytes.length,
        originalLength: plaintext.length,
        mimeType: 'application/epub+zip',
      },
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek,
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint,
      },
    });

    global.fetch = jest.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) {
        return new Response(JSON.stringify(loan), { status: 200 });
      }
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
        requestedIntent = init?.body ? (JSON.parse(init.body) as { intent?: string }).intent : undefined;
        return new Response(JSON.stringify(session), { status: 200 });
      }
      if (url === session.content.url) {
        return new Response(encryptedBytes, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(requestedIntent).toBe('STREAM');

    // Elite writes nothing to disk/keychain (contentStore.ts's own "Elite writes nothing" rule) —
    // isAvailableOffline stays false even though the download itself succeeded.
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });
});

describe('downloadBook — failure branches', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects with INSUFFICIENT_STORAGE and never calls fetch when free space is below the floor', async () => {
    Object.defineProperty(Paths, 'availableDiskSpace', { get: () => 0, configurable: true });
    global.fetch = jest.fn();

    await expect(downloadBook('low-storage-book')).rejects.toMatchObject({
      code: DownloadError.INSUFFICIENT_STORAGE,
    });
    expect(global.fetch).not.toHaveBeenCalled();

    Object.defineProperty(Paths, 'availableDiskSpace', { get: () => 10 * 1024 * 1024 * 1024, configurable: true });
  });

  // Renamed from "the checksum is wrong": the real ReadingSessionResponse carries no checksum
  // field at all (downloadManager.ts's header, "CHECKSUM:") — this is now a cross-check between
  // computeOriginalLength(bytes.length, isEncrypted) and the server-supplied
  // session.content.originalLength, and a disagreement is treated exactly as loudly as the old
  // checksum mismatch was: CHECKSUM_MISMATCH, thrown BEFORE contentStore.store().
  it('rejects with CHECKSUM_MISMATCH when session.content.originalLength disagrees with the actual asset byte length', async () => {
    const bookId = 'tampered-length-book';
    const content = new Uint8Array([9, 9, 9]);
    const loan = openAccessLoanFor(bookId);
    // originalLength claims one more byte than the asset actually is — open access, so
    // computeOriginalLength(bytes.length, false) === bytes.length, which will disagree.
    const session = sessionFor(bookId, content, {
      content: {
        url: `http://localhost:4000/fixtures/${bookId}.epub`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        cipherLength: content.length,
        originalLength: content.length + 1,
        mimeType: 'application/epub+zip',
      },
    });
    global.fetch = mockFetchFor(loan, session, content);

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.CHECKSUM_MISMATCH,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  // Same "never stored" assertion shape as the CHECKSUM_MISMATCH test above: isAvailableOffline
  // stays false, which is only true if contentStore.store() was never reached.
  it('rejects with BOOK_TOO_LARGE and never calls contentStore.store when the book exceeds the RAM budget', async () => {
    const bookId = 'oversized-book';
    // One byte over contentStore's MAX_DECRYPTED_BYTES. Open access, so originalLength ===
    // content.length — no nonce/tag overhead to reason about here.
    const content = new Uint8Array(MAX_DECRYPTED_BYTES + 1);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content);
    global.fetch = mockFetchFor(loan, session, content);

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_TOO_LARGE,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  // Renamed from "rejects with LICENCE_FETCH_FAILED when content-licence 404s": borrowLoan() is
  // now the FIRST network call downloadBook makes, and a 404 with no FlambeauError-shaped body
  // (tryParseFlambeauError finds no `code` field) falls back to the generic LOAN_FAILED, same
  // fallback role LICENCE_FETCH_FAILED used to play for the old single-endpoint mock.
  it('rejects with LOAN_FAILED when the loan request 404s', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));

    await expect(downloadBook('missing-book')).rejects.toMatchObject({
      code: DownloadError.LOAN_FAILED,
    });
  });
});

// New coverage for the real contract's FlambeauError -> DownloadError mapping
// (readingSessionClient.ts's LOAN_ERROR_CODE_MAP / SESSION_ERROR_CODE_MAP), which has zero
// coverage under the old mock (it never had a real error envelope to parse). One case per
// endpoint, not an exhaustive sweep of every mapped code — errors.ts documents the full list.
describe('downloadBook — flambeau error code mapping', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function flambeauError(code: FlambeauError['code'], path: string): FlambeauError {
    return {
      timestamp: new Date().toISOString(),
      status: 403,
      code,
      message: `mock ${code}`,
      path,
    };
  }

  it('rejects with NO_ENTITLEMENT when the loan request 403s with that flambeau code', async () => {
    const bookId = 'no-entitlement-book';
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) {
        return new Response(JSON.stringify(flambeauError('NO_ENTITLEMENT', '/api/v1/loans')), { status: 403 });
      }
      return new Response(null, { status: 404 });
    });

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.NO_ENTITLEMENT,
      bookId,
    });
  });

  it('rejects with DOWNLOAD_NOT_PERMITTED when the reading-session request 403s with that flambeau code', async () => {
    const bookId = 'download-not-permitted-book';
    const loan = openAccessLoanFor(bookId, { licenceModel: 'ELITE', canPersist: true }); // canPersist mis-set upstream; server is the real enforcer here
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) {
        return new Response(JSON.stringify(loan), { status: 200 });
      }
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
        return new Response(
          JSON.stringify(flambeauError('DOWNLOAD_NOT_PERMITTED', '/api/v1/reading-sessions')),
          { status: 403 },
        );
      }
      return new Response(null, { status: 404 });
    });

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.DOWNLOAD_NOT_PERMITTED,
      bookId,
    });
  });
});

// Regression tests for the "no way to deliver a search index" gap (now `ReadingSessionResponse
// .index`, forwarded unchanged by the flambeau migration — see downloadManager.ts's header).
describe('downloadBook — search index delivery', () => {
  const originalFetch = global.fetch;
  const bookIds = ['book-with-index', 'book-with-unfetchable-index', 'book-without-index'];

  // Every other describe block in this file stays under the 5-book cap by construction (its
  // failure branches never reach contentStore.store(), and the happy-path tests reuse the same
  // book). This block stores 3 DIFFERENT books against the same real, un-reset downloadTable —
  // without cleanup, the 3rd test here would itself trip BOOK_LIMIT_REACHED before ever
  // exercising the "no index URL" assertion it's meant to test. Soft-delete keeps each test's
  // row from counting against the ones that run after it.
  afterEach(async () => {
    global.fetch = originalFetch;
    await contentStore.close('book-with-index');
    await contentStore.close('book-with-unfetchable-index');
    for (const bookId of bookIds) {
      const rows = await downloadTable.listActive(USER_ID, bookId);
      for (const row of rows) {
        await downloadTable.softDeleteLocal(row.id);
      }
    }
  });

  it('fetches and attaches the search index when the session has one', async () => {
    const bookId = 'book-with-index';
    const content = new Uint8Array([1, 2, 3, 4]);
    const indexBytes = new Uint8Array([9, 8, 7]);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content, {
      index: { url: `http://localhost:4000/fixtures/${bookId}.index.enc`, encrypted: false, termCount: 3 },
    });
    global.fetch = mockFetchFor(loan, session, content, indexBytes);

    await downloadBook(bookId);

    await contentStore.openSession(bookId);
    const decodedIndex = await decryptSearchIndex(bookId);
    expect(decodedIndex).not.toBeNull();
    expect(Array.from(decodedIndex!)).toEqual(Array.from(indexBytes));
  });

  it('still downloads the book successfully if fetching the index fails — independent failure domain', async () => {
    const bookId = 'book-with-unfetchable-index';
    const content = new Uint8Array([5, 6, 7]);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content, {
      index: { url: `http://localhost:4000/fixtures/${bookId}.index.enc`, encrypted: false },
    });
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) return new Response(JSON.stringify(loan), { status: 200 });
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`) return new Response(JSON.stringify(session), { status: 200 });
      if (url === session.content.url) return new Response(content, { status: 200 });
      if (url === session.index!.url) return new Response(null, { status: 500 });
      return new Response(null, { status: 404 });
    });

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await contentStore.openSession(bookId);
    expect(await decryptSearchIndex(bookId)).toBeNull(); // no index made it through
  });

  it('never requests an index URL when the session has none', async () => {
    const bookId = 'book-without-index';
    const content = new Uint8Array([1]);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content); // no .index field at all
    const fetchMock = mockFetchFor(loan, session, content);
    global.fetch = fetchMock;

    await downloadBook(bookId);

    // Exactly 3 requests: loan, reading-session, then the main asset. No fourth URL was ever built.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// Regression test for the parked "rollback destroy() isn't guarded" finding: the in-lock
// re-check (downloadManager.ts's withWriteLock block) can lose a race that the pre-fetch check
// above didn't see, in which case it must roll back via contentStore.destroy(bookId) and still
// surface the ORIGINAL BOOK_LIMIT_REACHED DownloadFailure — even if destroy() itself throws.
describe('downloadBook — book-limit race rollback', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('still rejects with the original BOOK_LIMIT_REACHED error when the in-lock rollback destroy() itself throws', async () => {
    const bookId = 'race-rollback-book';
    const content = new Uint8Array([1, 2, 3]);
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content);
    global.fetch = mockFetchFor(loan, session, content);

    // Pre-fetch check (outside the lock) sees room; the re-check INSIDE the lock sees 5 other
    // books already at the cap — simulating another download winning the race in between.
    const roomyRows = [] as unknown as Awaited<ReturnType<typeof downloadTable.listActive>>;
    const fullRows = Array.from({ length: 5 }, (_, i) => ({
      book_id: `other-book-${i}`,
    })) as unknown as Awaited<ReturnType<typeof downloadTable.listActive>>;
    jest.spyOn(downloadTable, 'listActive').mockResolvedValueOnce(roomyRows).mockResolvedValueOnce(fullRows);

    const destroySpy = jest
      .spyOn(contentStore, 'destroy')
      .mockRejectedValueOnce(new Error('keychain unavailable during rollback'));

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_LIMIT_REACHED,
      bookId,
    });
    expect(destroySpy).toHaveBeenCalledWith(bookId);
  });
});
