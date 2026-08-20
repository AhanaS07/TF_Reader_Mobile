// Exercises chunkedAssetFetcher.ts against a fake range-serving fetch — mirrors what we verified
// empirically against the REAL mock-backend (express.static honours Range with 206 + Content-Range
// out of the box, see docs/superpowers/specs/2026-08-17-resumable-chunked-download-scoping.md).
// This file's own job is the client-side chunking/resume/budget logic, not re-proving Range
// support exists on the server — that's already confirmed live.

import { CHUNK_SIZE_BYTES, fetchEncryptedAssetChunked, discardPartialDownload } from './chunkedAssetFetcher';
import { DownloadError, DownloadFailure } from './errors';

const ASSET_URL = 'http://localhost:4000/fixtures/book.epub.enc';

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 256;
  return out;
}

/** A fetch mock that behaves like a real Range-capable static file server for `asset`. */
function rangeServerFetch(asset: Uint8Array<ArrayBuffer>): jest.Mock {
  return jest.fn().mockImplementation(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const rangeHeader = init?.headers?.Range;
    if (!rangeHeader) {
      return new Response(asset, { status: 200 });
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      return new Response(null, { status: 400 });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), asset.length - 1);
    const slice = asset.subarray(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
    });
  });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('fetchEncryptedAssetChunked — happy path', () => {
  it('downloads a multi-chunk asset in 1 MiB slices and assembles it byte-for-byte', async () => {
    const bookId = 'chunked-happy-1';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // forces 3 chunks
    const fetchMock = rangeServerFetch(asset);
    global.fetch = fetchMock;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Confirms actual chunking happened, not one big request — the whole point of this feature.
    expect(fetchMock.mock.calls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
    expect(fetchMock.mock.calls[1][1].headers.Range).toBe(
      `bytes=${CHUNK_SIZE_BYTES}-${CHUNK_SIZE_BYTES * 2 - 1}`,
    );
  });

  it('cleans up partial state on success — nothing lingers for the next call to misread', async () => {
    const bookId = 'chunked-happy-cleanup';
    const asset = randomBytes(CHUNK_SIZE_BYTES + 100);
    global.fetch = rangeServerFetch(asset);

    await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    // Re-running from scratch must behave identically — proves no partial file/manifest survived.
    const fetchMock2 = rangeServerFetch(asset);
    global.fetch = fetchMock2;
    const result2 = await fetchEncryptedAssetChunked(bookId, ASSET_URL);
    expect(Buffer.from(result2).equals(Buffer.from(asset))).toBe(true);
    expect(fetchMock2.mock.calls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
  });

  it('reports progress after every chunk with the running total', async () => {
    const bookId = 'chunked-progress';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.2));
    global.fetch = rangeServerFetch(asset);
    const onProgress = jest.fn();

    await fetchEncryptedAssetChunked(bookId, ASSET_URL, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, CHUNK_SIZE_BYTES, asset.length);
    expect(onProgress).toHaveBeenNthCalledWith(3, asset.length, asset.length);
  });

  it('falls back cleanly when the server ignores Range entirely (200, not 206)', async () => {
    const bookId = 'chunked-no-range-support';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 1.5));
    // Always 200 with the full body, regardless of the Range header sent.
    const fetchMock = jest.fn().mockResolvedValue(new Response(asset, { status: 200 }));
    global.fetch = fetchMock;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one request, whole body, no further chunk requests
  });

  it('still reports onProgress once, at 100%, on the no-Range fallback path', async () => {
    const bookId = 'chunked-no-range-progress';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 1.5));
    const fetchMock = jest.fn().mockResolvedValue(new Response(asset, { status: 200 }));
    global.fetch = fetchMock;
    const onProgress = jest.fn();

    await fetchEncryptedAssetChunked(bookId, ASSET_URL, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(asset.length, asset.length);
  });
});

describe('fetchEncryptedAssetChunked — resume after an interruption', () => {
  it('resumes from bytesReceived instead of restarting after a mid-download failure', async () => {
    const bookId = 'chunked-resume-1';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 3.3)); // 4 chunks

    // First attempt: chunks 1-2 succeed, chunk 3 fails (simulated dropped connection).
    let callCount = 0;
    const failingFetch = jest.fn().mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => {
      callCount++;
      if (callCount === 3) {
        throw new TypeError('Network request failed');
      }
      const [, startStr, endStr] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!;
      const start = Number(startStr);
      const end = Math.min(Number(endStr), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = failingFetch;

    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);
    expect(failingFetch).toHaveBeenCalledTimes(3);

    // Second attempt, fresh fetch mock: must resume from 2 chunks in, not from 0.
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    // Only the remaining chunks were re-requested — proves it resumed, not restarted.
    expect(resumeFetch).toHaveBeenCalledTimes(2);
    expect(resumeFetch.mock.calls[0][1].headers.Range).toBe(
      `bytes=${CHUNK_SIZE_BYTES * 2}-${CHUNK_SIZE_BYTES * 3 - 1}`,
    );
  });

  it('reports the resumed baseline via onProgress immediately, before any new chunk lands', async () => {
    const bookId = 'chunked-resume-progress';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 3.3)); // 4 chunks

    let callCount = 0;
    const failingFetch = jest.fn().mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => {
      callCount++;
      if (callCount === 3) {
        throw new TypeError('Network request failed');
      }
      const [, startStr, endStr] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!;
      const start = Number(startStr);
      const end = Math.min(Number(endStr), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = failingFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Resume: onProgress's FIRST call on this attempt must be the already-known baseline
    // (2 chunks in), not wait for a new chunk to land.
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const onProgress = jest.fn();

    await fetchEncryptedAssetChunked(bookId, ASSET_URL, { onProgress });

    expect(onProgress).toHaveBeenNthCalledWith(1, CHUNK_SIZE_BYTES * 2, asset.length);
  });

  it('discardPartialDownload lets a caller give up for good — the next call starts from 0', async () => {
    const bookId = 'chunked-discard';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5));

    let callCount = 0;
    const failingFetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(asset.subarray(0, CHUNK_SIZE_BYTES), {
          status: 206,
          headers: { 'Content-Range': `bytes 0-${CHUNK_SIZE_BYTES - 1}/${asset.length}` },
        });
      }
      throw new TypeError('Network request failed');
    });
    global.fetch = failingFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    discardPartialDownload(bookId);

    const freshFetch = rangeServerFetch(asset);
    global.fetch = freshFetch;
    await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(freshFetch.mock.calls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
  });
});

describe('fetchEncryptedAssetChunked — maxBytes budget (RAM guard)', () => {
  it('rejects with BOOK_TOO_LARGE as soon as the total is known, before downloading further chunks', async () => {
    const bookId = 'chunked-too-large';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 5)); // 5 chunks if it were allowed to run
    const fetchMock = rangeServerFetch(asset);
    global.fetch = fetchMock;

    await expect(
      fetchEncryptedAssetChunked(bookId, ASSET_URL, { maxBytes: CHUNK_SIZE_BYTES }),
    ).rejects.toMatchObject({ code: DownloadError.BOOK_TOO_LARGE, bookId });

    // The budget is known after the FIRST chunk's Content-Range — must stop there, not fetch all 5.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-checks the budget immediately on a resume, before re-requesting anything', async () => {
    const bookId = 'chunked-too-large-resume';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 3));

    // Build up real partial state under a budget that would have allowed it (no maxBytes).
    let callCount = 0;
    const partialFetch = jest.fn().mockImplementation(async (_url: string, init: { headers: Record<string, string> }) => {
      callCount++;
      if (callCount === 2) throw new TypeError('Network request failed');
      const [, startStr, endStr] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!;
      const start = Number(startStr);
      const end = Math.min(Number(endStr), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = partialFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Now resume, but this time under a budget the already-known total exceeds.
    const resumeFetch = jest.fn();
    global.fetch = resumeFetch;

    await expect(
      fetchEncryptedAssetChunked(bookId, ASSET_URL, { maxBytes: CHUNK_SIZE_BYTES }),
    ).rejects.toMatchObject({ code: DownloadError.BOOK_TOO_LARGE, bookId });

    // Rejected purely from the manifest's remembered total — no network call needed to know it.
    expect(resumeFetch).not.toHaveBeenCalled();
  });
});
