// Tests for readerBookmarks.ts — the stored-bookmark -> navigable-panel-row resolver and the
// on-open / on-action host call-sites.
//
// Every case pins a DECISION (a bookmark's destination is `goTo`'s existing format-free
// `ReaderTarget`, so no new bridge command is needed; delete is by id; add/remove return the fresh
// authoritative set), so it doubles as the checklist the panel UI must satisfy once wired.

import type { BookmarkRow } from '@/features/sync/localDb/types';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';

import {
  addCurrentEpubBookmark,
  addCurrentPdfBookmark,
  loadBookmarks,
  removeBookmark,
  toReaderBookmarks,
} from './readerBookmarks';

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

// --- the host call-sites: list-on-open, add/remove-on-action ------------------

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loadBookmarks', () => {
  it('turns stored rows into navigable panel rows on open', async () => {
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([row({ id: 'a' }), pdfRow({ id: 'b' })]);

    const { bookmarks, skippedIds } = await loadBookmarks();

    expect(bookmarks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(bookmarks[1].target).toEqual({ kind: 'page', page: 7 });
    expect(skippedIds).toEqual([]);
  });
});

describe('add / remove call-sites', () => {
  it('bookmarks the current EPUB position and returns the fresh set', async () => {
    const add = jest.spyOn(bookmarkStore, 'addForCfi').mockResolvedValue({} as BookmarkRow);
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([row({ id: 'new' })]);

    const { bookmarks } = await addCurrentEpubBookmark('epubcfi(/6/4)', 'chapter-1', 'Start');

    expect(add).toHaveBeenCalledWith('epubcfi(/6/4)', 'chapter-1', 'Start');
    expect(bookmarks.map((b) => b.id)).toEqual(['new']);
  });

  it('bookmarks the current PDF page through addForPage', async () => {
    const add = jest.spyOn(bookmarkStore, 'addForPage').mockResolvedValue({} as BookmarkRow);
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([pdfRow({ id: 'new' })]);

    await addCurrentPdfBookmark(7, 'Chart');

    expect(add).toHaveBeenCalledWith(7, 'Chart');
  });

  it('deletes by id and returns a set no longer containing it', async () => {
    const remove = jest.spyOn(bookmarkStore, 'remove').mockResolvedValue();
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([row({ id: 'survivor' })]);

    const { bookmarks } = await removeBookmark('victim');

    expect(remove).toHaveBeenCalledWith('victim');
    expect(bookmarks.map((b) => b.id)).toEqual(['survivor']);
  });
});
