// Owner: Download (Abhinav).
//
// "Resolve encrypted asset by Book ID" — BuildPlan.md Phase 4 item 3: "Hit the content/licence
// endpoint; receive encrypted file + wrapped BEK + licence + validity dates." Two steps because
// the licence response only carries a URL (encryptedFileUrl) to the actual bytes, not the bytes
// themselves — mock-backend serves the fixture separately under /fixtures/*.enc (see
// mock-backend/server.js and mock-backend/routes/contentLicence.js).
//
// Both functions throw DownloadFailure, never a bare fetch/TypeError — downloadManager.ts (and
// any future caller) can switch on `.code` without also handling raw network exceptions.

import type { BookId, ContentLicenceResponse } from '@/shared/contracts';
import { API_BASE_URL } from './config';
import { DownloadError, DownloadFailure } from './errors';

export async function fetchContentLicence(bookId: BookId): Promise<ContentLicenceResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/books/${encodeURIComponent(bookId)}/content-licence`);
  } catch (cause) {
    throw new DownloadFailure(DownloadError.LICENCE_FETCH_FAILED, bookId, cause);
  }
  if (!response.ok) {
    throw new DownloadFailure(
      DownloadError.LICENCE_FETCH_FAILED,
      bookId,
      new Error(`content-licence responded ${response.status}`),
    );
  }
  return (await response.json()) as ContentLicenceResponse;
}

/**
 * `encryptedFileUrl` is an ABSOLUTE url the backend chose, and the mock backend always emits
 * `http://localhost:4000/...` for it. "localhost" is resolved by whoever fetches it — on a
 * physical device or a simulator that isn't the machine running the mock backend, that's the
 * DEVICE, and the fetch fails. config.ts already went to the trouble of resolving a LAN-reachable
 * host for `API_BASE_URL` (the content-licence request that produced this url succeeded via it),
 * so reuse that host here: same path and query, the host/port that actually answered.
 *
 * Any other host is left completely alone — a real CDN url must not be rewritten.
 */
function reachableAssetUrl(url: string): string {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(API_BASE_URL);
  } catch {
    // Not something the URL parser understands — hand it to fetch verbatim and let fetch's own
    // error be the one the caller sees, rather than inventing a different failure here.
    return url;
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return url;
  }
  if (base.hostname === parsed.hostname && base.port === parsed.port) {
    return url; // API_BASE_URL is itself localhost (e.g. a simulator on the dev machine) — no-op.
  }
  parsed.hostname = base.hostname;
  parsed.port = base.port;
  return parsed.toString();
}

export async function fetchEncryptedAsset(bookId: BookId, url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(reachableAssetUrl(url));
  } catch (cause) {
    throw new DownloadFailure(DownloadError.ASSET_FETCH_FAILED, bookId, cause);
  }
  if (!response.ok) {
    throw new DownloadFailure(
      DownloadError.ASSET_FETCH_FAILED,
      bookId,
      new Error(`encrypted asset fetch responded ${response.status}`),
    );
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
