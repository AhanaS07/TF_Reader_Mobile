// Tests for annotationsRouter.ts — the online/offline routing seam. It stores nothing itself; it
// delegates to Karthik's Mongo endpoint (`api`) when online and his offline stores when offline.
// So these mock BOTH of his surfaces and assert the router calls the right one — online → api, store
// untouched; offline → store, api untouched.

import NetInfo from '@react-native-community/netinfo';

import { api } from '@/features/sync/syncApi';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { highlightStore } from '@/features/sync/stores/highlightStore';

import { annotationsRouter } from './annotationsRouter';

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@/features/sync/syncApi', () => ({
  api: {
    create: jest.fn().mockResolvedValue({ data: {}, serverTime: '' }),
    update: jest.fn().mockResolvedValue({ data: {}, serverTime: '' }),
    remove: jest.fn().mockResolvedValue({ data: {}, serverTime: '' }),
    findById: jest.fn().mockResolvedValue({ data: { id: 'b1', name: 'Old' }, serverTime: '' }),
    list: jest.fn().mockResolvedValue({ data: [], serverTime: '' }),
  },
}));
jest.mock('@/features/sync/stores/bookmarkStore', () => ({
  bookmarkStore: {
    list: jest.fn().mockResolvedValue([]),
    addForCfi: jest.fn().mockResolvedValue({}),
    addForPage: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('@/features/sync/stores/highlightStore', () => ({
  highlightStore: {
    list: jest.fn().mockResolvedValue([]),
    addFromCfi: jest.fn().mockResolvedValue({}),
    addFromSelection: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

const netFetch = (NetInfo as unknown as { fetch: jest.Mock }).fetch;
const apiMock = api as unknown as Record<string, jest.Mock>;
const bmStore = bookmarkStore as unknown as Record<string, jest.Mock>;
const hlStore = highlightStore as unknown as Record<string, jest.Mock>;

const setOnline = (online: boolean) => netFetch.mockResolvedValue({ isConnected: online });

beforeEach(() => jest.clearAllMocks());

describe('online → Karthik’s Mongo endpoint, offline store untouched', () => {
  beforeEach(() => setOnline(true));

  it('list reads Mongo and filters tombstones', async () => {
    apiMock.list.mockResolvedValue({
      data: [
        { id: 'a', userId: 'u', bookId: 'book-1', locator: { type: 'EPUB', cfi: 'x' }, updatedAt: 't', isDeleted: false },
        { id: 'gone', userId: 'u', bookId: 'book-1', locator: { type: 'EPUB', cfi: 'y' }, updatedAt: 't', isDeleted: true },
      ],
      serverTime: '',
    });

    const rows = await annotationsRouter.bookmarks.list('book-1');

    expect(apiMock.list).toHaveBeenCalledWith('bookmarks', { userId: 'user-001', bookId: 'book-1' });
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(bmStore.list).not.toHaveBeenCalled();
  });

  it('addForCfi POSTs to Mongo and never touches the store', async () => {
    await annotationsRouter.bookmarks.addForCfi('epubcfi(/6/4)', 'ch1', 'Start', 'book-1');

    expect(apiMock.create).toHaveBeenCalledTimes(1);
    expect(apiMock.create.mock.calls[0][0]).toBe('bookmarks');
    expect(bmStore.addForCfi).not.toHaveBeenCalled();
  });

  it('remove DELETEs on Mongo', async () => {
    await annotationsRouter.bookmarks.remove('b1');
    expect(apiMock.remove).toHaveBeenCalledWith('bookmarks', 'b1');
    expect(bmStore.remove).not.toHaveBeenCalled();
  });

  it('rename fetches then PUTs with the new name', async () => {
    await annotationsRouter.bookmarks.rename('b1', 'New');
    expect(apiMock.findById).toHaveBeenCalledWith('bookmarks', 'b1');
    expect(apiMock.update).toHaveBeenCalledWith('bookmarks', 'b1', expect.objectContaining({ name: 'New' }));
  });

  it('highlight addFromSelection POSTs to Mongo', async () => {
    await annotationsRouter.highlights.addFromSelection({ page: 2, startOffset: 1, endOffset: 8 }, 'green', 'book-1');
    expect(apiMock.create).toHaveBeenCalledWith('highlights', expect.any(Object));
    expect(hlStore.addFromSelection).not.toHaveBeenCalled();
  });
});

describe('offline → Karthik’s offline store, Mongo untouched', () => {
  beforeEach(() => setOnline(false));

  it('list reads the store', async () => {
    await annotationsRouter.bookmarks.list('book-1');
    expect(bmStore.list).toHaveBeenCalledWith('user-001', 'book-1');
    expect(apiMock.list).not.toHaveBeenCalled();
  });

  it('addForCfi delegates to the store (which his sync pushes later)', async () => {
    await annotationsRouter.bookmarks.addForCfi('epubcfi(/6/4)', 'ch1', 'Start', 'book-1');
    expect(bmStore.addForCfi).toHaveBeenCalledWith('epubcfi(/6/4)', 'ch1', 'Start', 'book-1', 'user-001');
    expect(apiMock.create).not.toHaveBeenCalled();
  });

  it('remove/rename delegate to the store', async () => {
    await annotationsRouter.bookmarks.remove('b1');
    await annotationsRouter.bookmarks.rename('b1', 'New');
    expect(bmStore.remove).toHaveBeenCalledWith('b1');
    expect(bmStore.rename).toHaveBeenCalledWith('b1', 'New');
  });

  it('highlight addFromCfi delegates to the store', async () => {
    await annotationsRouter.highlights.addFromCfi('s', 'e', 'pink', 'book-1');
    expect(hlStore.addFromCfi).toHaveBeenCalledWith('s', 'e', 'pink', 'book-1', 'user-001');
    expect(apiMock.create).not.toHaveBeenCalled();
  });
});
