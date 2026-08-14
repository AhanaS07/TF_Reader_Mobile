// WORKAROUND — pending Search (Vaishnavi) sign-off. Not a final design decision.
//
// Written by Abhinav (Encryption), but lives here in src/features/search/ because it implements
// this feature's own frozen contract type, and contentProvider.ts's own comment already says so:
// "decoding [getIndex's bytes] into a BookSearchIndex and running queryIndex() is Search's own
// job, not Encryption's." This is a NEW file — nothing of Search's own existing code was edited
// to add it — per CLAUDE.md's rule to flag before touching another team's area.
//
// The gap this closes: `getIndex` (Encryption, async, returns Bytes) and `queryIndex` (Search,
// sync, consumes an already-decoded BookSearchIndex) existed as two disconnected islands. Nothing
// in the repo satisfied the frozen `QueryIndex = (bookId, term) => Promise<SearchHit[]>` end to
// end — a silent gap, not a loud one: nothing throws "unimplemented," the function just didn't
// exist. See queryBookIndex.test.ts for a test that documents that gap directly.
//
// Provisional and needs review before this is load-bearing: the wire format assumed below (index
// bytes = UTF-8 JSON of a BookSearchIndex) is inherited from mockSearchIndex.ts's fixture
// convention, which is an Encryption-owned MOCK, not Search's real server-side encode path. If
// Search's real index builder picks a different wire format, only this decode step needs to
// change — nothing downstream of `queryIndex()` does.

import type { BookSearchIndex, QueryIndex, SearchHit } from '@/shared/contracts';
import { getIndex } from '@/features/encryption/contentProvider';
import { utf8Decode } from '@/features/encryption/utf8';
import { queryIndex } from './queryIndex';

export const queryBookIndex: QueryIndex = async (bookId, term): Promise<SearchHit[]> => {
  const bytes = await getIndex(bookId);
  if (!bytes) return [];

  const index = JSON.parse(utf8Decode(bytes)) as BookSearchIndex;
  return queryIndex(index, term);
};
