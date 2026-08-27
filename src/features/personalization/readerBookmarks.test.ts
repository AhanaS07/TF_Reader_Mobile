// Tests for readerBookmarks.ts — the stored-bookmark -> navigable-panel-row resolver and the
// on-open / on-action host call-sites.
//
// Every case pins a DECISION (a bookmark's destination is `goTo`'s existing format-free
// `ReaderTarget`, so no new bridge command is needed; delete is by id; add/remove return the fresh
// authoritative set), so it doubles as the checklist the panel UI must satisfy once wired.

import type { BookmarkRow } from '@/features/sync/localDb/types';

import { annotationsRouter } from '@/features/personalization/annotationsRouter';
import {
  addCurrentEpubBookmark,
  addCurrentPdfBookmark,
  loadBookmarks,
  removeBookmark,
  renameBookmark,
  toReaderBookmarks,
} from './readerBookmarks';

// The facades route persistence through annotationsRouter (online→Mongo / offline→SQLite). Mock it so
// these pin the facade WIRING — the right router call with the right args, and the fresh set re-read
// and re-mapped — not the router internals (covered in annotationsRouter.test.ts).
jest.mock('@/features/personalization/annotationsRouter', () => ({
  annotationsRouter: {
    bookmarks: {
      list: jest.fn(),
      addForCfi: jest.fn().mockResolvedValue(undefined),
      addForPage: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

const router = annotationsRouter.bookmarks as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

function row(overrides: Partial<BookmarkRow>): BookmarkRow {
  return {
    id: 'b1',
    user_id: 'user-001',
    book_id: 'book-001',
    chapter_id: null,
    locator: JSON.stringify({ type: 'EPUB', cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:9)' }),
    name: null,
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    is_deleted: 0,
    synced: 0,
    ...overrides,
  };
}

const pdfRow = (over: Partial<BookmarkRow> = {}): BookmarkRow =>
  row({ locator: JSON.stringify({ type: 'PDF', page: 7 }), ...over });

describe('toReaderBookmarks', () => {
  it('maps an EPUB bookmark to an href target carrying its CFI', () => {
    const [bm] = toReaderBookmarks([row({ id: 'a' })]).bookmarks;
    expect(bm.target).toEqual({ kind: 'href', href: 'epubcfi(/6/4!/4/2/2,/1:0,/1:9)' });
    expect(bm.id).toBe('a');
  });

  it('maps a PDF bookmark to a page target', () => {
    const [bm] = toReaderBookmarks([pdfRow({ id: 'p' })]).bookmarks;
    expect(bm.target).toEqual({ kind: 'page', page: 7 });
  });

  it('labels by name first, then chapter id, then a positional fallback', () => {
    const named = toReaderBookmarks([row({ name: 'The good bit' })]).bookmarks[0];
    const chaptered = toReaderBookmarks([row({ name: null, chapter_id: 'chapter-3' })]).bookmarks[0];
    const pdfFallback = toReaderBookmarks([pdfRow({ name: null, chapter_id: null })]).bookmarks[0];
    const epubFallback = toReaderBookmarks([row({ name: null, chapter_id: null })]).bookmarks[0];

    expect(named.label).toBe('The good bit');
    expect(chaptered.label).toBe('chapter-3');
    expect(pdfFallback.label).toBe('Page 7');
    expect(epubFallback.label).toBe('Bookmark');
  });

  it('sets aside rows whose locator will not parse rather than dropping them silently', () => {
    const { bookmarks, skippedIds } = toReaderBookmarks([
      row({ id: 'ok' }),
      row({ id: 'bad', locator: 'not json' }),
    ]);
    expect(bookmarks.map((b) => b.id)).toEqual(['ok']);
    expect(skippedIds).toEqual(['bad']);
  });

  it('sets aside an AUDIO bookmark — it parses fine but has no goTo target in this reader', () => {
    // Since AUDIO joined the frozen `Locator` union, a bookmark can carry one, but `ReaderTarget` is
    // bridge-local to the text reader (`kind: 'href' | 'page'`) — an audiobook position has nowhere to
    // navigate here (that needs its own AudioPlayerScreen seam). So `toTarget` returns null and the row
    // is set aside, NOT rendered as a dead panel entry. Unreachable today (bookmarks are only minted
    // from EPUB/PDF reading positions); pinned so the deliberate skip can't silently regress.
    const { bookmarks, skippedIds } = toReaderBookmarks([
      row({ id: 'ok' }),
      row({ id: 'audio', locator: JSON.stringify({ type: 'AUDIO', positionMs: 872_000 }) }),
    ]);
    expect(bookmarks.map((b) => b.id)).toEqual(['ok']);
    expect(skippedIds).toEqual(['audio']);
  });

  it('returns empty for no bookmarks', () => {
    expect(toReaderBookmarks([])).toEqual({ bookmarks: [], skippedIds: [] });
  });

  it('never lets a ContentFormat value reach the navigation target', () => {
    // `ReaderTarget` discriminates on `kind`, not format — so a bookmark tap fires `goTo` without any
    // ContentFormat literal crossing, the same rule readerBridge.test.ts pins for every command.
    const serialized = JSON.stringify(toReaderBookmarks([row({ id: 'a' }), pdfRow({ id: 'b' })]));
    for (const format of ['EPUB', 'PDF', 'AUDIO']) {
      expect(serialized).not.toContain(`"${format}"`);
    }
    expect(serialized).not.toContain('format');
  });
});

// --- the host call-sites: list-on-open, add/remove/rename-on-action -----------
//
// Each write goes through annotationsRouter (mocked); the facade then re-reads via router.list and
// re-maps. So a write test stubs router.list with the fresh set and asserts the router method + args.

describe('loadBookmarks', () => {
  it('turns router rows into navigable panel rows on open', async () => {
    router.list.mockResolvedValue([row({ id: 'a' }), pdfRow({ id: 'b' })]);

    const { bookmarks, skippedIds } = await loadBookmarks('book-42');

    expect(router.list).toHaveBeenCalledWith('book-42'); // scoped to THIS book
    expect(bookmarks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(bookmarks[1].target).toEqual({ kind: 'page', page: 7 });
    expect(skippedIds).toEqual([]);
  });
});

describe('add / remove / rename call-sites', () => {
  it('bookmarks the current EPUB position and returns the fresh set', async () => {
    router.list.mockResolvedValue([row({ id: 'new' })]);

    const { bookmarks } = await addCurrentEpubBookmark('book-42', 'epubcfi(/6/4)', 'chapter-1', 'Start');

    // chapterId defaults to null (not undefined) when absent; here it's passed through.
    expect(router.addForCfi).toHaveBeenCalledWith('epubcfi(/6/4)', 'chapter-1', 'Start', 'book-42');
    expect(bookmarks.map((b) => b.id)).toEqual(['new']);
  });

  it('bookmarks the current PDF page through addForPage', async () => {
    router.list.mockResolvedValue([pdfRow({ id: 'new' })]);

    await addCurrentPdfBookmark('book-42', 7, 'Chart');

    expect(router.addForPage).toHaveBeenCalledWith(7, 'Chart', 'book-42');
  });

  it('deletes by id (with bookId, for routing) and returns a set without it', async () => {
    router.list.mockResolvedValue([row({ id: 'survivor' })]);

    const { bookmarks } = await removeBookmark('book-42', 'victim');

    expect(router.remove).toHaveBeenCalledWith('victim');
    expect(bookmarks.map((b) => b.id)).toEqual(['survivor']);
  });

  it('renames in place by id, keeping the id, and returns the fresh set', async () => {
    router.list.mockResolvedValue([row({ id: 'b1', name: 'New name' })]);

    const { bookmarks } = await renameBookmark('book-42', 'b1', 'New name');

    expect(router.rename).toHaveBeenCalledWith('b1', 'New name');
    expect(bookmarks[0].id).toBe('b1');
    expect(bookmarks[0].label).toBe('New name');
  });
});
