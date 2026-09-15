// Owner: Reader (Ahana).
//
// WHY THIS FILE IS IN reader/ AND NOT personalization/: it does not test Reader code. It tests the
// guarantee Reader's six highlight/bookmark call-sites depend on and cannot themselves provide —
// that saving an annotation persists it SOMEWHERE durable.
//
// THE GUARANTEE: `readerHighlights.ts` / `readerBookmarks.ts` write straight to the offline store
// (`highlightStore`/`bookmarkStore` -> `syncableTable.saveLocal`, which persists a `synced: 0` SQLite
// row AND enqueues the outbox in one transaction), then nudge a sync (`pushNow`). So a write survives
// locally whatever the network is doing, and the sync engine pushes it on the next drain. There is no
// branch that reaches the backend without first writing SQLite — which is exactly what a short-lived
// online-vs-offline router once did, losing an online-but-unreachable write entirely (see git history:
// the `annotationsRouter.ts` era, reverted). This file pins that the local-first path is back.
//
// The stores are mocked (the seam under test is the facade -> store call, not the DB), and the sync
// engine is mocked so `pushNow` neither hits the real DB nor makes a network call.

import { addCurrentEpubBookmark, loadBookmarks } from '@/features/personalization/readerBookmarks';
import {
  addEpubHighlight,
  loadReaderHighlights,
  removeHighlight,
} from '@/features/personalization/readerHighlights';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { highlightStore } from '@/features/sync/stores/highlightStore';

jest.mock('@/features/sync/syncEngine', () => ({
  syncEngine: { run: jest.fn(), pullBook: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@/features/sync/stores/highlightStore', () => ({
  ...jest.requireActual<typeof import('@/features/sync/stores/highlightStore')>(
    '@/features/sync/stores/highlightStore',
  ),
  highlightStore: {
    list: jest.fn().mockResolvedValue([]),
    addFromCfi: jest.fn().mockResolvedValue({}),
    addFromSelection: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/features/sync/stores/bookmarkStore', () => ({
  ...jest.requireActual<typeof import('@/features/sync/stores/bookmarkStore')>(
    '@/features/sync/stores/bookmarkStore',
  ),
  bookmarkStore: {
    list: jest.fn().mockResolvedValue([]),
    addForCfi: jest.fn().mockResolvedValue({}),
    addForPage: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue({}),
  },
}));

const hlStore = highlightStore as unknown as Record<string, jest.Mock>;
const bmStore = bookmarkStore as unknown as Record<string, jest.Mock>;

const BOOK = 'book-under-test';
const START_CFI = 'epubcfi(/6/4[chap01]!/4/2/2/1:0)';
const END_CFI = 'epubcfi(/6/4[chap01]!/4/2/6/1:10)';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('annotation writes always reach the durable store', () => {
  it('a highlight add persists via the store (which enqueues the outbox) and returns the fresh set', async () => {
    await expect(addEpubHighlight(BOOK, START_CFI, END_CFI)).resolves.toEqual(
      expect.objectContaining({ highlights: expect.anything() }),
    );
    expect(hlStore.addFromCfi).toHaveBeenCalledWith(START_CFI, END_CFI, undefined, BOOK);
  });

  it('a highlight load reads the local snapshot', async () => {
    await expect(loadReaderHighlights(BOOK)).resolves.toEqual({
      highlights: { epub: [], pdf: [] },
      skippedIds: [],
    });
    expect(hlStore.list).toHaveBeenCalled();
  });

  it('a highlight delete goes to the store by id', async () => {
    await expect(removeHighlight(BOOK, 'h1')).resolves.toBeDefined();
    expect(hlStore.remove).toHaveBeenCalledWith('h1');
  });

  it('a bookmark add persists via the store', async () => {
    await expect(
      addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'A label'),
    ).resolves.toBeDefined();
    expect(bmStore.addForCfi).toHaveBeenCalled();
  });

  it('a bookmark load reads the local snapshot', async () => {
    await expect(loadBookmarks(BOOK)).resolves.toBeDefined();
    expect(bmStore.list).toHaveBeenCalled();
  });
});
