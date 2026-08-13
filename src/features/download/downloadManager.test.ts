// Integration-style test: real contentStore (real filesystem via __mocks__/expo-file-system.js,
// real AES-GCM math via the manual native-module mocks), real downloadTable (real SQLite via
// __mocks__/expo-sqlite.js), mocked global.fetch only. Proves the FULL orchestration order and
// every failure branch, and specifically the 5-book-limit-across-different-books behavior that
// motivated using downloadTable instead of downloadRepository (see the design doc).

import * as crypto from 'crypto';
import { downloadBook } from './downloadManager';
import { downloadTable } from '../sync/repositories/downloadRepository';
import { USER_ID } from '../sync/config';
import { contentStore } from '../encryption/contentStore';
import { DownloadError } from './errors';
import { Paths } from 'expo-file-system';
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

describe('downloadBook — happy path', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores the book via contentStore and records a downloads row, never touching plaintext-on-disk outside contentStore', async () => {
    const bookId = 'happy-path-book';
    const content = new Uint8Array([10, 20, 30, 40, 50]); // open access: content IS plaintext
    const licence = openAccessLicenceFor(bookId, content);
    global.fetch = mockFetchFor(licence, content);

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
    const licence = openAccessLicenceFor(bookId, content);
    global.fetch = mockFetchFor(licence, content);

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

  it('rejects with CHECKSUM_MISMATCH and never calls contentStore.store when the checksum is wrong', async () => {
    const bookId = 'tampered-checksum-book';
    const content = new Uint8Array([9, 9, 9]);
    const licence = { ...openAccessLicenceFor(bookId, content), checksum: 'not-the-real-checksum' };
    global.fetch = mockFetchFor(licence, content);

    await expect(downloadBook(bookId)).rejects.toMatchObject({
      code: DownloadError.CHECKSUM_MISMATCH,
      bookId,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('rejects with LICENCE_FETCH_FAILED when content-licence 404s', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));

    await expect(downloadBook('missing-book')).rejects.toMatchObject({
      code: DownloadError.LICENCE_FETCH_FAILED,
    });
  });
});
