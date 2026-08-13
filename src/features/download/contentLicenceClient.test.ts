// Exercises this file's HTTP client logic against a mocked global.fetch — the real mock-backend
// integration is proven separately (docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md
// records a manual curl check against a live mock-backend), this test only needs to prove
// request-building and error-classification.

import { fetchContentLicence, fetchEncryptedAsset } from './contentLicenceClient';
import { API_BASE_URL } from './config';
import { DownloadFailure, DownloadError } from './errors';
import type { ContentLicenceResponse } from '@/shared/contracts';

describe('fetchContentLicence', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sampleLicence: ContentLicenceResponse = {
    bookId: 'book-001',
    format: 'EPUB',
    mimeType: 'application/epub+zip',
    encryptedFileUrl: 'http://localhost:4000/fixtures/sample.epub.enc',
    checksum: 'abc123',
    encryption: null,
    licence: null,
  };

  it('returns the parsed ContentLicenceResponse on success, hitting the correct URL', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(sampleLicence), { status: 200 }));

    const result = await fetchContentLicence('book-001');

    expect(result).toEqual(sampleLicence);
    expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/books/book-001/content-licence`);
  });

  it('throws DownloadFailure(LICENCE_FETCH_FAILED) on a non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));

    await expect(fetchContentLicence('missing-book')).rejects.toMatchObject({
      code: DownloadError.LICENCE_FETCH_FAILED,
      bookId: 'missing-book',
    });
  });

  it('throws DownloadFailure(LICENCE_FETCH_FAILED) when fetch itself rejects (offline)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(fetchContentLicence('book-001')).rejects.toBeInstanceOf(DownloadFailure);
  });
});

describe('fetchEncryptedAsset', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the response bytes as a Uint8Array on success', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    global.fetch = jest.fn().mockResolvedValue(new Response(payload, { status: 200 }));

    const bytes = await fetchEncryptedAsset('book-001', 'http://localhost:4000/fixtures/sample.epub.enc');

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws DownloadFailure(ASSET_FETCH_FAILED) on a non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 500 }));

    await expect(fetchEncryptedAsset('book-001', 'http://x/f.enc')).rejects.toMatchObject({
      code: DownloadError.ASSET_FETCH_FAILED,
      bookId: 'book-001',
    });
  });

  it('throws DownloadFailure(ASSET_FETCH_FAILED) when fetch itself rejects (offline)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(fetchEncryptedAsset('book-001', 'http://x/f.enc')).rejects.toMatchObject({
      code: DownloadError.ASSET_FETCH_FAILED,
      bookId: 'book-001',
    });
  });
});
