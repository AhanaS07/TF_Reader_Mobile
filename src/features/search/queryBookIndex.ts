// Owner: Search (Vaishnavi). Originally drafted by Abhinav (Encryption) as the getIndex↔queryIndex
// bridge; reviewed, hardened, and adopted by Search as the real implementation of the frozen
// `QueryIndex = (bookId, term) => Promise<SearchHit[]>` (src/shared/contracts/search.ts).
//
// The gap it closes: `getIndex` (Encryption, async, returns Bytes) and `queryIndex` (Search, sync,
// consumes an already-decoded BookSearchIndex) were two disconnected islands — nothing satisfied
// the frozen QueryIndex end to end. This is that bridge: fetch → decode → parse → query.
//
// PROVISIONAL wire format: index bytes = UTF-8 JSON of a BookSearchIndex, inherited from
// mockSearchIndex.ts's fixture convention (an Encryption-owned MOCK, not Search's real server-side
// encode path). If the real index builder picks a different wire format, ONLY the decode+parse step
// below changes — nothing downstream of queryIndex() does.

import type { BookSearchIndex, QueryIndex, SearchHit } from '@/shared/contracts';
import { getIndex } from '@/features/encryption/contentProvider';
import { utf8Decode } from '@/features/encryption/utf8';
import { queryIndex } from './queryIndex';

export const queryBookIndex: QueryIndex = async (bookId, term): Promise<SearchHit[]> => {
  const bytes = await getIndex(bookId);
  if (!bytes) return []; // book ships no index → same empty result as "index with no matches"

  // Decode+parse failures carry the bookId: a bare JSON.parse SyntaxError ("Unexpected token")
  // gives no clue which book's index was corrupt.
  let index: BookSearchIndex;
  try {
    index = JSON.parse(utf8Decode(bytes)) as BookSearchIndex;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`queryBookIndex: failed to decode search index for "${bookId}" — ${message}`);
  }

  // Fail loud on a wrong-book index: getIndex is keyed by bookId, so a mismatch means the wrong
  // ciphertext was decrypted/handed over — a wiring bug that would otherwise silently return
  // another book's hits.
  if (index.bookId !== bookId) {
    throw new Error(`queryBookIndex: index bookId "${index.bookId}" does not match requested "${bookId}"`);
  }

  return queryIndex(index, term);
};
