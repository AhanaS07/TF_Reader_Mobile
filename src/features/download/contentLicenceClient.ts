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

export async function fetchEncryptedAsset(bookId: BookId, url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url);
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
