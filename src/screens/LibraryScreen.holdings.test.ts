// src/screens/LibraryScreen.holdings.test.ts
// The Library screen's arithmetic, tested without a renderer.
//
// EVERY CLOCK VALUE IS PASSED IN, which is the point of these helpers living in
// their own file. The device-clock-five-minutes-fast case below is the one
// behaviour Module E's definition of done names explicitly, and it is only
// assertable because no function here reads `Date.now()`.
import type { Bookmark } from '@/shared/contracts';
import { MAX_BATCH_IDS } from '@model/batchItems';
import type { Hold, Loan } from '@model/types';
import type { DownloadRecord } from '@store/downloadStore';

import {
  activeLoans,
  bookmarkLocationLabel,
  collectItemIds,
  downloadedLabel,
  downloadsSummaryLabel,
  dueLabel,
  offerMinutesRemaining,
  ordinal,
  partitionHolds,
  queueLabel,
  queueProgressFraction,
  type ShelfSections,
  sortedBookmarks,
  sortedDownloads,
} from './LibraryScreen.holdings';

const SERVER_NOW = '2026-08-26T10:00:00Z';
const SERVER_NOW_MS = Date.parse(SERVER_NOW);

function aLoan(over: Partial<Loan> = {}): Loan {
  return { loanId: 'loan_1', itemId: 'item_42', state: 'active', ...over };
}

function aHold(over: Partial<Hold> = {}): Hold {
  return { holdId: 'hold_1', itemId: 'item_77', state: 'queued', serverTime: SERVER_NOW, ...over };
}

function aDownload(over: Partial<DownloadRecord> = {}): DownloadRecord {
  return { itemId: 'item_42', downloadedAt: SERVER_NOW_MS, ...over };
}

function aBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm_1',
    userId: 'user_1',
    bookId: 'item_42',
    locator: { type: 'PDF', page: 12 },
    createdAt: SERVER_NOW_MS,
    updatedAt: SERVER_NOW_MS,
    isDeleted: false,
    synced: false,
    ...over,
  };
}

/** The five sections, all empty — spread over with just the one under test. */
function noSections(over: Partial<ShelfSections> = {}): ShelfSections {
  return { offered: [], loans: [], downloads: [], bookmarks: [], waiting: [], ...over };
}

describe('partitionHolds', () => {
  it('puts an offered hold in offered and a queued one in waiting', () => {
    const offer = aHold({ holdId: 'h_off', state: 'offered', offerExpiresAt: SERVER_NOW });
    const queued = aHold({ holdId: 'h_q', state: 'queued' });

    const { offered, waiting } = partitionHolds([queued, offer]);

    expect(offered.map((h) => h.holdId)).toEqual(['h_off']);
    expect(waiting.map((h) => h.holdId)).toEqual(['h_q']);
  });

  it('keeps an offered hold whose expiry is missing — hiding it would lose the reader a copy', () => {
    const malformed = aHold({ state: 'offered' });

    const { offered, waiting } = partitionHolds([malformed]);

    expect(offered).toHaveLength(1);
    expect(waiting).toHaveLength(0);
  });

  it('shows neither expired nor none as waiting — the reader is in no queue in either case', () => {
    const { offered, waiting } = partitionHolds([
      aHold({ state: 'expired' }),
      aHold({ state: 'none' }),
    ]);

    expect(offered).toHaveLength(0);
    expect(waiting).toHaveLength(0);
  });
});

describe('activeLoans', () => {
  it('keeps active and drops returned and expired — neither is on the shelf', () => {
    const kept = activeLoans([
      aLoan({ loanId: 'a', state: 'active' }),
      aLoan({ loanId: 'b', state: 'returned' }),
      aLoan({ loanId: 'c', state: 'expired' }),
      aLoan({ loanId: 'd', state: 'none' }),
    ]);

    expect(kept.map((l) => l.loanId)).toEqual(['a']);
  });
});

describe('collectItemIds', () => {
  it('returns each id once across all five sections', () => {
    const { ids } = collectItemIds(
      noSections({
        offered: [aHold({ itemId: 'offered_1', state: 'offered' })],
        loans: [aLoan({ itemId: 'shared' })],
        waiting: [aHold({ itemId: 'shared' })],
      }),
    );

    expect(ids.sort()).toEqual(['offered_1', 'shared']);
  });

  it('orders offers, loans, downloads, bookmarks then waiting, so truncation falls on the queue', () => {
    const { ids } = collectItemIds({
      offered: [aHold({ itemId: 'offer', state: 'offered' })],
      loans: [aLoan({ itemId: 'loan' })],
      downloads: [aDownload({ itemId: 'download' })],
      bookmarks: [aBookmark({ bookId: 'bookmark' })],
      waiting: [aHold({ itemId: 'wait' })],
    });

    expect(ids).toEqual(['offer', 'loan', 'download', 'bookmark', 'wait']);
  });

  // The subscription case: one book that is a loan, a download AND bookmarked
  // is one id to hydrate. Three would waste two of the 100 slots the batch
  // call has, on a reader who is exactly the heavy user most likely to hit it.
  it('counts a book that is on loan, downloaded and bookmarked as one id', () => {
    const { ids } = collectItemIds(
      noSections({
        loans: [aLoan({ itemId: 'item_42' })],
        downloads: [aDownload({ itemId: 'item_42' })],
        bookmarks: [aBookmark({ bookId: 'item_42' })],
      }),
    );

    expect(ids).toEqual(['item_42']);
  });

  it('counts many bookmarks in one book as one id', () => {
    const { ids } = collectItemIds(
      noSections({
        bookmarks: [
          aBookmark({ id: 'bm_1', bookId: 'item_42' }),
          aBookmark({ id: 'bm_2', bookId: 'item_42' }),
          aBookmark({ id: 'bm_3', bookId: 'item_42' }),
        ],
      }),
    );

    expect(ids).toEqual(['item_42']);
  });

  it('caps at the batch limit and reports how many rows went unhydrated', () => {
    const many = Array.from({ length: MAX_BATCH_IDS + 7 }, (_, i) =>
      aLoan({ loanId: `loan_${i}`, itemId: `item_${i}` }),
    );

    const { ids, truncated } = collectItemIds(noSections({ loans: many }));

    expect(ids).toHaveLength(MAX_BATCH_IDS);
    expect(truncated).toBe(7);
  });

  it('reports no truncation when the shelf fits', () => {
    expect(collectItemIds(noSections({ loans: [aLoan()] })).truncated).toBe(0);
  });
});

describe('sortedDownloads', () => {
  it('puts the newest download first', () => {
    const sorted = sortedDownloads([
      aDownload({ itemId: 'older', downloadedAt: SERVER_NOW_MS - 60_000 }),
      aDownload({ itemId: 'newest', downloadedAt: SERVER_NOW_MS }),
    ]);

    expect(sorted.map((d) => d.itemId)).toEqual(['newest', 'older']);
  });

  // The store's array is state. Sorting it where it lies would mutate outside a
  // `set` and the re-render would never happen.
  it('does not mutate the array it was given', () => {
    const records = [
      aDownload({ itemId: 'older', downloadedAt: SERVER_NOW_MS - 60_000 }),
      aDownload({ itemId: 'newest', downloadedAt: SERVER_NOW_MS }),
    ];

    sortedDownloads(records);

    expect(records.map((d) => d.itemId)).toEqual(['older', 'newest']);
  });

  // ELITE never reaches this list — the server refuses the download — so there
  // is nothing here that filters on a tier, and this states that on purpose:
  // whatever the device downloaded is what the shelf shows.
  it('renders every record it is given without reading a tier', () => {
    expect(sortedDownloads([aDownload(), aDownload({ itemId: 'oa_1' })])).toHaveLength(2);
  });
});

describe('sortedBookmarks', () => {
  it('puts the most recently edited bookmark first', () => {
    const sorted = sortedBookmarks([
      aBookmark({ id: 'old', updatedAt: SERVER_NOW_MS - 60_000 }),
      aBookmark({ id: 'new', updatedAt: SERVER_NOW_MS }),
    ]);

    expect(sorted.map((b) => b.id)).toEqual(['new', 'old']);
  });

  it('drops tombstones — a deleted bookmark is not a place the reader kept', () => {
    const sorted = sortedBookmarks([
      aBookmark({ id: 'kept' }),
      aBookmark({ id: 'gone', isDeleted: true }),
    ]);

    expect(sorted.map((b) => b.id)).toEqual(['kept']);
  });

  // One row per bookmark, not per book: three places in one monograph are three
  // things the reader saved, and the page number is the whole content of a row.
  it('keeps every bookmark in a book rather than collapsing them to one row', () => {
    const sorted = sortedBookmarks([
      aBookmark({ id: 'bm_1', bookId: 'item_42' }),
      aBookmark({ id: 'bm_2', bookId: 'item_42' }),
    ]);

    expect(sorted).toHaveLength(2);
  });
});

describe('downloadedLabel', () => {
  it('says only that the book was downloaded when no size was reported', () => {
    expect(downloadedLabel(aDownload())).toBe('Downloaded');
  });

  it('appends the size in whole tenths of a megabyte', () => {
    expect(downloadedLabel(aDownload({ sizeBytes: 4.25 * 1_048_576 }))).toBe('Downloaded · 4.3 MB');
  });

  // "Downloaded · 0.0 MB" reads as a download that failed, so a real but tiny
  // file floors to a tenth rather than rounding to nothing.
  it('floors a file under a tenth of a megabyte to 0.1 MB rather than 0', () => {
    expect(downloadedLabel(aDownload({ sizeBytes: 2048 }))).toBe('Downloaded · 0.1 MB');
  });
});

describe('downloadsSummaryLabel', () => {
  it('draws no caption at all for an empty list', () => {
    expect(downloadsSummaryLabel([])).toBeUndefined();
  });

  it('counts one download as "1 item", singular', () => {
    expect(downloadsSummaryLabel([aDownload()])).toBe('1 item');
  });

  it('sums the reported sizes into a single total', () => {
    expect(
      downloadsSummaryLabel([
        aDownload({ itemId: 'a', sizeBytes: 14.2 * 1_048_576 }),
        aDownload({ itemId: 'b', sizeBytes: 8.6 * 1_048_576 }),
      ]),
    ).toBe('2 items · 22.8 MB');
  });

  // Size is optional and absent on the common path, so a total is a floor over
  // whatever reported one — never "· 0.0 MB", which reads as nothing downloaded.
  it('omits the megabytes when no download reported a size', () => {
    expect(downloadsSummaryLabel([aDownload({ itemId: 'a' }), aDownload({ itemId: 'b' })])).toBe(
      '2 items',
    );
  });

  it('sums only the sizes that were reported', () => {
    expect(
      downloadsSummaryLabel([
        aDownload({ itemId: 'a', sizeBytes: 5 * 1_048_576 }),
        aDownload({ itemId: 'b' }),
      ]),
    ).toBe('2 items · 5.0 MB');
  });
});

describe('queueProgressFraction', () => {
  it('has no fraction without a position', () => {
    expect(queueProgressFraction(aHold({ position: undefined, queueLength: 7 }))).toBeUndefined();
  });

  // A place with no scale: the label still says "3rd in the queue", but there is
  // no denominator to fill a bar against.
  it('has no fraction without a queue length', () => {
    expect(queueProgressFraction(aHold({ position: 3, queueLength: undefined }))).toBeUndefined();
  });

  it('fills fuller the nearer the front the reader is', () => {
    expect(queueProgressFraction(aHold({ position: 1, queueLength: 7 }))).toBe(1);
    expect(queueProgressFraction(aHold({ position: 7, queueLength: 7 }))).toBeCloseTo(1 / 7);
  });

  it('never reports a zero-length queue as progress', () => {
    expect(queueProgressFraction(aHold({ position: 1, queueLength: 0 }))).toBeUndefined();
  });
});

describe('bookmarkLocationLabel', () => {
  it('gives the page number for a PDF', () => {
    expect(bookmarkLocationLabel(aBookmark({ locator: { type: 'PDF', page: 42 } }))).toBe(
      'Page 42',
    );
  });

  it('ignores a PDF locator offset — it is precision no reader asked for', () => {
    expect(
      bookmarkLocationLabel(aBookmark({ locator: { type: 'PDF', page: 42, offset: 0.3 } })),
    ).toBe('Page 42');
  });

  // A CFI addresses a position in a spine item and means nothing on a shelf.
  // Resolving it needs the book open in the reader, which is CAP-7's side.
  it('falls back to the chapter for an EPUB rather than showing a CFI', () => {
    expect(
      bookmarkLocationLabel(
        aBookmark({ locator: { type: 'EPUB', cfi: 'epubcfi(/6/14!/4/2/1:0)' }, chapterId: 'Ch 3' }),
      ),
    ).toBe('Ch 3');
  });

  it('gives no label for an EPUB with no chapter, rather than a truncated CFI', () => {
    expect(
      bookmarkLocationLabel(aBookmark({ locator: { type: 'EPUB', cfi: 'epubcfi(/6/14!/4)' } })),
    ).toBeUndefined();
  });
});

describe('offerMinutesRemaining', () => {
  // The device is five minutes FAST: its clock reads later than the server's, so
  // the offset is negative. A countdown that ignored the offset would report
  // five minutes less than the reader actually has, and they would abandon a
  // copy that is still theirs.
  const DEVICE_FAST_BY_MS = 5 * 60_000;
  const deviceNowMs = SERVER_NOW_MS + DEVICE_FAST_BY_MS;
  const offsetMs = -DEVICE_FAST_BY_MS;

  it('survives a device clock five minutes fast', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS + 15 * 60_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(15);
    // Without the offset the same hold reads five minutes short.
    expect(offerMinutesRemaining(hold, 0, deviceNowMs)).toBe(10);
  });

  it('floors, so the last live minute reads as 0 rather than disappearing', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS + 30_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(0);
  });

  it('clamps a lapsed offer to 0 rather than going negative', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS - 60 * 60_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(0);
  });

  it('answers undefined when there is nothing to count', () => {
    expect(offerMinutesRemaining(aHold({ state: 'offered' }), 0, SERVER_NOW_MS)).toBeUndefined();
    expect(
      offerMinutesRemaining(aHold({ state: 'offered', offerExpiresAt: 'soon' }), 0, SERVER_NOW_MS),
    ).toBeUndefined();
  });
});

describe('dueLabel', () => {
  it('says so plainly when a loan has no due date — open access never expires', () => {
    expect(dueLabel(aLoan(), 0, SERVER_NOW_MS)).toBe('No due date');
  });

  it('ceils, so a loan with hours left is due in 1 day rather than 0', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 4 * 60 * 60_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due in 1 day');
  });

  it('pluralises', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 14 * 86_400_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due in 14 days');
  });

  it('measures against the server clock, not the device one', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 2 * 86_400_000 });
    const deviceSlowBy = 3 * 86_400_000;

    // A device three days behind would otherwise read five days remaining.
    expect(dueLabel(loan, deviceSlowBy, SERVER_NOW_MS - deviceSlowBy)).toBe('Due in 2 days');
  });

  it('reports a lapsed loan as due now rather than as a negative count', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS - 60_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due now');
  });
});

describe('ordinal', () => {
  it('handles the teens, which are the ones a naive suffix gets wrong', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('handles 1, 2, 3 and the twenties', () => {
    expect([1, 2, 3, 4, 21, 22, 23].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '21st',
      '22nd',
      '23rd',
    ]);
  });
});

describe('queueLabel', () => {
  it('reads "3rd of 7" when both the place and the length are known', () => {
    expect(queueLabel(aHold({ position: 3, queueLength: 7 }))).toBe('3rd of 7');
  });

  it('drops the length rather than inventing one', () => {
    expect(queueLabel(aHold({ position: 3 }))).toBe('3rd in the queue');
  });

  it('says nothing without a position — a bare queue length is not a fact about this reader', () => {
    expect(queueLabel(aHold({ queueLength: 7 }))).toBeUndefined();
  });
});
