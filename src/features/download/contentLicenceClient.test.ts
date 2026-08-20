// Exercises this file's HTTP client logic against a mocked global.fetch — the real mock-backend
// integration was manually verified against a live server during development, outside this test
// suite; this test only needs to prove request-building and error-classification.

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
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/books/book-001/content-licence`,
      expect.objectContaining({ signal: expect.anything() }),
    );
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

  // Regression test: this was the one call in the download flow with no timeout at all — see
  // readingSessionClient.ts's borrowLoan/openReadingSession, which already had this guard.
  // A server that accepts the connection and then never answers (dead proxy, captive portal) used
  // to leave `await fetch(...)` pending forever here, with no way for downloadBook() to reject.
  // Must match contentLicenceClient.ts's own (deliberately un-exported) ASSET_FETCH_TIMEOUT_MS —
  // kept as a literal so this test also catches an accidental change to that value, same reasoning
  // readingSessionClient.test.ts's own REQUEST_TIMEOUT_MS literal uses.
  const ASSET_FETCH_TIMEOUT_MS = 60_000;

  it('rejects with DownloadFailure(ASSET_FETCH_FAILED) instead of hanging forever when the server accepts the connection and never answers', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const pending = fetchEncryptedAsset('book-001', 'http://x/f.enc');
    const assertion = expect(pending).rejects.toMatchObject({
      code: DownloadError.ASSET_FETCH_FAILED,
      bookId: 'book-001',
    });

    await jest.advanceTimersByTimeAsync(ASSET_FETCH_TIMEOUT_MS);
    await assertion;
    jest.useRealTimers();
  });

  // Regression test for the SECOND bug found in review: 8s (the metadata-call budget) used to be
  // reused here too, which would abort a legitimate, still-progressing download of a large book
  // well before it could finish. Proves the timer does NOT fire at the old, too-short value.
  it('does not time out at the old, too-short 8s metadata-call budget', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const pending = fetchEncryptedAsset('book-001', 'http://x/f.enc');
    let settled = false;
    pending.catch(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(8000);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(ASSET_FETCH_TIMEOUT_MS - 8000);
    await expect(pending).rejects.toMatchObject({ code: DownloadError.ASSET_FETCH_FAILED });
    jest.useRealTimers();
  });
});

// The mock backend hands back an ABSOLUTE http://localhost:4000/... encryptedFileUrl. On a real
// device that "localhost" is the DEVICE, not the machine running the backend, so the asset fetch
// would fail even though the content-licence request just succeeded via config.ts's resolved LAN
// host. Under Jest, API_BASE_URL resolves to localhost itself (no expo-constants hostUri), which
// would make the rewrite an unobservable no-op — so these two cases mock ./config to a LAN host,
// same jest.isolateModules pattern config.test.ts uses.
describe('fetchEncryptedAsset — localhost rewriting against API_BASE_URL', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.dontMock('./config');
    jest.resetModules();
  });

  const LAN_BASE_URL = 'http://192.168.1.20:4000';

  function loadClientWithLanBaseUrl(): typeof import('./contentLicenceClient') {
    let mod!: typeof import('./contentLicenceClient');
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('./config', () => ({ __esModule: true, API_BASE_URL: LAN_BASE_URL }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('./contentLicenceClient');
    });
    return mod;
  }

  it('rewrites a localhost encryptedFileUrl to API_BASE_URL’s host/port, keeping path and query', async () => {
    const client = loadClientWithLanBaseUrl();
    global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array([7, 8]), { status: 200 }));

    const bytes = await client.fetchEncryptedAsset('book-001', 'http://localhost:4000/fixtures/sample.epub.enc?v=2');

    expect(global.fetch).toHaveBeenCalledWith(
      `${LAN_BASE_URL}/fixtures/sample.epub.enc?v=2`,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(Array.from(bytes)).toEqual([7, 8]);
  });

  it('leaves a non-localhost (e.g. real CDN) url completely untouched', async () => {
    const client = loadClientWithLanBaseUrl();
    global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    const cdnUrl = 'https://cdn.example.com/fixtures/sample.epub.enc';
    await client.fetchEncryptedAsset('book-001', cdnUrl);

    expect(global.fetch).toHaveBeenCalledWith(cdnUrl, expect.objectContaining({ signal: expect.anything() }));
  });

  // Regression test: the rewrite used to copy only hostname/port from API_BASE_URL, leaving the
  // rewritten URL on whatever scheme the backend originally emitted for encryptedFileUrl
  // (always http). If API_BASE_URL itself is https (e.g. an https tunnel/proxy override via
  // EXPO_PUBLIC_MOCK_BACKEND_URL), the rewritten asset URL must follow API_BASE_URL's scheme too
  // — not silently stay on http.
  it("rewrites the scheme to match an https API_BASE_URL's protocol, not just its host/port", async () => {
    let mod!: typeof import('./contentLicenceClient');
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('./config', () => ({ __esModule: true, API_BASE_URL: 'https://192.168.1.20:4000' }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('./contentLicenceClient');
    });
    global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array([7, 8]), { status: 200 }));

    await mod.fetchEncryptedAsset('book-001', 'http://localhost:4000/fixtures/sample.epub.enc?v=2');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://192.168.1.20:4000/fixtures/sample.epub.enc?v=2',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
