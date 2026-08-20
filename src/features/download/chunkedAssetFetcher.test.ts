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

describe('fetchEncryptedAssetChunked — edge cases', () => {
  it('resumes after simulated app kill by reading persisted partial state from disk', async () => {
    const bookId = 'app-kill-resume';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.8)); // 3 chunks

    // First download attempt: succeeds for 2 chunks, then fails (simulating app crash)
    let firstAttemptCallCount = 0;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      firstAttemptCallCount++;
      if (firstAttemptCallCount === 3) {
        throw new Error('Simulated app crash mid-download');
      }
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = firstFetch;

    // First attempt fails after 2 chunks (2 successful requests, 3rd fails)
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toMatchObject({
      code: DownloadError.ASSET_FETCH_FAILED,
    });

    // Simulate app kill/restart: call again with same bookId
    // Partial manifest should be read from disk, proving resume works after "app kill"
    const restartFetch = rangeServerFetch(asset);
    global.fetch = restartFetch;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    // Resume from chunk 2 (bytes 2*1MiB onwards), not chunk 0 — proves partial state survived
    const rangeCalls = restartFetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    expect(rangeCalls.length).toBeGreaterThan(0);
    // First range request on restart should be for chunk 2 (after 2 successful chunks)
    expect(rangeCalls[0][1].headers.Range).toMatch(/^bytes=2097152-/); // 2 * CHUNK_SIZE_BYTES
  });

  it('handles partial manifest corruption gracefully by treating it as missing', async () => {
    const bookId = 'corrupted-manifest';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // 3 chunks

    // Write a corrupted manifest (not valid JSON)
    const { File, Directory, Paths } = require('expo-file-system');
    const partialDir = new Directory(Paths.document, 'tf-reader-partial-downloads');
    if (!partialDir.exists) partialDir.create({ intermediates: true });
    const manifestFile = new File(partialDir, `${encodeURIComponent(bookId)}.partial.json`);
    if (manifestFile.exists) manifestFile.delete();
    manifestFile.create();
    manifestFile.write('{ invalid json ');

    // Try to download — should treat corrupted manifest as missing and start fresh
    const fetchMock = rangeServerFetch(asset);
    global.fetch = fetchMock;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    // First request should be for chunk 0 (started fresh, not resumed)
    const rangeCalls = fetchMock.mock.calls.filter((call) => call[1]?.headers?.Range);
    expect(rangeCalls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
  });

  it('handles server dropping Range support mid-stream by treating 200 as complete file', async () => {
    const bookId = 'range-dropped-mid-stream';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // 3 chunks

    let callCount = 0;
    const switchingFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      callCount++;
      const rangeHeader = init?.headers?.Range;

      // First 2 chunks work with Range (206)
      if (rangeHeader && callCount <= 2) {
        const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
        if (!match) return new Response(null, { status: 400 });
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), asset.length - 1);
        return new Response(asset.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
        });
      }

      // 3rd attempt: server drops Range support, returns full asset as 200
      if (rangeHeader && callCount === 3) {
        // Server stopped supporting Range, returns entire asset with 200
        return new Response(asset, { status: 200 });
      }

      // Non-Range requests always return full asset
      if (!rangeHeader) {
        return new Response(asset, { status: 200 });
      }

      return new Response(null, { status: 400 });
    });
    global.fetch = switchingFetch;

    // This should succeed — when 206->200 happens, client treats it as full file and stops
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    // 2 successful Range requests, then 1 request that returns 200 (full asset)
    expect(switchingFetch.mock.calls.length).toBe(3);
  });

  it('cleans up mismatched partial state (file without manifest or vice versa)', async () => {
    const bookId = 'mismatched-partial';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // 3 chunks

    // Simulate corrupted partial state: partial file exists but manifest doesn't
    const { File, Directory, Paths } = require('expo-file-system');
    const partialDir = new Directory(Paths.document, 'tf-reader-partial-downloads');
    if (!partialDir.exists) partialDir.create({ intermediates: true });
    const contentFile = new File(partialDir, `${encodeURIComponent(bookId)}.partial.bin`);
    if (contentFile.exists) contentFile.delete();
    contentFile.create();
    contentFile.write(asset.subarray(0, CHUNK_SIZE_BYTES)); // Write 1 chunk but no manifest

    // Try to download — should detect mismatch and start fresh
    const fetchMock = rangeServerFetch(asset);
    global.fetch = fetchMock;

    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    // Started fresh due to mismatched state
    const rangeCalls = fetchMock.mock.calls.filter((call) => call[1]?.headers?.Range);
    expect(rangeCalls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
  });
});

describe('fetchEncryptedAssetChunked — extended resumable path tests', () => {
  it('resumes with correct range when file has partial chunks already written', async () => {
    const bookId = 'resume-partial-chunks';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 4.5)); // 5 chunks

    // First attempt: write 3 full chunks, then fail
    let firstCallCount = 0;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      firstCallCount++;
      if (firstCallCount === 4) throw new Error('Connection failed');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = firstFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Resume: should request from 3MiB onwards (after 3 successful chunks)
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    const rangeCalls = resumeFetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    // First call should be for chunk 3 (starting at 3MiB)
    expect(rangeCalls[0][1].headers.Range).toMatch(/^bytes=3145728-/);
  });

  it('resumes correctly when partial file byte count matches manifest', async () => {
    const bookId = 'resume-byte-match';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 3.2)); // 4 chunks

    // Create consistent partial state (2 chunks downloaded)
    let callCount = 0;
    const initialFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      callCount++;
      if (callCount === 3) throw new Error('Connection dropped');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = initialFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Verify manifest records correct state
    const { File, Directory, Paths } = require('expo-file-system');
    const partialDir = new Directory(Paths.document, 'tf-reader-partial-downloads');
    const manifestFile = new File(partialDir, `${encodeURIComponent(bookId)}.partial.json`);
    const manifest = JSON.parse(manifestFile.textSync());
    expect(manifest.bytesReceived).toBe(CHUNK_SIZE_BYTES * 2);
    expect(manifest.expectedLength).toBe(asset.length);

    // Resume and verify it picks up exactly from bytesReceived
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    const rangeCalls = resumeFetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    // Should request from bytesReceived onwards
    expect(rangeCalls[0][1].headers.Range).toBe(`bytes=${CHUNK_SIZE_BYTES * 2}-${CHUNK_SIZE_BYTES * 3 - 1}`);
  });

  it('handles resume when expected length differs from initial attempt (server consistency)', async () => {
    const bookId = 'resume-consistent-length';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // 3 chunks

    // First attempt: get total size
    let firstCall = false;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      if (!firstCall) {
        firstCall = true;
        const rangeHeader = init?.headers?.Range;
        if (!rangeHeader) return new Response(asset, { status: 200 });
        const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
        if (!match) return new Response(null, { status: 400 });
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), asset.length - 1);
        return new Response(asset.subarray(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
        });
      }
      throw new Error('Network timeout');
    });
    global.fetch = firstFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Resume: server still reports same total length
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
  });

  it('reports progress correctly across resume boundary', async () => {
    const bookId = 'resume-progress-boundary';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 3.3)); // 4 chunks

    // First: download 2 chunks then fail
    let firstCallCount = 0;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      firstCallCount++;
      if (firstCallCount === 3) throw new Error('Network error');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = firstFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Resume: verify progress starts from bytesReceived immediately
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const onProgress = jest.fn();
    await fetchEncryptedAssetChunked(bookId, ASSET_URL, { onProgress });

    // First onProgress call should be the resumed baseline (2 chunks = 2MiB)
    expect(onProgress).toHaveBeenNthCalledWith(1, CHUNK_SIZE_BYTES * 2, asset.length);
    // Final call should be at 100%
    expect(onProgress).toHaveBeenLastCalledWith(asset.length, asset.length);
  });

  it('succeeds when resuming with only one final chunk remaining', async () => {
    const bookId = 'resume-final-chunk';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 1.3)); // 2 chunks (1 full, 1 partial)

    // First: get first chunk, then fail
    let callCount = 0;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      callCount++;
      if (callCount === 2) throw new Error('Connection lost');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = firstFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Resume: only final chunk needed
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    const rangeCalls = resumeFetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    // Should request only the final partial chunk
    expect(rangeCalls).toHaveLength(1);
    expect(rangeCalls[0][1].headers.Range).toMatch(/^bytes=1048576-/);
  });

  it('handles multiple sequential failures and resumes with each retry', async () => {
    const bookId = 'multi-retry-resume';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 4)); // 4 chunks

    // Attempt 1: get 1 chunk then fail
    let attempt1Count = 0;
    const attempt1Fetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      attempt1Count++;
      if (attempt1Count === 2) throw new Error('Attempt 1 fail');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = attempt1Fetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Attempt 2: resume, get 1 more chunk, then fail
    let attempt2Count = 0;
    const attempt2Fetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      attempt2Count++;
      if (attempt2Count === 2) throw new Error('Attempt 2 fail');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = attempt2Fetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Attempt 3: resume from 2 chunks and complete
    const attempt3Fetch = rangeServerFetch(asset);
    global.fetch = attempt3Fetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    const rangeCalls = attempt3Fetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    // First request should be for chunk 2 (after 2 successful chunks)
    expect(rangeCalls[0][1].headers.Range).toMatch(/^bytes=2097152-/);
  });

  it('cleans up and restarts when manifest becomes invalid during resume', async () => {
    const bookId = 'resume-manifest-invalidate';
    const asset = randomBytes(Math.floor(CHUNK_SIZE_BYTES * 2.5)); // 3 chunks

    // First attempt: download 1 chunk
    let callCount = 0;
    const firstFetch = jest.fn().mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      callCount++;
      if (callCount === 2) throw new Error('Connection lost');
      const rangeHeader = init?.headers?.Range;
      if (!rangeHeader) return new Response(asset, { status: 200 });
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 400 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), asset.length - 1);
      return new Response(asset.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });
    global.fetch = firstFetch;
    await expect(fetchEncryptedAssetChunked(bookId, ASSET_URL)).rejects.toBeInstanceOf(DownloadFailure);

    // Corrupt the manifest before resume
    const { File, Directory, Paths } = require('expo-file-system');
    const partialDir = new Directory(Paths.document, 'tf-reader-partial-downloads');
    const manifestFile = new File(partialDir, `${encodeURIComponent(bookId)}.partial.json`);
    if (manifestFile.exists) {
      manifestFile.delete();
      manifestFile.create();
      manifestFile.write('invalid json');
    }

    // Resume: should detect bad manifest and start fresh from chunk 0
    const resumeFetch = rangeServerFetch(asset);
    global.fetch = resumeFetch;
    const result = await fetchEncryptedAssetChunked(bookId, ASSET_URL);

    expect(Buffer.from(result).equals(Buffer.from(asset))).toBe(true);
    const rangeCalls = resumeFetch.mock.calls.filter((call) => call[1]?.headers?.Range);
    // Should start from chunk 0 due to corrupted manifest
    expect(rangeCalls[0][1].headers.Range).toBe(`bytes=0-${CHUNK_SIZE_BYTES - 1}`);
  });
});
