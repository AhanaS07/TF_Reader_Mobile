// Owner: Encryption (Abhinav). Test/fixture support — NOT the real index builder.
//
// Search's own frozen contract (src/shared/contracts/search.ts) is explicit about ownership and
// pipeline: "Owner: Search (Vaishnavi)... Build the per-book index from plaintext. Runs
// SERVER-SIDE at ingestion... encrypt index AES-GCM under the SAME BEK as the book -> ship it
// BUNDLED with the encrypted book. At download, Abhinav's decrypt pass decrypts the whole book
// AND the whole index in one go."
//
// This file supplies the "encrypt index under the SAME BEK, own nonce, bundled" half of that
// pipeline with a MOCK index, so contentStore.ts's decrypt-the-index path (decryptSearchIndex)
// has something real to decrypt in tests, without waiting on Vaishnavi's real word-extraction
// logic. `createMockSearchIndex` is typed exactly as Search's own frozen `BuildIndex` signature —
// a real implementation is a drop-in replacement for this mock, nothing downstream needs to
// change shape.
//
// Serialization: BookSearchIndex -> JSON -> bytes -> AES-256-GCM (this module's own `encrypt`,
// the same primitive aesGcm.ts uses for book content) -> the nonce(12)||ciphertext||tag(16) shape
// EncryptedPackage.index expects. String<->bytes uses a plain ASCII codec, not TextEncoder/
// TextDecoder — this codebase has been burned twice by assuming an RN-runtime global exists
// without on-device confirmation (Buffer, in both aesGcm.ts's and keyStorage.ts's early
// versions — see docs/build-status.md). The mock index's own content (English words, chapter
// ids, snippets) is ASCII-only by construction, so this is a safe, deliberately narrow
// alternative, not a general-purpose UTF-8 codec.

import type { BookSearchIndex, BuildIndex, Locator, Posting, SearchIndex } from '@/shared/contracts';
import { encrypt } from './aesGcm';

function asciiEncode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(`asciiEncode: non-ASCII character at index ${i} (code ${code}) — mock index content must be ASCII`);
    }
    bytes[i] = code;
  }
  return bytes;
}

function asciiDecode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function mockPosting(chapterId: string, format: 'EPUB' | 'PDF', position: number, snippet: string): Posting {
  const locator: Locator =
    format === 'EPUB'
      ? { type: 'EPUB', cfi: `epubcfi(/6/${position * 2}!/4/${position}:0)` }
      : { type: 'PDF', page: position };
  return { chapterId, locator, snippet };
}

/**
 * Builds a small, fake-but-realistic BookSearchIndex — a handful of words, a few postings each,
 * matching the exact frozen `SearchIndex`/`Posting`/`Locator` shapes. Typed as `BuildIndex`
 * itself (src/shared/contracts/search.ts) so this is a genuine drop-in stand-in for the real
 * (server-side, real word-extraction) builder, not just a same-shaped lookalike.
 *
 * NOT the real index builder — Search (Vaishnavi) owns that. This exists so Encryption's
 * index-encrypt/decrypt path has a real, structured fixture to test against.
 */
export const createMockSearchIndex: BuildIndex = async (bookId) => {
  const format: BookSearchIndex['format'] = 'EPUB';

  const index: SearchIndex = {
    book: [
      mockPosting('chapter-1', format, 1, 'the first book of its kind'),
      mockPosting('chapter-3', format, 7, 'closed the book and sighed'),
    ],
    mock: [mockPosting('chapter-1', format, 2, 'this is a mock index entry')],
    search: [
      mockPosting('chapter-2', format, 4, 'a search for meaning'),
      mockPosting('chapter-4', format, 9, 'search results appeared instantly'),
    ],
    chapter: [mockPosting('chapter-2', format, 5, 'the chapter ended abruptly')],
  };

  const bookSearchIndex: BookSearchIndex = { bookId, format, version: 1, index };
  return bookSearchIndex;
};

/**
 * Builds a mock index for `bookId` and encrypts it under `bek` (the SAME BEK as the book,
 * per search.ts's contract), returning the exact `nonce(12)||ciphertext||tag(16)` shape
 * `EncryptedPackage.index` expects — its OWN nonce, independent of the book content's.
 */
export async function encryptMockSearchIndex(bookId: string, bek: Uint8Array): Promise<Uint8Array> {
  const mockIndex = await createMockSearchIndex(bookId);
  const plaintext = asciiEncode(JSON.stringify(mockIndex));
  const payload = await encrypt(plaintext, bek);
  return payload.content;
}

/**
 * Inverse of the encoding step above: turns decrypted index bytes (whatever
 * `contentStore.decryptSearchIndex` returns) back into a structured `BookSearchIndex`. A real
 * consumer (Search) would do this decode itself against real index bytes — provided here mainly
 * so tests can assert on structure, not just byte-equality.
 */
export function decodeSearchIndex(bytes: Uint8Array): BookSearchIndex {
  return JSON.parse(asciiDecode(bytes)) as BookSearchIndex;
}
