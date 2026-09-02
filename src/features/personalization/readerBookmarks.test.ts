// Tests for readerBookmarks.ts — the stored-bookmark -> navigable-panel-row resolver and the
// on-open / on-action host call-sites.
//
// Every case pins a DECISION (a bookmark's destination is `goTo`'s existing format-free
// `ReaderTarget`, so no new bridge command is needed; delete is by id; add/remove return the fresh
// authoritative set), so it doubles as the checklist the panel UI must satisfy once wired.

import type { BookmarkRow } from '@/features/sync/localDb/types';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { syncEngine } from '@/features/sync/syncEngine';

import {
  addCurrentEpubBookmark,
  addCurrentPdfBookmark,
  loadBookmarks,
  removeBookmark,
  renameBookmark,
  subscribeToBookmarkChanges,
  toReaderBookmarks,
  toTarget,
} from './readerBookmarks';

// A write nudges a sync (pushOnEdit.ts's `pushNow`); mock the engine so it neither hits the real DB
// nor makes a network call here, and so we can assert it fires on writes but never on a read.
jest.mock('@/features/sync/syncEngine', () => ({ syncEngine: { run: jest.fn() } }));

beforeEach(() => {
  (syncEngine.run as jest.Mock).mockClear();
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

describe('toTarget', () => {
  // Exported so a caller elsewhere in the app (e.g. a list of bookmarks that isn't Reader's own
  // panel) can turn a stored Locator into a `goTo` target without re-deriving these three cases.
  it('maps an EPUB locator to an href target carrying its CFI', () => {
    expect(toTarget({ type: 'EPUB', cfi: 'epubcfi(/6/4)' })).toEqual({
      kind: 'href',
      href: 'epubcfi(/6/4)',
    });
  });

  it('maps a PDF locator to a page target', () => {
    expect(toTarget({ type: 'PDF', page: 7 })).toEqual({ kind: 'page', page: 7 });
  });

  it('has no target for an AUDIO locator — goTo is bridge-local to the text reader', () => {
    expect(toTarget({ type: 'AUDIO', positionMs: 872_000 })).toBeNull();
  });
});

// --- the host call-sites: list-on-open, add/remove-on-action ------------------

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loadBookmarks', () => {
  it('turns stored rows into navigable panel rows on open', async () => {
    const list = jest
      .spyOn(bookmarkStore, 'list')
      .mockResolvedValue([row({ id: 'a' }), pdfRow({ id: 'b' })]);

    const { bookmarks, skippedIds } = await loadBookmarks('book-42');

    // Scoped to THIS book, not the global BOOK_ID constant (undefined keeps the store's user default).
    expect(list).toHaveBeenCalledWith(undefined, 'book-42');
    expect(bookmarks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(bookmarks[1].target).toEqual({ kind: 'page', page: 7 });
    expect(skippedIds).toEqual([]);
    // A read changes nothing, so it must not kick a sync — only writes do.
    expect(syncEngine.run).not.toHaveBeenCalled();
  });
});

describe('add / remove call-sites', () => {
  it('bookmarks the current EPUB position and returns the fresh set', async () => {
    const add = jest.spyOn(bookmarkStore, 'addForCfi').mockResolvedValue({} as BookmarkRow);
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([row({ id: 'new' })]);

    const { bookmarks } = await addCurrentEpubBookmark('book-42', 'epubcfi(/6/4)', 'chapter-1', 'Start');

    expect(add).toHaveBeenCalledWith('epubcfi(/6/4)', 'chapter-1', 'Start', 'book-42');
    expect(bookmarks.map((b) => b.id)).toEqual(['new']);
    // The write nudges a sync so it does not wait for the next reconnect.
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('bookmarks the current PDF page through addForPage', async () => {
    const add = jest.spyOn(bookmarkStore, 'addForPage').mockResolvedValue({} as BookmarkRow);
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([pdfRow({ id: 'new' })]);

    await addCurrentPdfBookmark('book-42', 7, 'Chart');

    expect(add).toHaveBeenCalledWith(7, 'Chart', 'book-42');
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('deletes by id and returns a set no longer containing it', async () => {
    const remove = jest.spyOn(bookmarkStore, 'remove').mockResolvedValue();
    jest.spyOn(bookmarkStore, 'list').mockResolvedValue([row({ id: 'survivor' })]);

    const { bookmarks } = await removeBookmark('book-42', 'victim');

    expect(remove).toHaveBeenCalledWith('victim');
    expect(bookmarks.map((b) => b.id)).toEqual(['survivor']);
    // Delete is a write too — the tombstone must propagate now, not on the next reconnect.
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('renames in place by id, keeping the id, and returns the fresh set', async () => {
    const rename = jest
      .spyOn(bookmarkStore, 'rename')
      .mockResolvedValue({} as BookmarkRow);
    // The reload reflects the new name under the SAME id — id and target are untouched by a rename.
    jest
      .spyOn(bookmarkStore, 'list')
      .mockResolvedValue([row({ id: 'b1', name: 'New name' })]);

    const { bookmarks } = await renameBookmark('book-42', 'b1', 'New name');

    expect(rename).toHaveBeenCalledWith('b1', 'New name');
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].id).toBe('b1');
    expect(bookmarks[0].label).toBe('New name');
    // A rename is an update-in-place write — one sync nudge, same as add/remove.
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeToBookmarkChanges', () => {
  it('delegates to bookmarkStore.subscribe — the seam that also hears a pulled change, not just a local edit', () => {
    const listener = jest.fn();
    const storeUnsubscribe = jest.fn();
    const subscribeSpy = jest.spyOn(bookmarkStore, 'subscribe').mockReturnValue(storeUnsubscribe);

    const unsubscribe = subscribeToBookmarkChanges(listener);

    expect(subscribeSpy).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(storeUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
