// Tests for readerHighlights.ts — the stored-highlights -> format-free paint payload resolver and
// the on-open / on-action host call-sites.
//
// This is the "writes" half of the highlight-painting stage, and the only executable coverage it
// gets before the `paintHighlights` bridge command exists to carry its output. Every case pins a
// DECISION (the format discriminant never crosses; PDF carries `page` so paint is spread-routable;
// delete is by id; add/remove return the fresh authoritative set), so it doubles as the checklist the
// Reader's apply half must satisfy once wired.

import type { DownloadRow, HighlightRow } from '@/features/sync/localDb/types';
import { highlightStore, type HighlightPaint } from '@/features/sync/stores/highlightStore';
import { downloadStore } from '@/features/sync/stores/downloadStore';
import { syncEngine } from '@/features/sync/syncEngine';

import {
  addEpubHighlight,
  addPdfHighlight,
  loadReaderHighlights,
  removeHighlight,
  toReaderHighlights,
} from './readerHighlights';

// A write nudges a sync (pushOnEdit.ts's `pushNow`); mock the engine so it neither hits the real DB
// nor makes a network call here, and so we can assert it fires on writes but never on a read.
// pullBook.mockResolvedValue(undefined): loadReaderHighlights calls it whenever
// downloadStore.currentForBook (the real store, backed by the same SQLite test mock as
// highlightStore - no row is ever seeded for any book here, so it always resolves
// not-downloaded) says the book isn't downloaded, which is every case in this file. It exists so
// the call doesn't throw; loadReaderHighlights's own pullBook wiring has its dedicated tests below.
jest.mock('@/features/sync/syncEngine', () => ({
  syncEngine: { run: jest.fn(), pullBook: jest.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  (syncEngine.run as jest.Mock).mockClear();
  (syncEngine.pullBook as jest.Mock).mockClear();
});

const EPUB_PAINT: Extract<HighlightPaint, { format: 'EPUB' }> = {
  format: 'EPUB',
  id: 'h-epub-1',
  startCfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)',
  endCfi: 'epubcfi(/6/4!/4/2/2,/1:12,/1:20)',
  color: 'yellow',
};

const PDF_PAINT: Extract<HighlightPaint, { format: 'PDF' }> = {
  format: 'PDF',
  id: 'h-pdf-1',
  page: 7,
  startOffset: 3,
  endOffset: 42,
  color: 'green',
};

describe('toReaderHighlights', () => {
  it('partitions by shell and copies every field an EPUB highlight needs', () => {
    const { epub, pdf } = toReaderHighlights([EPUB_PAINT]);
    expect(pdf).toEqual([]);
    expect(epub).toEqual([
      { id: 'h-epub-1', startCfi: EPUB_PAINT.startCfi, endCfi: EPUB_PAINT.endCfi, color: 'yellow' },
    ]);
  });

  it('keeps `page` on a PDF highlight — this is what makes paint spread-routable', () => {
    const { epub, pdf } = toReaderHighlights([PDF_PAINT]);
    expect(epub).toEqual([]);
    expect(pdf).toEqual([
      { id: 'h-pdf-1', page: 7, startOffset: 3, endOffset: 42, color: 'green' },
    ]);
  });

  it('splits a mixed list into the two shells (defensive — a real book is one format)', () => {
    const { epub, pdf } = toReaderHighlights([EPUB_PAINT, PDF_PAINT]);
    expect(epub.map((h) => h.id)).toEqual(['h-epub-1']);
    expect(pdf.map((h) => h.id)).toEqual(['h-pdf-1']);
  });

  it('returns empty arrays for no highlights', () => {
    expect(toReaderHighlights([])).toEqual({ epub: [], pdf: [] });
  });

  it('never lets a ContentFormat value reach the payload', () => {
    // The bridge rule (WEBVIEW_BRIDGE.md, and readerBridge.test.ts's "never puts a ContentFormat
    // value into a command payload") as an executable assertion on OUR side of it: `HighlightPaint`
    // carries `format: 'PDF' | 'EPUB'`, and stripping it is the whole reason this mapper exists. If a
    // future edit forwards `HighlightPaint` as-is, the literal reappears here and this fails.
    const serialized = JSON.stringify(toReaderHighlights([EPUB_PAINT, PDF_PAINT]));
    for (const format of ['EPUB', 'PDF', 'AUDIO']) {
      expect(serialized).not.toContain(`"${format}"`);
    }
    expect(serialized).not.toContain('format');
  });
});

// --- the host call-sites: list-on-open, add/remove-on-action ------------------
//
// `highlightStore.list()` is stubbed so the REAL `toPaintable` runs against crafted rows — the point
// is the wiring (list -> paintable -> partition, skipped surfaced, add/remove re-read the store), not
// re-testing the store.

function row(overrides: Partial<HighlightRow>): HighlightRow {
  return {
    id: 'r1',
    user_id: 'user-001',
    book_id: 'book-001',
    start_locator: JSON.stringify({ type: 'EPUB', cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:5)' }),
    end_locator: JSON.stringify({ type: 'EPUB', cfi: 'epubcfi(/6/4!/4/2/2,/1:5,/1:9)' }),
    color: 'yellow',
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    is_deleted: 0,
    synced: 0,
    ...overrides,
  };
}

const pdfRow = (id: string): HighlightRow =>
  row({
    id,
    start_locator: JSON.stringify({ type: 'PDF', page: 2, offset: 1 }),
    end_locator: JSON.stringify({ type: 'PDF', page: 2, offset: 8 }),
    color: 'green',
  });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loadReaderHighlights', () => {
  it('turns stored rows into the format-free payload on open', async () => {
    const list = jest
      .spyOn(highlightStore, 'list')
      .mockResolvedValue([row({ id: 'a' }), pdfRow('b')]);

    const { highlights, skippedIds } = await loadReaderHighlights('book-42');

    // Scoped to THIS book, not the global BOOK_ID constant (undefined keeps the store's user default).
    expect(list).toHaveBeenCalledWith(undefined, 'book-42');
    expect(highlights.epub.map((h) => h.id)).toEqual(['a']);
    expect(highlights.pdf).toEqual([{ id: 'b', page: 2, startOffset: 1, endOffset: 8, color: 'green' }]);
    expect(skippedIds).toEqual([]);
    // A read changes nothing, so it must not kick a sync — only writes do.
    expect(syncEngine.run).not.toHaveBeenCalled();
  });

  it('tops up an undownloaded book via pullBook before reading the local rows', async () => {
    jest.spyOn(downloadStore, 'currentForBook').mockResolvedValue(null);
    jest.spyOn(highlightStore, 'list').mockResolvedValue([]);

    await loadReaderHighlights('book-not-downloaded');

    expect(downloadStore.currentForBook).toHaveBeenCalledWith('book-not-downloaded');
    expect(syncEngine.pullBook).toHaveBeenCalledWith('book-not-downloaded');
  });

  it('does not call pullBook for a book this device already has downloaded', async () => {
    jest.spyOn(downloadStore, 'currentForBook').mockResolvedValue({ id: 'dl-1' } as DownloadRow);
    jest.spyOn(highlightStore, 'list').mockResolvedValue([]);

    await loadReaderHighlights('book-downloaded');

    expect(syncEngine.pullBook).not.toHaveBeenCalled();
  });

  it('surfaces the ids of rows that cannot be painted rather than swallowing them', async () => {
    const corrupt = row({ id: 'bad', start_locator: 'not json', end_locator: 'not json' });
    jest.spyOn(highlightStore, 'list').mockResolvedValue([row({ id: 'ok' }), corrupt]);

    const { highlights, skippedIds } = await loadReaderHighlights('book-42');

    expect(highlights.epub.map((h) => h.id)).toEqual(['ok']);
    expect(skippedIds).toEqual(['bad']);
  });
});

describe('add / remove call-sites', () => {
  it('persists an EPUB selection and returns the fresh authoritative set', async () => {
    const add = jest.spyOn(highlightStore, 'addFromCfi').mockResolvedValue({} as HighlightRow);
    jest.spyOn(highlightStore, 'list').mockResolvedValue([row({ id: 'new' })]);

    const { highlights } = await addEpubHighlight('book-42', 'startCfi', 'endCfi', 'pink');

    expect(add).toHaveBeenCalledWith('startCfi', 'endCfi', 'pink', 'book-42');
    expect(highlights.epub.map((h) => h.id)).toEqual(['new']);
    // The write nudges a sync so it does not wait for the next reconnect.
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('persists a PDF selection through addFromSelection', async () => {
    const add = jest.spyOn(highlightStore, 'addFromSelection').mockResolvedValue({} as HighlightRow);
    jest.spyOn(highlightStore, 'list').mockResolvedValue([pdfRow('new')]);

    const selection = { page: 2, startOffset: 1, endOffset: 8 };
    await addPdfHighlight('book-42', selection, 'green');

    expect(add).toHaveBeenCalledWith(selection, 'green', 'book-42');
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('deletes by id and returns a set no longer containing it', async () => {
    const remove = jest.spyOn(highlightStore, 'remove').mockResolvedValue();
    jest.spyOn(highlightStore, 'list').mockResolvedValue([row({ id: 'survivor' })]);

    const { highlights } = await removeHighlight('book-42', 'victim');

    expect(remove).toHaveBeenCalledWith('victim');
    expect(highlights.epub.map((h) => h.id)).toEqual(['survivor']);
    expect(highlights.epub.map((h) => h.id)).not.toContain('victim');
    // Delete is a write too — the tombstone must propagate now, not on the next reconnect.
    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });
});
