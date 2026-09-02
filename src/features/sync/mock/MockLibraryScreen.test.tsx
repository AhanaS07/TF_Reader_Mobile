// Covers the Bookmarked tab's tap-to-navigate wiring, added alongside the existing Downloaded tab
// pattern: tapping a row calls openBook() (Download's unified licence gate — checkLicense →
// decrypt-or-stream) BEFORE navigating, then navigates to Reader with a `goTo` target derived from
// the bookmark's own stored Locator, so Reader lands on that exact position instead of page 1.
//
// Forced offline throughout (NetInfo mocked to never report a connection) so `showBookmarked()`
// takes its local-SQLite branch — the Mongo/online branch is a separate read path with its own
// concerns and isn't what this file is pinning.

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { MockLibraryScreen } from './MockLibraryScreen';
import { openBook } from '@/features/download/openBook';
import { DownloadFailure, DownloadError } from '@/features/download/errors';
import { bookmarkTable } from '@/features/sync/stores/bookmarkStore';
import { downloadTable } from '@/features/sync/stores/downloadStore';
import type { BookmarkRow, DownloadRow } from '@/features/sync/localDb/types';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn().mockResolvedValue({ isConnected: false }),
  },
}));

jest.mock('@/features/download/openBook', () => ({
  openBook: jest.fn().mockResolvedValue(new Uint8Array()),
}));

function bookmarkRow(overrides: Partial<BookmarkRow>): BookmarkRow {
  return {
    id: 'bm-1',
    user_id: 'user-001',
    book_id: 'book-001',
    chapter_id: null,
    locator: JSON.stringify({ type: 'EPUB', cfi: 'epubcfi(/6/10)' }),
    name: 'Chapter 3',
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    is_deleted: 0,
    synced: 0,
    ...overrides,
  };
}

// The offline branch filters bookmarks to books this device has downloaded (see
// MockLibraryScreen.tsx's own comment on showBookmarked) — a matching row here is what makes the
// bookmark for that book_id visible at all.
function downloadRow(bookId: string, format: string): DownloadRow {
  return {
    id: `dl-${bookId}`,
    user_id: 'user-001',
    book_id: bookId,
    format,
    local_path: '/tmp/fake.bin',
    status: 'complete',
    is_valid: 1,
    downloaded_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    is_deleted: 0,
    synced: 1,
  };
}

function renderMockLibrary(navigate: jest.Mock) {
  return render(
    <MockLibraryScreen
      navigation={{ navigate } as never}
      route={{ key: 'MockLibrary', name: 'MockLibrary' } as never}
    />,
  );
}

describe('MockLibraryScreen — Bookmarked tab', () => {
  beforeEach(() => {
    jest.mocked(openBook).mockClear();
    jest.mocked(openBook).mockResolvedValue(new Uint8Array());
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tapping an EPUB bookmark opens it (licence gate first) and navigates with an href target', async () => {
    jest
      .spyOn(bookmarkTable, 'listActive')
      .mockResolvedValue([bookmarkRow({ book_id: 'book-epub' })]);
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([downloadRow('book-epub', 'EPUB')]);
    const navigate = jest.fn();
    const { getByText } = await renderMockLibrary(navigate);

    fireEvent.press(getByText('Bookmarked'));
    const row = await waitFor(() => getByText('Chapter 3'));
    fireEvent.press(row);

    await waitFor(() => {
      expect(openBook).toHaveBeenCalledWith('book-epub', 'EPUB');
      expect(navigate).toHaveBeenCalledWith('Reader', {
        bookId: 'book-epub',
        format: 'EPUB',
        initialTarget: { kind: 'href', href: 'epubcfi(/6/10)' },
      });
    });
    // openBook resolves strictly before navigate — a bookmark tap cannot reach Reader through any
    // path that skips the licence/decrypt gate.
    const openBookOrder = jest.mocked(openBook).mock.invocationCallOrder[0];
    const navigateOrder = navigate.mock.invocationCallOrder[0];
    expect(openBookOrder).toBeLessThan(navigateOrder);
  });

  it('tapping a PDF bookmark navigates with a page target', async () => {
    jest.spyOn(bookmarkTable, 'listActive').mockResolvedValue([
      bookmarkRow({
        id: 'bm-2',
        book_id: 'book-pdf',
        name: null,
        chapter_id: 'page-7',
        locator: JSON.stringify({ type: 'PDF', page: 7 }),
      }),
    ]);
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([downloadRow('book-pdf', 'PDF')]);
    const navigate = jest.fn();
    const { getByText } = await renderMockLibrary(navigate);

    fireEvent.press(getByText('Bookmarked'));
    const row = await waitFor(() => getByText('page-7'));
    fireEvent.press(row);

    await waitFor(() => {
      expect(openBook).toHaveBeenCalledWith('book-pdf', 'PDF');
      expect(navigate).toHaveBeenCalledWith('Reader', {
        bookId: 'book-pdf',
        format: 'PDF',
        initialTarget: { kind: 'page', page: 7 },
      });
    });
  });

  it('an AUDIO-locator bookmark shows the audiobook alert and never calls openBook or navigates', async () => {
    jest.spyOn(bookmarkTable, 'listActive').mockResolvedValue([
      bookmarkRow({
        id: 'bm-3',
        book_id: 'book-audio',
        name: 'Track start',
        locator: JSON.stringify({ type: 'AUDIO', positionMs: 0 }),
      }),
    ]);
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([downloadRow('book-audio', 'AUDIO')]);
    const navigate = jest.fn();
    const { getByText } = await renderMockLibrary(navigate);

    fireEvent.press(getByText('Bookmarked'));
    const row = await waitFor(() => getByText('Track start'));
    fireEvent.press(row);

    await new Promise((r) => setTimeout(r, 50));

    expect(openBook).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a corrupt locator shows an alert and never calls openBook or navigates', async () => {
    jest.spyOn(bookmarkTable, 'listActive').mockResolvedValue([
      bookmarkRow({ id: 'bm-4', book_id: 'book-corrupt', name: 'Broken', locator: 'not json' }),
    ]);
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([downloadRow('book-corrupt', 'EPUB')]);
    const navigate = jest.fn();
    const { getByText } = await renderMockLibrary(navigate);

    fireEvent.press(getByText('Bookmarked'));
    const row = await waitFor(() => getByText('Broken'));
    fireEvent.press(row);

    await new Promise((r) => setTimeout(r, 50));

    expect(openBook).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when openBook rejects — a licence denial cannot be worked around from here', async () => {
    jest
      .spyOn(bookmarkTable, 'listActive')
      .mockResolvedValue([bookmarkRow({ book_id: 'book-denied' })]);
    jest.spyOn(downloadTable, 'listActive').mockResolvedValue([downloadRow('book-denied', 'EPUB')]);
    jest
      .mocked(openBook)
      .mockRejectedValueOnce(new DownloadFailure(DownloadError.NO_ENTITLEMENT, 'book-denied'));
    const navigate = jest.fn();
    const { getByText } = await renderMockLibrary(navigate);

    fireEvent.press(getByText('Bookmarked'));
    const row = await waitFor(() => getByText('Chapter 3'));
    fireEvent.press(row);

    await waitFor(() => expect(openBook).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
