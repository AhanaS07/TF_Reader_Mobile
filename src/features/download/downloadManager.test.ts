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
import { downloadBook, BOOK_LIMIT } from './downloadManager';
import { downloadTable } from '../sync/stores/downloadStore';
import { USER_ID } from '../sync/syncConfig';
import { contentStore, decryptSearchIndex, MAX_DECRYPTED_BYTES } from '../encryption/contentStore';
import { encrypt } from '../encryption/aesGcm';
import { generateDeviceKeypair, wrapBek, publicKeyFingerprint } from '../encryption/deviceKeypair';
import { CHUNK_SIZE_BYTES } from './chunkedAssetFetcher';
import { DownloadError, DownloadFailure } from './errors';
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

  // Found in review (D-16): `content.originalLength`/`mimeType` are OPTIONAL on the real spec (no
  // `*` on either in wokay's schema) — comparing a real number against an ABSENT field used to be
  // unconditional, so a response that legitimately omitted `originalLength` made every download
  // reject with a CHECKSUM_MISMATCH blaming a field that was never sent. `computeOriginalLength`
  // must be the FALLBACK VALUE when absent, not just a cross-check against one.
  it('succeeds when content.originalLength and mimeType are both absent from the response', async () => {
    const bookId = 'optional-fields-absent-book';
    const content = new Uint8Array([7, 8, 9, 10]); // open access: content IS plaintext
    const loan = openAccessLoanFor(bookId);
    const session = sessionFor(bookId, content);
    delete (session.content as { originalLength?: number }).originalLength;
    delete (session.content as { mimeType?: string }).mimeType;
    global.fetch = mockFetchFor(loan, session, content);

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(content));
    await contentStore.close(bookId);
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

    // downloadManager.ts now derives SignedLicence.keyFingerprint from the device's OWN key
    // (publicKeyFingerprint), independently of whatever encryption.keyFingerprint the server
    // reports — contentStore.ts's licence/encryption fingerprint check only means anything if
    // this mock server "claim" genuinely matches the same device key downloadBook wraps the BEK
    // under below, same as a real backend fingerprinting the devicePublicKey it received.
    const keyFingerprint = await publicKeyFingerprint(publicKey);
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

  // The end-to-end wiring for the anti-key-substitution check, not just contentStore's own unit
  // coverage of it: downloadManager.ts derives `licence.keyFingerprint` from THIS device's own
  // key (`publicKeyFingerprint()`), independently of whatever `encryption.keyFingerprint` the
  // server sends — so a server claim that disagrees with this device's real key must be caught
  // and rejected before the book is ever persisted, not silently trusted.
  it('rejects — and never persists — when the server-claimed encryption.keyFingerprint does not match this device key', async () => {
    const bookId = 'encrypted-subscription-bad-fingerprint';
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const bek = new Uint8Array(crypto.randomBytes(32));

    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey); // wraps to the REAL device key — only the
    // claimed fingerprint below is wrong, isolating this test to the fingerprint check alone.
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);

    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true,
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
        keyFingerprint: 'sha256:not-this-devices-key-at-all',
      },
    });
    const fetchMock = mockFetchFor(loan, session, encryptedBytes);
    global.fetch = fetchMock;

    // C7/B3 follow-up: this check now happens in downloadManager.ts, right after the session
    // response and BEFORE fetchEncryptedAsset — see this directory's API_CONTRACT_NOTES.md.
    // KEY_SUBSTITUTION, not ContentError.LICENCE_INVALID (contentStore.ts's own check is defense
    // in depth for direct callers, but the real download path never reaches it — proven below by
    // asserting the asset URL was never even requested).
    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.KEY_SUBSTITUTION,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    const requestedUrls = fetchMock.mock.calls.map((call) => call[0]);
    expect(requestedUrls).not.toContain(session.content.url);
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

    // Same reasoning as the SUBSCRIPTION test above: must match the real fingerprint of the
    // device key `publicKey` wraps the BEK under, not an arbitrary literal.
    const keyFingerprint = await publicKeyFingerprint(publicKey);
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

    // Found in review (D-18): this used to write a `status: 'COMPLETED'` downloads row and burn
    // one of the 5 offline slots for a book that was never actually persisted. An ELITE (STREAM)
    // read must leave the downloads table exactly as it found it — nothing to track, since
    // nothing was written.
    const rows = await downloadTable.listActive(USER_ID);
    expect(rows.find((row) => row.book_id === bookId)).toBeUndefined();

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });

  // Found in review (D-18), the other half of the same fix: the fast-fail cap check used to run
  // BEFORE borrowLoan(), so it couldn't tell an ELITE (never-persisted) read apart from a real
  // download. A reader already at the 5-book cap on real downloads would get a bogus
  // BOOK_LIMIT_REACHED trying to just READ an ELITE book online, even though doing so was never
  // going to consume a slot. This proves the gate now checks `loan.canPersist` (post-borrow),
  // not just book count, before rejecting.
  it('reading an ELITE book succeeds even when already at the 5-book cap on real downloads', async () => {
    const eliteBookId = 'elite-at-cap-book';
    const plaintext = new Uint8Array([31, 32, 33]);
    const bek = new Uint8Array(crypto.randomBytes(32));
    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);
    const keyFingerprint = await publicKeyFingerprint(publicKey);

    // Fill the cap with real (open-access, canPersist: true) downloads. Topped up RELATIVE to
    // whatever is already active, not from an assumed-empty table — other describe blocks in
    // this file share this same real, un-reset downloadTable and don't all clean up after
    // themselves (see the search-index block's own comment on the identical trap), so a literal
    // "start from 0" assumption here would be fragile to run order.
    const before = (await downloadTable.listActive(USER_ID)).length;
    const fillerIds: string[] = [];
    for (let i = before; i < BOOK_LIMIT; i++) {
      const bookId = `elite-at-cap-filler-${i}`;
      fillerIds.push(bookId);
      const content = new Uint8Array([i, i + 1, i + 2]);
      const loan = openAccessLoanFor(bookId);
      const session = sessionFor(bookId, content);
      global.fetch = mockFetchFor(loan, session, content);
      await downloadBook(bookId);
    }
    const atCap = (await downloadTable.listActive(USER_ID)).length;
    expect(atCap).toBeGreaterThanOrEqual(BOOK_LIMIT);

    const eliteLoan = openAccessLoanFor(eliteBookId, { licenceModel: 'ELITE', canPersist: false });
    const eliteSession = sessionFor(eliteBookId, encryptedBytes, {
      content: {
        url: `http://localhost:4000/fixtures/${eliteBookId}.epub.enc`,
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
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) return new Response(JSON.stringify(eliteLoan), { status: 200 });
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`)
        return new Response(JSON.stringify(eliteSession), { status: 200 });
      if (url === eliteSession.content.url) return new Response(encryptedBytes, { status: 200 });
      return new Response(null, { status: 404 });
    });

    await expect(downloadBook(eliteBookId)).resolves.toBeUndefined();
    // Count unchanged — the ELITE read didn't add a row, and wasn't blocked by the cap already there.
    expect((await downloadTable.listActive(USER_ID)).length).toBe(atCap);

    // Soft-delete only the filler rows THIS test created — this file's `downloadTable` is real
    // and un-reset across tests (see the search-index describe block's own comment on the
    // identical trap), so leaving them would trip BOOK_LIMIT_REACHED in every test that runs
    // after this one.
    for (const bookId of fillerIds) {
      const rows = await downloadTable.listActive(USER_ID, bookId);
      for (const row of rows) {
        await downloadTable.softDeleteLocal(row.id);
      }
    }
  });
});

describe('downloadBook — unencrypted audio under a real tier (B15 regression)', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  // Both contracts agree audio is never encrypted regardless of tier — `session.encryption` is
  // absent here exactly like a real audio response, distinguishing "unencrypted because open
  // access" from "unencrypted because audio, under a real ELITE loan". Before the `needsLicence`
  // fix, `isEncrypted` gated the licence, so this book got `licence: null` — `contentStore.ts`'s
  // `isElite()` reads `pkg.licence`, saw null, answered false, and persisted an Elite title
  // permanently: unaccounted against the 5-book limit and immune to the loan ever expiring.
  it('an ELITE audio book is treated as Elite (memory-only), not open access', async () => {
    const bookId = 'elite-audio-book';
    const plaintext = new Uint8Array([40, 41, 42, 43, 44]); // audio bytes, never encrypted
    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'ELITE',
      canPersist: false,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    // No `encryption` field — matches the real spec's "null for open access and for all audio".
    const session = sessionFor(bookId, plaintext);
    global.fetch = mockFetchFor(loan, session, plaintext);

    await expect(downloadBook(bookId, 'AUDIO')).resolves.toBeUndefined();

    // The crux of the regression: Elite writes nothing, even though nothing about this download
    // was encrypted. Before the fix this was `true` — indistinguishable from real open access.
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);

    const rows = await downloadTable.listActive(USER_ID);
    expect(rows.find((row) => row.book_id === bookId)).toBeUndefined();

    // The STREAM read itself must still succeed — Elite is "online-only", not "unreadable".
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });

  // The other half of the same fix: a real Subscription audio book must still persist
  // (Subscription IS a download tier) — this must not turn EVERY unencrypted book Elite-shaped.
  it('a SUBSCRIPTION audio book still persists, with a real (non-null) licence attached', async () => {
    const bookId = 'subscription-audio-book';
    const plaintext = new Uint8Array([50, 51, 52, 53, 54]);
    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const session = sessionFor(bookId, plaintext);
    global.fetch = mockFetchFor(loan, session, plaintext);

    await expect(downloadBook(bookId, 'AUDIO')).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);

    // This test's whole point is that it DOES persist (unlike the Elite case above) — so, same
    // trap as the book-limit describe block's own comment: `downloadTable` is real and un-reset
    // across tests in this file. Soft-delete the row this test created rather than leaving it to
    // silently eat one of the 5 offline slots for every test that runs after this one.
    const rows = await downloadTable.listActive(USER_ID, bookId);
    for (const row of rows) {
      await downloadTable.softDeleteLocal(row.id);
    }
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

// Every other describe block's `mockFetchFor` answers the content URL with a flat 200 — realistic
// for a server with no Range support, but it never actually exercises chunkedAssetFetcher.ts's
// chunking through the real downloadBook() pipeline, only its own unit tests
// (chunkedAssetFetcher.test.ts) do that in isolation. This block wires a real Range-aware mock —
// the same behavior confirmed live against the actual mock-backend (express.static) — so the full
// pipeline (loan -> session -> chunked fetch -> store -> downloads row) is proven end to end too.
describe('downloadBook — chunked asset fetch (real Range behavior)', () => {
  const originalFetch = global.fetch;
  // Same "soft-delete against the real, un-reset downloadTable" pattern as the search-index-
  // delivery block below: this describe block now persists TWO distinct books (the pre-existing
  // multi-chunk test's, and the new onProgress test's below), and this file never resets the
  // downloadTable between describe blocks — without this, the second persisting test here would
  // push a distinct book over BOOK_LIMIT (5), tripped by earlier describe blocks' own persisted
  // books, exactly the trap the search-index-delivery block's own comment already describes.
  const chunkedBookIds = ['chunked-download-multi', 'chunked-download-progress', 'chunked-download-resume'];
  afterEach(async () => {
    global.fetch = originalFetch;
    for (const bookId of chunkedBookIds) {
      const rows = await downloadTable.listActive(USER_ID, bookId);
      for (const row of rows) {
        await downloadTable.softDeleteLocal(row.id);
      }
    }
  });

  function mockFetchForChunked(
    loan: Loan,
    session: ReadingSessionResponse,
    content: Uint8Array<ArrayBuffer>,
  ): jest.Mock {
    return jest.fn().mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) {
        return new Response(JSON.stringify(loan), { status: 200 });
      }
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
        return new Response(JSON.stringify(session), { status: 200 });
      }
      if (url === session.content.url) {
        const rangeHeader = init?.headers?.Range;
        const match = rangeHeader ? /^bytes=(\d+)-(\d+)$/.exec(rangeHeader) : null;
        if (!match) return new Response(content, { status: 200 });
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), content.length - 1);
        return new Response(content.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${content.length}` },
        });
      }
      return new Response(null, { status: 404 });
    });
  }

  it('downloads a book spanning multiple 1 MiB chunks, via real Range requests, and stores it correctly', async () => {
    const bookId = 'chunked-download-multi';
    const plaintext = new Uint8Array(Math.floor(CHUNK_SIZE_BYTES * 2.5)).map((_, i) => i % 256);
    const bek = new Uint8Array(crypto.randomBytes(32));
    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);
    const keyFingerprint = await publicKeyFingerprint(publicKey);

    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true,
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
    const fetchMock = mockFetchForChunked(loan, session, encryptedBytes);
    global.fetch = fetchMock;

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    // 3 real chunk requests against the content URL (2.5 chunks rounds up), not one big fetch.
    const contentRequests = fetchMock.mock.calls.filter((call) => call[0] === session.content.url);
    expect(contentRequests).toHaveLength(3);
    expect(contentRequests[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);

    // The 5-book-limit bookkeeping (downloadTable write, under the write lock) ran to completion
    // too — chunking only changed how the bytes arrived, not the accounting around them.
    const rows = await downloadTable.listActive(USER_ID, bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('COMPLETED');

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });

  // Whole-file AES-GCM means ONE tag covers the ENTIRE ciphertext (cipherLayout.ts) — there is no
  // per-chunk verification. Chunking (and resuming) only changes how the bytes for that one
  // ciphertext arrive; decryptBook()'s tag check (aesGcm.ts) cannot tell a resumed reassembly from
  // a single whole-file fetch UNLESS the reassembly is byte-wrong, in which case it throws
  // INTEGRITY_FAILED exactly as whole-file corruption already does — no new error path needed
  // (this file's own header comment). This test is the one place that combines the two real
  // pieces that are each tested separately elsewhere: chunkedAssetFetcher.test.ts proves a resumed
  // fetch is byte-identical to a non-resumed one (via Buffer equality against random bytes, no
  // crypto involved), and the test above proves a real GCM payload survives a non-interrupted
  // chunked fetch. Neither proves the tag still validates when those two are combined — a resumed
  // reassembly is the one path most likely to introduce a byte-boundary bug (reopening a partial
  // file, appending onto it) if either implementation drifts.
  it('resumes a real AES-256-GCM-encrypted download after an interruption, and the reassembled ciphertext still passes the GCM tag check', async () => {
    const bookId = 'chunked-download-resume';
    const plaintext = new Uint8Array(Math.floor(CHUNK_SIZE_BYTES * 3.3)).map((_, i) => i % 256);
    const bek = new Uint8Array(crypto.randomBytes(32));
    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);
    const keyFingerprint = await publicKeyFingerprint(publicKey);

    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true,
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

    // First attempt: the loan/session calls succeed (real endpoints), but the 3rd chunk of the
    // real ciphertext fails outright — simulating a dropped connection mid-asset, same shape as
    // chunkedAssetFetcher.test.ts's own resume test. Wraps the already-proven mockFetchForChunked
    // rather than reimplementing the loan/session branches, so only the interruption itself is new.
    let chunkCallCount = 0;
    const workingFetch = mockFetchForChunked(loan, session, encryptedBytes);
    const failingFetch = jest.fn().mockImplementation(async (url: string, init?: unknown) => {
      if (url === session.content.url) {
        chunkCallCount++;
        if (chunkCallCount === 3) {
          throw new TypeError('Network request failed');
        }
      }
      return workingFetch(url, init);
    });
    global.fetch = failingFetch;

    // A plain `try/catch` here, not `await expect(...).rejects...`: the throw above happens
    // inside an async mock nested one layer deeper than the other tests in this file (this mock
    // wraps mockFetchForChunked's own mock rather than being called directly), and that extra hop
    // trips Node's unhandled-rejection detection racing `.rejects`' own handler attachment —
    // confirmed empirically, not a style preference. The assertion is identical either way.
    let firstAttemptError: unknown;
    try {
      await downloadBook(bookId);
    } catch (error) {
      firstAttemptError = error;
    }
    expect(firstAttemptError).toBeInstanceOf(DownloadFailure);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);

    // Second attempt: resumes from the 2 chunks already on disk (chunkedAssetFetcher.ts's own
    // partial-download state), fetches only the remainder, and must reassemble to the exact same
    // ciphertext bytes as the real encrypt() call produced above.
    const resumeFetch = mockFetchForChunked(loan, session, encryptedBytes);
    global.fetch = resumeFetch;

    await expect(downloadBook(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    // Only the remaining chunk(s) were re-requested against the content URL — proves this
    // resumed rather than re-fetching the whole 3.3-MiB asset from byte 0.
    const resumedContentRequests = resumeFetch.mock.calls.filter((call) => call[0] === session.content.url);
    expect(resumedContentRequests.length).toBeLessThan(4);
    expect(resumedContentRequests[0][1].headers.Range).toBe(
      `bytes=${CHUNK_SIZE_BYTES * 2}-${CHUNK_SIZE_BYTES * 3 - 1}`,
    );

    // THE ACTUAL CLAIM: decryptBook() calls decipher.final() (aesGcm.ts), which throws on a bad
    // GCM tag. Reaching this assertion at all — with the correct plaintext back out — is the
    // proof the resumed-then-reassembled ciphertext is byte-identical to what encrypt() produced,
    // not just "some bytes of the right length".
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    await contentStore.close(bookId);
  });

  it('forwards onProgress through to the chunked fetcher, with the running byte total', async () => {
    const bookId = 'chunked-download-progress';
    const plaintext = new Uint8Array(Math.floor(CHUNK_SIZE_BYTES * 2.5)).map((_, i) => i % 256);
    const bek = new Uint8Array(crypto.randomBytes(32));
    const { publicKey } = await generateDeviceKeypair();
    const wrappedBek = await wrapBek(bek, publicKey);
    const payload = await encrypt(plaintext, bek);
    const encryptedBytes = new Uint8Array(payload.content);
    const keyFingerprint = await publicKeyFingerprint(publicKey);

    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'SUBSCRIPTION',
      canPersist: true,
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
    global.fetch = mockFetchForChunked(loan, session, encryptedBytes);
    const onProgress = jest.fn();

    await expect(downloadBook(bookId, 'EPUB', { onProgress })).resolves.toBeUndefined();

    // downloadBook's chunked fetch deals in CIPHERTEXT bytes (nonce+ciphertext+tag), same as
    // fetchEncryptedAssetChunked's own onProgress contract — one call per chunk, running total.
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, CHUNK_SIZE_BYTES, encryptedBytes.length);
    expect(onProgress).toHaveBeenNthCalledWith(3, encryptedBytes.length, encryptedBytes.length);
  });

  it('still enforces the RAM budget in the chunked path, rejecting before all chunks are fetched', async () => {
    const bookId = 'chunked-too-large-e2e';
    // Bigger than MAX_DECRYPTED_BYTES so the FIRST chunk's Content-Range total already exceeds
    // the (encryption-adjusted) budget — the point being it must reject BEFORE fetching the rest.
    const oversized = new Uint8Array(MAX_DECRYPTED_BYTES + CHUNK_SIZE_BYTES * 3);
    // ELITE (not OPEN_ACCESS): downloadManager.ts only runs the 5-book-limit check when
    // `loan.canPersist` is true, and this suite's `downloadTable` is real and un-reset across
    // tests (see the book-limit-race describe block's own comment on the same trap) — by this
    // point in the file it's already at cap from earlier tests. ELITE isolates the assertion to
    // the budget check this test actually targets, instead of tripping BOOK_LIMIT_REACHED first.
    const loan = openAccessLoanFor(bookId, {
      licenceModel: 'ELITE',
      canPersist: false,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const session = sessionFor(bookId, oversized, {
      content: {
        url: `http://localhost:4000/fixtures/${bookId}.epub`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        cipherLength: oversized.length,
        originalLength: oversized.length,
        mimeType: 'application/epub+zip',
      },
    });
    const fetchMock = mockFetchForChunked(loan, session, oversized);
    global.fetch = fetchMock;

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.BOOK_TOO_LARGE,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);

    const contentRequests = fetchMock.mock.calls.filter((call) => call[0] === session.content.url);
    expect(contentRequests).toHaveLength(1); // rejected after the first chunk, never fetched chunks 2-4+
  });
});
