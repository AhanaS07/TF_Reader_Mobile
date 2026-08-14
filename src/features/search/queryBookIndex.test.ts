// Before queryBookIndex.ts existed, nothing in the repo satisfied the frozen
// `QueryIndex = (bookId, term) => Promise<SearchHit[]>` contract end to end: `getIndex`
// (Encryption, returns Bytes) and `queryIndex` (Search, consumes an already-decoded
// BookSearchIndex) were two disconnected islands — confirmed by grepping the repo for any
// function bridging them; there was none. This file tests the bridge that closes that gap, with
// `getIndex` faked at the contentProvider boundary (its own real behavior — session/decrypt — is
// contentProvider.test.ts's job, not this bridge's).

import type { BookSearchIndex, SearchHit } from '@/shared/contracts';
import { utf8Encode } from '@/features/encryption/utf8';
import { queryBookIndex } from './queryBookIndex';

jest.mock('@/features/encryption/contentProvider', () => ({
  __esModule: true,
  getIndex: jest.fn(),
}));

const { getIndex } = jest.requireMock('@/features/encryption/contentProvider') as {
  getIndex: jest.Mock;
};

function indexBytesFor(index: BookSearchIndex): Uint8Array {
  return utf8Encode(JSON.stringify(index));
}

describe('queryBookIndex — bridges getIndex (Bytes) to queryIndex (BookSearchIndex)', () => {
  beforeEach(() => {
    getIndex.mockReset();
  });

  it('decodes getIndex bytes and returns queryIndex hits for a matching term', async () => {
    const bookId = 'book-1';
    const index: BookSearchIndex = {
      bookId,
      format: 'EPUB',
      version: 1,
      index: {
        hello: [{ chapterId: 'chapter-1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2!/4/2:0)' }, snippet: 'hello there' }],
      },
    };
    getIndex.mockResolvedValue(indexBytesFor(index));

    const hits: SearchHit[] = await queryBookIndex(bookId, 'hello');

    expect(getIndex).toHaveBeenCalledWith(bookId);
    expect(hits).toEqual([
      { bookId, chapterId: 'chapter-1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2!/4/2:0)' }, snippet: 'hello there' },
    ]);
  });

  it('returns [] without calling queryIndex\'s decode path when getIndex resolves to null (book has no index)', async () => {
    getIndex.mockResolvedValue(null);

    expect(await queryBookIndex('book-no-index', 'hello')).toEqual([]);
  });

  it('returns [] for a term with no matching postings', async () => {
    const index: BookSearchIndex = { bookId: 'book-1', format: 'EPUB', version: 1, index: {} };
    getIndex.mockResolvedValue(indexBytesFor(index));

    expect(await queryBookIndex('book-1', 'nothing')).toEqual([]);
  });

  it('round-trips a non-ASCII snippet — the exact failure mode the ASCII-only codec had (curly apostrophe, accented name)', async () => {
    const bookId = 'book-1';
    const snippet = "Bernard’s café — hello there";
    const index: BookSearchIndex = {
      bookId,
      format: 'EPUB',
      version: 1,
      index: {
        hello: [{ chapterId: 'chapter-1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2!/4/2:0)' }, snippet }],
      },
    };
    getIndex.mockResolvedValue(indexBytesFor(index));

    const hits = await queryBookIndex(bookId, 'hello');

    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe(snippet);
  });

  it('throws on a wrong-book index (getIndex handed back the wrong ciphertext)', async () => {
    const index: BookSearchIndex = {
      bookId: 'some-other-book',
      format: 'EPUB',
      version: 1,
      index: {
        hello: [{ chapterId: 'chapter-1', locator: { type: 'EPUB', cfi: 'epubcfi(/6/2!/4/2:0)' }, snippet: 'hello there' }],
      },
    };
    getIndex.mockResolvedValue(indexBytesFor(index));

    await expect(queryBookIndex('book-1', 'hello')).rejects.toThrow(/does not match requested/);
  });

  it('wraps a decode/parse failure with the requested bookId', async () => {
    getIndex.mockResolvedValue(utf8Encode('{ not valid json'));

    await expect(queryBookIndex('book-1', 'hello')).rejects.toThrow(
      /failed to decode search index for "book-1"/,
    );
  });
});
