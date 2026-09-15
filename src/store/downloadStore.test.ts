// src/store/downloadStore.test.ts
//
// The store is a module singleton, so state leaks between tests unless it is
// reset — same reasoning as recentSearchesStore.test.ts.
import { useDownloadStore } from './downloadStore';

const AT = 1_700_000_000_000;

beforeEach(() => {
  useDownloadStore.getState().clear();
});

describe('downloadStore', () => {
  it('records a download, most recent first', () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_1', downloadedAt: AT });
    useDownloadStore.getState().markDownloaded({ itemId: 'item_2', downloadedAt: AT + 1000 });

    expect(useDownloadStore.getState().downloads.map((d) => d.itemId)).toEqual([
      'item_2',
      'item_1',
    ]);
  });

  it('keeps the size when the download layer reported one', () => {
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_1', downloadedAt: AT, sizeBytes: 1024 });

    expect(useDownloadStore.getState().downloads[0]?.sizeBytes).toBe(1024);
  });

  // Re-downloading after a licence renewal is the ordinary path, and it must not
  // leave the shelf showing the same book twice with two different sizes.
  it('replaces the record for a re-downloaded item rather than adding a second row', () => {
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_1', downloadedAt: AT, sizeBytes: 1024 });
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_1', downloadedAt: AT + 5000, sizeBytes: 2048 });

    const { downloads } = useDownloadStore.getState();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toEqual({ itemId: 'item_1', downloadedAt: AT + 5000, sizeBytes: 2048 });
  });

  it('moves a re-downloaded item back to the front', () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_1', downloadedAt: AT });
    useDownloadStore.getState().markDownloaded({ itemId: 'item_2', downloadedAt: AT + 1000 });
    useDownloadStore.getState().markDownloaded({ itemId: 'item_1', downloadedAt: AT + 2000 });

    expect(useDownloadStore.getState().downloads.map((d) => d.itemId)).toEqual([
      'item_1',
      'item_2',
    ]);
  });

  // The reader deleted it, or the licence ended and the key went with it. Either
  // way the row goes — this list never syncs, so there is nobody to tell.
  it('forgets a removed download outright, leaving no tombstone', () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_1', downloadedAt: AT });
    useDownloadStore.getState().markDownloaded({ itemId: 'item_2', downloadedAt: AT });

    useDownloadStore.getState().removeDownload('item_1');

    expect(useDownloadStore.getState().downloads.map((d) => d.itemId)).toEqual(['item_2']);
  });

  it('ignores a remove for something never downloaded', () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_1', downloadedAt: AT });

    useDownloadStore.getState().removeDownload('item_never');

    expect(useDownloadStore.getState().downloads).toHaveLength(1);
  });
});
