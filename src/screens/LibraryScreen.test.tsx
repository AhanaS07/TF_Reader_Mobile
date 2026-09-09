// src/screens/LibraryScreen.test.tsx
// The personal library — CAP-4 Module E.
//
// Same seam as the other screen tests: a fake `DataSource` injected through
// `setCatalogueSource`, and `@config/licence` mocked so `libraryStore.refresh()`
// resolves whatever a test needs. The store's state is set directly as well as
// mocked, because the screen refreshes on mount and would otherwise overwrite
// the fixture with the mock's answer.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { Bookmark } from '@/shared/contracts';
import { LibraryProviderContext } from '@/features/library/context';
import type { LibraryProvider } from '@/features/library/ports';
import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import type { BookSummary, Hold, Loan } from '@model/types';
import { useBookmarkStore } from '@store/bookmarkStore';
import { useDownloadStore } from '@store/downloadStore';
import { useLibraryStore } from '@store/libraryStore';

import LibraryScreen from './LibraryScreen';

const SERVER_NOW = new Date().toISOString();

// `useNetworkStatus` talks to NetInfo, which has no meaningful answer under Jest.
// Mocked the same way ItemDetailScreen.test.tsx does it, so the offline case can
// be driven directly.
const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockGetLibrary = jest.fn().mockResolvedValue({ loans: [], holds: [] });

jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    borrow: jest.fn(),
    returnLoan: jest.fn(),
    placeHold: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
    getLibrary: () => mockGetLibrary(),
  }),
}));

function aLoan(over: Partial<Loan> = {}): Loan {
  return { loanId: 'loan_1', itemId: 'item_42', state: 'active', ...over };
}

function aHold(over: Partial<Hold> = {}): Hold {
  return { holdId: 'hold_1', itemId: 'item_77', state: 'queued', serverTime: SERVER_NOW, ...over };
}

function aSummary(over: Partial<BookSummary> = {}): BookSummary {
  return {
    id: 'item_42',
    title: 'Applied Thermodynamics',
    format: 'EPUB',
    accessTier: 'ELITE',
    hasSearchIndex: false,
    ...over,
  };
}

/** A source whose only stubbed method is the one this screen actually calls. */
function fakeSource(getItemsBatch: DataSource['getItemsBatch']): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf: unused,
    getPublication: unused,
    getPublicFeed: unused,
    getPublicPublication: unused,
    getInstitutions: unused,
    getInstitution: unused,
    getItemsBatch,
  };
}

/** Seeds the store and makes the mount-time refresh return the same thing. */
function givenHoldings(loans: Loan[], holds: Hold[]): void {
  useLibraryStore.setState({ loans, holds, loading: false });
  mockGetLibrary.mockResolvedValue({ loans, holds });
}

function aBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm_1',
    userId: 'user_1',
    bookId: 'item_42',
    locator: { type: 'PDF', page: 12 },
    createdAt: Date.parse(SERVER_NOW),
    updatedAt: Date.parse(SERVER_NOW),
    isDeleted: false,
    synced: false,
    ...over,
  };
}

/** Every heading, in the order the screen renders them on the overview. */
const SECTIONS = ['Offered to you', 'Borrowed Books', 'Downloads', 'Bookmarks', 'Waiting'];

/**
 * The section headings on screen, in render order.
 *
 * READ OFF THE HEADERS RATHER THAN BY TEXT, because "Downloads" and "Bookmarks"
 * are now each on screen twice — once as a tab label, once as a heading — and
 * `getByText` would fail on the ambiguity rather than on anything real.
 */
function renderedSections(): string[] {
  return screen.getAllByTestId('section-header-title').map((node) => node.props.children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNetworkStatus.mockReturnValue(true);
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
  // Device-local and persisted, so unlike libraryStore these survive a test and
  // would leak a download into the next one's "empty shelf".
  useDownloadStore.getState().clear();
  useBookmarkStore.getState().clear();
  setCatalogueSource(fakeSource(async () => ({ items: [], notFound: [], denied: [] })));
});

afterEach(() => {
  setCatalogueSource(undefined);
});

describe('LibraryScreen — the empty shelf', () => {
  // A blank page with one "Nothing to show here yet" answers "is this broken?"
  // and nothing else. The headings are the shelf's table of contents: they tell
  // a reader who has borrowed nothing that this is where a loan will appear.
  it('names every section even with nothing in any of them', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(renderedSections()).toEqual(SECTIONS);
  });

  it('says what would go in each empty section rather than apologising', async () => {
    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(screen.getByText('Books you borrow will appear here until they’re due.')).toBeTruthy(),
    );
    expect(
      screen.getByText('A copy reserved for you will appear here, with a countdown.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Open access and subscription books you download will be readable here offline.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Pages you bookmark while reading will appear here.')).toBeTruthy();
    expect(
      screen.getByText('When every copy is out, join the queue and your place will show here.'),
    ).toBeTruthy();
  });

  it('asks the catalogue for nothing when there are no ids to hydrate', async () => {
    const getItemsBatch = jest.fn();
    setCatalogueSource(fakeSource(getItemsBatch));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(getItemsBatch).not.toHaveBeenCalled();
  });
});

describe('LibraryScreen — section order', () => {
  // The order is the decision this screen exists to encode: an offer is the only
  // row that dies, so it is rendered first and loudest, and the queue — where
  // nothing expires — is last.
  it('renders the five sections in order, top to bottom', async () => {
    givenHoldings(
      [aLoan({ itemId: 'item_42' })],
      [
        aHold({ holdId: 'h_wait', itemId: 'item_77', state: 'queued', position: 3, queueLength: 7 }),
        aHold({
          holdId: 'h_offer',
          itemId: 'item_99',
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    // Asserted on the rendered order of the heading nodes, not just that each
    // one exists — the order is the decision, so a reshuffle has to fail.
    expect(renderedSections()).toEqual(SECTIONS);
  });
});

describe('LibraryScreen — the tab bar', () => {
  /** Enough loans that the overview has to cap them. */
  function manyLoans(count: number): Loan[] {
    return Array.from({ length: count }, (_, i) =>
      aLoan({ loanId: `loan_${i}`, itemId: `item_${i}` }),
    );
  }

  it('opens on the overview, which is the only view that shows an offer', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('tabs-tab-all')).toBeTruthy());
    expect(screen.getByTestId('tabs-tab-all').props.accessibilityState.selected).toBe(true);
    expect(renderedSections()).toEqual(SECTIONS);
  });

  it('caps a long section on the overview and says how many there are', async () => {
    givenHoldings(manyLoans(12), []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('See all (12)')).toBeTruthy());
    // Three rows, not twelve — the cap is what bounds the page.
    expect(screen.getAllByTestId('content-card')).toHaveLength(3);
  });

  it('draws no "See all" on a section that already fits', async () => {
    givenHoldings(manyLoans(3), []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getAllByTestId('content-card')).toHaveLength(3));
    expect(screen.queryByText('See all (3)')).toBeNull();
  });

  // "See all" switches tab rather than pushing a screen: the full list already
  // exists one tab over, so a second screen rendering a loan row would be the
  // duplication CONVENTIONS §7 is about.
  it('shows the whole list when "See all" switches to the section’s own tab', async () => {
    givenHoldings(manyLoans(12), []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('See all (12)')).toBeTruthy());
    fireEvent.press(screen.getByTestId('section-header-action'));

    await waitFor(() => expect(screen.getAllByTestId('content-card')).toHaveLength(12));
    expect(screen.getByTestId('tabs-tab-loans').props.accessibilityState.selected).toBe(true);
  });

  it('shows one section on its own tab and hides the other four', async () => {
    givenHoldings(manyLoans(2), [aHold({ state: 'queued', position: 1 })]);
    useDownloadStore.getState().markDownloaded({ itemId: 'item_dl', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('tabs-tab-downloads')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tabs-tab-downloads'));

    await waitFor(() => expect(renderedSections()).toEqual(['Downloads']));
  });

  // A reader thinks of a queue and a copy reserved out of it as one thing they
  // asked for; the app splits them only because one of the two dies.
  it('keeps both hold sections together on the Holds tab', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('tabs-tab-holds')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tabs-tab-holds'));

    await waitFor(() => expect(renderedSections()).toEqual(['Offered to you', 'Waiting']));
  });

  // Nowhere further to go, so an action there would lead back to the list the
  // reader is already reading.
  it('draws no "See all" once the reader is on the section’s own tab', async () => {
    givenHoldings(manyLoans(12), []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('See all (12)')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tabs-tab-loans'));

    await waitFor(() => expect(screen.queryByText('See all (12)')).toBeNull());
    expect(screen.queryByTestId('section-header-action')).toBeNull();
  });

  // The bar is a filter, not a route: it must not put anything on the back
  // stack, and it must not refetch a shelf that is already in hand.
  //
  // EACH PRESS IS AWAITED. A press whose state update is never flushed lands
  // after the test ends and outside `act`, which leaves the renderer in a state
  // where every LATER test in the file mounts nothing — the failure shows up as
  // twenty unrelated timeouts rather than here.
  it('does not refetch the library when the reader changes tab', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('tabs-tab-bookmarks'));
    await waitFor(() => expect(renderedSections()).toEqual(['Bookmarks']));

    fireEvent.press(screen.getByTestId('tabs-tab-loans'));
    await waitFor(() => expect(renderedSections()).toEqual(['Borrowed Books']));

    expect(mockGetLibrary).toHaveBeenCalledTimes(1);
  });
});

describe('LibraryScreen — hydration', () => {
  it('asks for every id across all five sections in ONE batch call', async () => {
    const getItemsBatch = jest
      .fn()
      .mockResolvedValue({ items: [], notFound: [], denied: [] });
    setCatalogueSource(fakeSource(getItemsBatch));
    givenHoldings(
      [aLoan({ itemId: 'item_42' })],
      [
        aHold({ holdId: 'h_o', itemId: 'item_99', state: 'offered', offerExpiresAt: SERVER_NOW }),
        aHold({ holdId: 'h_w', itemId: 'item_77', state: 'queued', position: 1 }),
      ],
    );
    useDownloadStore.getState().markDownloaded({ itemId: 'item_11', downloadedAt: 1 });
    useBookmarkStore.getState().addBookmark(aBookmark({ bookId: 'item_22' }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(getItemsBatch).toHaveBeenCalledTimes(1));
    expect(getItemsBatch.mock.calls[0][0].sort()).toEqual([
      'item_11',
      'item_22',
      'item_42',
      'item_77',
      'item_99',
    ]);
  });

  // The subscription path: one book that is a loan, a download and bookmarked is
  // one id to hydrate, not three of the 100 the batch call allows.
  it('asks once for a book that is on loan, downloaded and bookmarked', async () => {
    const getItemsBatch = jest.fn().mockResolvedValue({ items: [], notFound: [], denied: [] });
    setCatalogueSource(fakeSource(getItemsBatch));
    givenHoldings([aLoan({ itemId: 'item_42' })], []);
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });
    useBookmarkStore.getState().addBookmark(aBookmark({ bookId: 'item_42' }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(getItemsBatch).toHaveBeenCalledTimes(1));
    expect(getItemsBatch.mock.calls[0][0]).toEqual(['item_42']);
  });

  it('renders the hydrated title rather than the item id', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    expect(screen.queryByText('item_42')).toBeNull();
  });

  it('keeps the row against its id when the catalogue cannot resolve it', async () => {
    // A title is decoration; possession is not. One unresolvable id must not
    // blank a shelf the reader's books are on.
    setCatalogueSource(
      fakeSource(async () => ({ items: [], notFound: ['item_42'], denied: [] })),
    );
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.getByText('item_42')).toBeTruthy();
  });

  it('keeps the shelf and offers a retry when the batch call fails outright', async () => {
    setCatalogueSource(fakeSource(async () => Promise.reject(new Error('offline'))));
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(
        screen.getByText('Titles couldn’t be loaded. Pull to try again — your books are still here.'),
      ).toBeTruthy(),
    );
    // The book is still on the shelf, named by its id.
    expect(screen.getByText('item_42')).toBeTruthy();
  });
});

describe('LibraryScreen — what each row shows', () => {
  it('shows a waiting reader their place as "3rd of 7"', async () => {
    givenHoldings([], [aHold({ state: 'queued', position: 3, queueLength: 7 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('3rd of 7')).toBeTruthy());
  });

  it('shows a loan its due date', async () => {
    givenHoldings(
      [aLoan({ expiresAt: Date.parse(SERVER_NOW) + 14 * 86_400_000 })],
      [aHold({ state: 'queued', position: 1 })],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Due in 14 days')).toBeTruthy());
  });

  it('says "No due date" for an open-access loan rather than inventing one', async () => {
    givenHoldings([aLoan()], [aHold({ state: 'queued', position: 1 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('No due date')).toBeTruthy());
  });

  it('lists an offer with its countdown', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_77', title: 'A Reassigned Copy' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings(
      [],
      [
        aHold({
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('A Reassigned Copy')).toBeTruthy());
    expect(screen.getByText('Expires in 15 minutes')).toBeTruthy();
  });

  // `QueueNotificationHost` mounts the actionable banner globally, so rendering
  // it here too put it on screen twice. This section lists; the host acts.
  it('does not render a second offer banner — the global host owns that', async () => {
    givenHoldings(
      [],
      [
        aHold({
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.queryByTestId('queue-notification')).toBeNull();
  });

  it('still lists an offer whose expiry is unreadable, just without a countdown', async () => {
    // Hiding it would lose the reader a copy that is genuinely theirs.
    givenHoldings([], [aHold({ state: 'offered' })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.getByText('item_77')).toBeTruthy();
    expect(screen.queryByText(/Expires in/)).toBeNull();
    expect(screen.queryByText('Expiring now')).toBeNull();
  });
});

describe('LibraryScreen — downloads', () => {
  it('lists a downloaded book under Downloads', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    expect(screen.getByText('Downloaded')).toBeTruthy();
  });

  it('shows the size when the download layer reported one', async () => {
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_42', downloadedAt: 1, sizeBytes: 3 * 1_048_576 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Downloaded · 3.0 MB')).toBeTruthy());
  });

  // A SUBSCRIPTION title a student downloads is both a loan and a download: the
  // loan is what expires, the download is what opens in a tunnel. Two facts, so
  // two rows — dropping either loses the answer the other cannot give.
  it('shows a subscription download under both Borrowed Books and Downloads', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings([aLoan({ itemId: 'item_42', expiresAt: Date.parse(SERVER_NOW) + 86_400_000 })], []);
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getAllByText('Applied Thermodynamics')).toHaveLength(2));
    // The loan row carries the due date, the download row carries the download.
    expect(screen.getByText('Due in 1 day')).toBeTruthy();
    expect(screen.getByText('Downloaded')).toBeTruthy();
  });

  // Open access has no loan behind it, so Downloads is the only place it can
  // appear — which is why this cannot be a badge on the loan rows instead.
  it('shows an open access download with no loan behind it', async () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_oa', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('item_oa')).toBeTruthy());
    expect(screen.getByText('Books you borrow will appear here until they’re due.')).toBeTruthy();
  });

  it('survives a refresh failure — a book on this device is not the server’s to take away', async () => {
    mockGetLibrary.mockRejectedValue(new Error('offline'));
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Downloaded')).toBeTruthy());
  });
});

describe('LibraryScreen — bookmarks', () => {
  it('shows a PDF bookmark by its page number', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    useBookmarkStore.getState().addBookmark(aBookmark({ locator: { type: 'PDF', page: 42 } }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Page 42')).toBeTruthy());
    expect(screen.getByText('Applied Thermodynamics')).toBeTruthy();
  });

  it('shows the reader’s own name for a bookmark under the title', async () => {
    useBookmarkStore.getState().addBookmark(aBookmark({ name: 'The proof' }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('The proof')).toBeTruthy());
  });

  // A CFI addresses a spine position and means nothing on a shelf. The row still
  // renders — the reader keeps the bookmark — it just claims no page.
  it('lists an EPUB bookmark without a CFI on screen', async () => {
    useBookmarkStore
      .getState()
      .addBookmark(aBookmark({ locator: { type: 'EPUB', cfi: 'epubcfi(/6/14!/4/2/1:0)' } }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('item_42')).toBeTruthy());
    expect(screen.queryByText(/epubcfi/)).toBeNull();
  });

  // Three places in one monograph are three things the reader saved, and the
  // page number is the whole content of the row.
  it('gives every bookmark in one book its own row', async () => {
    useBookmarkStore
      .getState()
      .addBookmark(aBookmark({ id: 'bm_1', locator: { type: 'PDF', page: 12 } }));
    useBookmarkStore
      .getState()
      .addBookmark(aBookmark({ id: 'bm_2', locator: { type: 'PDF', page: 88 } }));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Page 12')).toBeTruthy());
    expect(screen.getByText('Page 88')).toBeTruthy();
  });

  it('leaves a deleted bookmark off the shelf', async () => {
    useBookmarkStore.getState().addBookmark(aBookmark());
    useBookmarkStore.getState().removeBookmark('bm_1', 2);

    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(screen.getByText('Pages you bookmark while reading will appear here.')).toBeTruthy(),
    );
    expect(screen.queryByText('Page 12')).toBeNull();
  });
});

describe('LibraryScreen — the batch cap', () => {
  it('says how many rows it could not show rather than truncating silently', async () => {
    const loans = Array.from({ length: 107 }, (_, i) =>
      aLoan({ loanId: `loan_${i}`, itemId: `item_${i}` }),
    );
    givenHoldings(loans, []);

    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(
        screen.getByText('Showing your 100 most recent items. 7 more are in your loan history.'),
      ).toBeTruthy(),
    );
  });
});

describe('LibraryScreen — offline', () => {
  // Matched on the banner's own words rather than on /offline/i: the Downloads
  // empty copy says "readable here offline", and a loose regex would find it and
  // report a banner on a connected device.
  it('shows the offline banner when the device has no connection', async () => {
    mockUseNetworkStatus.mockReturnValue(false);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText("You're offline")).toBeTruthy());
  });

  it('shows no offline banner when connected', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});

describe('LibraryScreen — first load', () => {
  it('skeletons the sections that are still arriving, under their real headings', async () => {
    // A refresh that never answers. Seeding `loading: true` is not enough — the
    // mount-time refresh resolves and clears it before an assertion can run.
    mockGetLibrary.mockReturnValue(new Promise(() => {}));

    await render(<LibraryScreen />);

    // One per server-sourced section: Offered, Borrowed Books, Waiting.
    await waitFor(() => expect(screen.getAllByTestId('library-loading')).toHaveLength(3));
    expect(renderedSections()).toEqual(SECTIONS);
    // The skeleton stands in for rows, so it replaces the empty copy.
    expect(screen.queryByText('Books you borrow will appear here until they’re due.')).toBeNull();
  });

  // Nothing is pending behind them — they came off this device — so a
  // whole-screen skeleton would hide rows that are ready.
  it('does not skeleton downloads or bookmarks, which cannot be loading', async () => {
    // A refresh that never answers. Seeding `loading: true` is not enough — the
    // mount-time refresh resolves and clears it before an assertion can run.
    mockGetLibrary.mockReturnValue(new Promise(() => {}));
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Downloaded')).toBeTruthy());
    expect(screen.getByText('Pages you bookmark while reading will appear here.')).toBeTruthy();
  });
});

describe('LibraryScreen — the shelf is the launch screen', () => {
  it('refreshes on mount rather than waiting for a pull', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalled());
  });
});

// The small components lifted from the design mockup — a borrowed-books card, a
// downloads summary line, a tier pill and a queue-progress bar. Every one is fed
// by data the app actually has; the mockup's invented fields (reading %, offline
// "Ready", wait estimate) are deliberately absent.
describe('LibraryScreen — the mockup components', () => {
  it('labels the loans tab "Borrowed Books" and the holds tab "Premium books"', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('tabs-label-loans')).toBeTruthy());
    expect(screen.getByTestId('tabs-label-loans').props.children).toBe('Borrowed Books');
    expect(screen.getByTestId('tabs-label-holds').props.children).toBe('Premium books');
  });

  it('summarises the Downloads section as a count and total size', async () => {
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_a', downloadedAt: 2, sizeBytes: 14.2 * 1_048_576 });
    useDownloadStore
      .getState()
      .markDownloaded({ itemId: 'item_b', downloadedAt: 1, sizeBytes: 8.6 * 1_048_576 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('2 items · 22.8 MB')).toBeTruthy());
  });

  it('counts downloads that reported no size, omitting the megabytes', async () => {
    useDownloadStore.getState().markDownloaded({ itemId: 'item_a', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('1 item')).toBeTruthy());
  });

  it('shows the access tier on a borrowed book once its title hydrates', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', accessTier: 'SUBSCRIPTION' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Subscription')).toBeTruthy());
  });

  it('draws a queue-progress bar when a hold carries a position and a length', async () => {
    givenHoldings([], [aHold({ state: 'queued', position: 3, queueLength: 7 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('3rd of 7')).toBeTruthy());
    expect(screen.getByTestId('queue-progress')).toBeTruthy();
  });

  it('draws no queue-progress bar for a position with no queue length', async () => {
    givenHoldings([], [aHold({ state: 'queued', position: 3 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('3rd in the queue')).toBeTruthy());
    expect(screen.queryByTestId('queue-progress')).toBeNull();
  });
});

// The provider seam (src/features/library): download/bookmark rows tap through
// `LibraryProvider.openBook` → `openReader`. A fake provider is injected via
// context; with none injected the default stand-in refuses and the screen says so.
describe('LibraryScreen — opening a book through the provider', () => {
  function makeProvider(over: Partial<LibraryProvider> = {}): LibraryProvider {
    return {
      listDownloads: async () => [],
      listBookmarks: async () => [],
      openBook: jest.fn().mockResolvedValue(undefined),
      openReader: jest.fn(),
      ...over,
    };
  }

  function renderWith(provider: LibraryProvider) {
    return render(
      <LibraryProviderContext.Provider value={provider}>
        <LibraryScreen />
      </LibraryProviderContext.Provider>,
    );
  }

  it('opens a downloaded book — gate then reader — when its row is tapped', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics', format: 'PDF' })],
        notFound: [],
        denied: [],
      })),
    );
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });
    const provider = makeProvider();

    await renderWith(provider);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    fireEvent.press(screen.getByTestId('content-card'));

    await waitFor(() => expect(provider.openBook).toHaveBeenCalledWith('item_42', 'PDF'));
    expect(provider.openReader).toHaveBeenCalledWith({ itemId: 'item_42', format: 'PDF' });
  });

  it('opens a bookmark at its saved position', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    useBookmarkStore
      .getState()
      .addBookmark(aBookmark({ bookId: 'item_42', locator: { type: 'PDF', page: 42 } }));
    const provider = makeProvider();

    await renderWith(provider);

    await waitFor(() => expect(screen.getByText('Page 42')).toBeTruthy());
    fireEvent.press(screen.getByTestId('content-card'));

    await waitFor(() => expect(provider.openBook).toHaveBeenCalledWith('item_42', 'PDF'));
    expect(provider.openReader).toHaveBeenCalledWith({
      itemId: 'item_42',
      format: 'PDF',
      initialTarget: { kind: 'page', page: 42 },
    });
  });

  // With no provider mounted, the default stand-in refuses — the screen must say
  // so honestly rather than appear to open nothing.
  it('shows an honest notice when the reader is not in this build', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics', format: 'PDF' })],
        notFound: [],
        denied: [],
      })),
    );
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    fireEvent.press(screen.getByTestId('content-card'));

    await waitFor(() =>
      expect(
        screen.getByText('Reading opens here once the reader ships in the merged app.'),
      ).toBeTruthy(),
    );
  });

  // A row whose title never hydrated has no format to open against — the screen
  // must say so and NOT call the gate with an undefined format.
  it('does not open and explains when the format is still unknown', async () => {
    setCatalogueSource(fakeSource(async () => ({ items: [], notFound: ['item_42'], denied: [] })));
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });
    const provider = makeProvider();

    await renderWith(provider);

    // Rendered against its id, since the title could not resolve.
    await waitFor(() => expect(screen.getByText('item_42')).toBeTruthy());
    fireEvent.press(screen.getByTestId('content-card'));

    await waitFor(() =>
      expect(
        screen.getByText('This one isn’t ready to open yet — still loading its details.'),
      ).toBeTruthy(),
    );
    expect(provider.openBook).not.toHaveBeenCalled();
  });

  // With the real provider a second tap would race a licence session, so a tap
  // while one open is in flight is ignored.
  it('ignores a second tap while the first open is still in flight', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics', format: 'PDF' })],
        notFound: [],
        denied: [],
      })),
    );
    useDownloadStore.getState().markDownloaded({ itemId: 'item_42', downloadedAt: 1 });
    // The first tap holds the in-flight guard until we release it, so the second
    // tap lands while the first open is still pending.
    let releaseOpen: () => void = () => {};
    const openBook = jest.fn(() => new Promise<void>((resolve) => (releaseOpen = resolve)));
    const provider = makeProvider({ openBook });

    await renderWith(provider);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    const card = screen.getByTestId('content-card');
    fireEvent.press(card);
    fireEvent.press(card);

    await waitFor(() => expect(openBook).toHaveBeenCalledTimes(1));

    // Let the first open finish so nothing is left pending at teardown.
    releaseOpen();
    await waitFor(() => expect(provider.openReader).toHaveBeenCalledTimes(1));
  });
});
