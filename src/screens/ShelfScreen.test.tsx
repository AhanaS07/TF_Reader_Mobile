// src/screens/ShelfScreen.test.tsx
// One shelf, fetched by id and rendered as a section + its publications.
//
// Same seam as CatalogueScreen.test.tsx: inject a fake DataSource through
// `setCatalogueSource` rather than hitting MockAdapter's fixtures, so these
// tests pin the screen's own wiring (loading -> data -> error -> retry, and
// the press -> navigate contract) independently of what the fixtures contain.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import type { Shelf } from '@model/types';
import type { CatalogueStackParamList } from '@navigation/types';

import { LicenceError, LicenceFailure } from '@/licence/LicenceSource';

import ShelfScreen from './ShelfScreen';

// D12 — pressing the queue button makes a real borrow through `@config/licence`,
// so that seam is faked here the same way ItemDetailScreen.test.tsx fakes it.
const mockQueueBorrow = jest.fn();
const mockQueuePlaceHold = jest.fn();
const mockQueueGetLibrary = jest.fn();
jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    borrow: (...args: [string]) => mockQueueBorrow(...args),
    placeHold: (...args: [string]) => mockQueuePlaceHold(...args),
    getLibrary: () => mockQueueGetLibrary(),
    returnLoan: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
  }),
}));

const ELITE_LOAN = { loanId: 'loan_1', itemId: 'item_42', state: 'active' as const, expiresAt: 9_999 };
const ELITE_HOLD = {
  holdId: 'hold_1',
  itemId: 'item_42',
  state: 'queued' as const,
  position: 2,
  queueLength: 4,
  serverTime: '',
};
const noCopiesFailure = () =>
  new LicenceFailure(LicenceError.REFUSED, { errorCode: 'NO_COPIES_AVAILABLE' });

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock".
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function publication(id: string, title: string): Shelf['publications'][number] {
  return {
    id,
    title,
    publisher: 'Routledge',
    authors: ['Joshua C. Gellers'],
    subjects: [],
    format: 'PDF',
    acquisition: {
      actionId: 'borrow',
      href: `https://x/loan/${id}`,
      licenceModel: 'SUBSCRIPTION',
      encryption: null,
      hasSearchIndex: true,
      canPersist: true,
    },
  };
}

// An open access title, for the badge tests: `publication` above is always
// SUBSCRIPTION, and a shelf of one tier cannot show that rows are badged
// individually rather than all from the first one.
function openAccessPublication(id: string, title: string): Shelf['publications'][number] {
  const base = publication(id, title);
  return {
    ...base,
    acquisition: { ...base.acquisition, actionId: 'openAccess', licenceModel: 'OPEN_ACCESS' },
  };
}

// A single-page shelf: no `next` link in the feed, so no `nextPage` and no
// "Load more".
const FAKE_SHELF: Shelf = {
  id: 'ebooks',
  title: 'eBooks',
  publications: [publication('item_42', 'Rights for Robots')],
};

// Two tiers on one shelf, like fixture 03 (ELITE + SUBSCRIPTION) and 04
// (ELITE + OPEN_ACCESS).
const MIXED_TIER_SHELF: Shelf = {
  id: 'all',
  title: 'All titles',
  publications: [
    publication('item_42', 'Rights for Robots'),
    openAccessPublication('item_ab6', 'Ethnographies of Waiting'),
  ],
};

// A shelf spread over two pages, shaped like 02-shelf-group.json: 3 items in
// pages of 2, page 0 advertising `nextPage: 1` and page 1 advertising none.
const PAGE_0: Shelf = {
  id: 'ebooks',
  title: 'eBooks',
  totalItems: 3,
  itemsPerPage: 2,
  nextPage: 1,
  publications: [
    publication('item_42', 'Rights for Robots'),
    publication('item_env', 'Environmental Policy and Air Pollution in China'),
  ],
};

const PAGE_1: Shelf = {
  id: 'ebooks',
  title: 'eBooks',
  totalItems: 3,
  itemsPerPage: 2,
  publications: [publication('item_stat', 'An Introduction to Statistics')],
};

// Every method a real DataSource must have, so the fake typechecks as one.
// Only `getShelf` is exercised — the rest throw if the screen ever reaches
// for them, which would mean it grew a dependency this suite does not know
// to fake.
function fakeSource(getShelf: DataSource['getShelf']): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf,
    getPublication: unused,
    getPublicFeed: unused,
    getPublicPublication: unused,
    getInstitutions: unused,
    getInstitution: unused,
    getItemsBatch: unused,
  };
}

// Serves a shelf page-by-page, indexed by the `page` argument, so a Load-more
// press exercises the real cursor rather than a hardcoded second response.
// An omitted page means the first one, matching how the adapters behave.
function pagedSource(pages: Shelf[]) {
  const getShelf = jest.fn(
    async (_institutionId: string, _shelfId: string, page?: number): Promise<Shelf> => {
      const requested = pages[page ?? 0];
      if (requested === undefined) throw new Error(`no fixture for page ${String(page)}`);
      return requested;
    },
  );
  setCatalogueSource(fakeSource(getShelf));
  return getShelf;
}

// Route props ShelfScreen reads (`shelfId` and `institutionId`). `title` is in
// the param list because RootNavigator uses it for the app bar, so it is supplied
// here for type parity even though the screen itself never reads it.
// `navigation` is never read from props — the screen gets it from the
// `useNavigation` mock above — so it is cast rather than fully constructed.
type ShelfProps = { route: { params: CatalogueStackParamList['Shelf'] } };
function propsFor(params: CatalogueStackParamList['Shelf']) {
  return { route: { params } } as unknown as Parameters<typeof ShelfScreen>[0] & ShelfProps;
}
const routeProps = propsFor({
  shelfId: 'ebooks',
  title: 'eBooks',
  institutionId: 'inst_7f3',
});

afterEach(() => {
  setCatalogueSource(undefined);
  mockNavigate.mockClear();
});

describe('ShelfScreen loading', () => {
  it('shows skeletons before the shelf arrives', async () => {
    // Never resolves within the test, so the screen is caught mid-load.
    setCatalogueSource(fakeSource(() => new Promise(() => {})));

    await render(<ShelfScreen {...routeProps} />);

    expect(screen.getAllByTestId('content-card-skeleton').length).toBeGreaterThan(0);
  });
});

describe('ShelfScreen with data', () => {
  it('requests the shelf named in route.params, not a hardcoded id', async () => {
    const getShelf = jest.fn(async (_institutionId: string, _shelfId: string) => FAKE_SHELF);
    setCatalogueSource(fakeSource(getShelf));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(getShelf).toHaveBeenCalled());
    // Second argument is the shelfId — the first is the institution, asserted
    // in its own test below.
    expect(getShelf.mock.calls[0][1]).toBe('ebooks');
  });

  // A reader at one institution must never be served another's shelf. The id
  // here is deliberately NOT the fixture default 'inst_7f3', because the bug
  // this pins was a hardcoded constant that matched that default exactly and so
  // looked correct from every test that used it. The load-more call is asserted
  // too: the paging path built its own request and could pass a different id
  // from the first page's without anything on screen looking wrong.
  it('sends the route’s institution id on the first page and on load more', async () => {
    const getShelf = pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...propsFor({ ...routeProps.route.params, institutionId: 'inst_a21' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(2));
    expect(getShelf.mock.calls[0][0]).toBe('inst_a21');
    expect(getShelf.mock.calls[1][0]).toBe('inst_a21');
  });

  // The shelf's NAME is not asserted here: RootNavigator puts it in the app bar
  // from route.params.title, which is outside this component. Rendering it again
  // inside the screen would print it twice on device.
  it('renders the publications the shelf carries', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
  });

  it('navigates to ItemDetail with the publication id when a row is pressed', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Rights for Robots' }));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
  });
});

// A3 — every row carries its access tier, resolved per row rather than once for
// the shelf. Both labels are asserted because a single-tier shelf cannot tell
// the two apart.
describe('ShelfScreen access-tier badges', () => {
  it('gives every publication row a badge', async () => {
    setCatalogueSource(fakeSource(async () => MIXED_TIER_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(screen.getAllByTestId('content-card-badge')).toHaveLength(2);
  });

  it('labels a subscription title and an open access title differently', async () => {
    setCatalogueSource(fakeSource(async () => MIXED_TIER_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Subscription')).toBeTruthy());
    expect(screen.getByText('Open Access')).toBeTruthy();
  });

  it('badges the rows a later page brings in too', async () => {
    pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByText('An Introduction to Statistics')).toBeTruthy());
    // Two rows from page 0, one from page 1.
    expect(screen.getAllByTestId('content-card-badge')).toHaveLength(3);
  });
});

describe('ShelfScreen error', () => {
  it('shows a retry affordance when the shelf fails to load, and retrying re-fetches', async () => {
    let attempt = 0;
    setCatalogueSource(
      fakeSource(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('network down');
        return FAKE_SHELF;
      }),
    );

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/couldn.?t load/i)).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(attempt).toBe(2);
  });
});

describe('ShelfScreen pagination', () => {
  it('offers no Load more when the feed advertises no next page', async () => {
    // FAKE_SHELF has no `nextPage`, the normalized form of "no next link".
    setCatalogueSource(fakeSource(async () => FAKE_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('offers Load more when the feed advertises a next page', async () => {
    pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());
  });

  it('requests the page number the feed named, never first + 1', async () => {
    // PAGE_0 says `nextPage: 1`, so that exact value must reach the adapter —
    // arithmetic here would be a second source of truth for the cursor.
    const getShelf = pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(2));
    // Third argument is the page; the first call omits it entirely.
    expect(getShelf.mock.calls[0][2]).toBeUndefined();
    expect(getShelf.mock.calls[1][2]).toBe(1);
  });

  it('appends the next page instead of replacing what is on screen', async () => {
    pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    // Page 1's row arrives...
    await waitFor(() => expect(screen.getByText('An Introduction to Statistics')).toBeTruthy());
    // ...and page 0's rows are still there, which is the whole point of paging.
    expect(screen.getByText('Rights for Robots')).toBeTruthy();
    expect(screen.getByText('Environmental Policy and Air Pollution in China')).toBeTruthy();
  });

  it('withdraws Load more once a page arrives with no next page', async () => {
    pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    // Gone, not disabled: PAGE_1 carries no `nextPage`, so there is nothing left
    // to fetch and a dead button would read as broken.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull(),
    );
  });

  it('counts loaded rows against the server-reported total, not the page size', async () => {
    pagedSource([PAGE_0, PAGE_1]);

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/Showing 2 of 3/)).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByText(/Showing 3 of 3/)).toBeTruthy());
  });

  it('keeps the loaded rows when a later page fails, and retries in place', async () => {
    let pageOneAttempts = 0;
    const getShelf = jest.fn(
      async (_institutionId: string, _shelfId: string, page?: number): Promise<Shelf> => {
        if (page === undefined) return PAGE_0;
        pageOneAttempts += 1;
        if (pageOneAttempts === 1) throw new Error('network down mid-scroll');
        return PAGE_1;
      },
    );
    setCatalogueSource(fakeSource(getShelf));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    // The failure is reported inline...
    await waitFor(() => expect(screen.getByText(/couldn.?t load more/i)).toBeTruthy());
    // ...and does NOT escalate to the full-screen error, so page 0 survives.
    expect(screen.getByText('Rights for Robots')).toBeTruthy();
    expect(screen.queryByText(/couldn.?t load this shelf/i)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /couldn.?t load more/i }));

    await waitFor(() => expect(screen.getByText('An Introduction to Statistics')).toBeTruthy());
    expect(pageOneAttempts).toBe(2);
  });

  it('ignores a second press while a page is already in flight', async () => {
    // Page 1 never resolves, so the button stays in its loading state and a
    // second press must not start a duplicate request.
    const getShelf = jest.fn(
      async (_institutionId: string, _shelfId: string, page?: number): Promise<Shelf> =>
        page === undefined ? PAGE_0 : new Promise<Shelf>(() => {}),
    );
    setCatalogueSource(fakeSource(getShelf));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByText('Loading…')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Loading…' }));

    expect(getShelf).toHaveBeenCalledTimes(2);
  });
});

// `all` never 404s, so a shelf with nothing in it arrives as a SUCCESS with no
// publications — not a rejection. The screen has to read that as empty rather
// than broken. Rendering the empty state itself is Khushi's Week 3 work; what
// is pinned here is that the parse survives and the error path stays shut.
describe('ShelfScreen with a zero-result shelf', () => {
  const EMPTY_SHELF: Shelf = {
    id: 'all',
    title: 'All titles',
    totalItems: 0,
    publications: [],
    browseInstead: [
      {
        title: 'Browse the full catalogue',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
        shelfId: 'catalogue',
      },
    ],
  };

  it('does not show the error state for a shelf that legitimately has nothing', async () => {
    setCatalogueSource(fakeSource(async () => EMPTY_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/showing 0 of 0/i)).toBeTruthy());
    expect(screen.queryByText(/couldn.?t load/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('offers no Load more, since an empty feed carries no next link', async () => {
    setCatalogueSource(fakeSource(async () => EMPTY_SHELF));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/showing 0 of 0/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

// Screen 12 — the filter & sort sheet.
describe('ShelfScreen filter & sort', () => {
  it('requests no filters or sort on first load', async () => {
    const getShelf = jest.fn<ReturnType<DataSource['getShelf']>, Parameters<DataSource['getShelf']>>(
      async () => FAKE_SHELF,
    );
    setCatalogueSource(fakeSource(getShelf));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(getShelf).toHaveBeenCalled());
    expect(getShelf.mock.calls[0][3]).toEqual({
      contentType: undefined,
      accessTier: undefined,
      sort: undefined,
    });
  });

  it('greys the sort row and explains why on a shelf other than all', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_SHELF));
    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Filter and sort'));

    await waitFor(() => expect(screen.getByLabelText('Newest')).toBeTruthy());
    expect(screen.getByTestId('filter-sort-sheet-sort-note')).toBeTruthy();
    expect(screen.getByLabelText('Newest').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('re-fetches with the chosen content type once Apply Filters is pressed', async () => {
    const getShelf = jest.fn<ReturnType<DataSource['getShelf']>, Parameters<DataSource['getShelf']>>(
      async () => FAKE_SHELF,
    );
    setCatalogueSource(fakeSource(getShelf));
    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await fireEvent.press(screen.getByTestId('filter-sort-sheet-apply'));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(2));
    expect(getShelf.mock.calls[1][3]).toMatchObject({ contentType: 'AUDIO' });
    // Pressing Apply closes the sheet (BottomSheet animates its exit, hence waitFor).
    await waitFor(() => expect(screen.queryByTestId('filter-sort-sheet-apply')).toBeNull());
  });

  it('carries the applied filter into a subsequent Load more request', async () => {
    const getShelf = jest.fn<ReturnType<DataSource['getShelf']>, Parameters<DataSource['getShelf']>>(
      async (_institutionId, _shelfId, page) => (page === undefined ? PAGE_0 : PAGE_1),
    );
    setCatalogueSource(fakeSource(getShelf));
    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await waitFor(() => expect(screen.getByLabelText('PDF')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('PDF'));
    await fireEvent.press(screen.getByTestId('filter-sort-sheet-apply'));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(3));
    expect(getShelf.mock.calls[2][2]).toBe(1);
    expect(getShelf.mock.calls[2][3]).toMatchObject({ contentType: 'PDF' });
  });

  it('resets to no filters when Clear All is pressed', async () => {
    const getShelf = jest.fn<ReturnType<DataSource['getShelf']>, Parameters<DataSource['getShelf']>>(
      async () => FAKE_SHELF,
    );
    setCatalogueSource(fakeSource(getShelf));
    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await fireEvent.press(screen.getByTestId('filter-sort-sheet-apply'));
    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.getByLabelText('Filter and sort')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Filter and sort'));
    await waitFor(() => expect(screen.getByTestId('filter-sort-sheet-clear')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('filter-sort-sheet-clear'));

    await waitFor(() => expect(getShelf).toHaveBeenCalledTimes(3));
    expect(getShelf.mock.calls[2][3]).toEqual({
      contentType: undefined,
      accessTier: undefined,
      sort: undefined,
    });
  });
});

// ── D12 — the Elite queue button on a shelf row ───────────────────────────────
//
// The button is `resolveAccess`'s answer rendered, not a decision this screen
// makes: an Elite title with nothing held resolves to `['grantAccess']`, and that
// is the one action D12 puts on a card. Everything else resolves to something a
// card deliberately does not offer, so the row draws no button.
//
// WHAT IS TESTED HERE VERSUS IN queueRequest.test.ts. This block covers what the
// SCREEN owns — that the row offers the action, that pressing it reaches the real
// licence source, and that the button ends up idle again either way. The pending
// semantics themselves (one request at a time, second press ignored, second ROW
// ignored, clears on failure) belong to `useQueueRequest` and are tested there
// against a fake source, which is both more thorough and not subject to the
// act()-scope fragility that a screen test holding a promise open runs into.
describe('ShelfScreen — D12 Elite queue button', () => {
  function eliteShelf(...ids: string[]): Shelf {
    return {
      id: 'ebooks',
      title: 'eBooks',
      publications: ids.map((id) => {
        const base = publication(id, `Elite ${id}`);
        return { ...base, acquisition: { ...base.acquisition, licenceModel: 'ELITE' as const } };
      }),
    };
  }

  beforeEach(() => {
    mockQueueBorrow.mockResolvedValue(ELITE_LOAN);
    mockQueuePlaceHold.mockResolvedValue(ELITE_HOLD);
    mockQueueGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  });

  afterEach(() => {
    mockQueueBorrow.mockReset();
    mockQueuePlaceHold.mockReset();
    mockQueueGetLibrary.mockReset();
  });

  it('offers Grant access on an Elite row', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());
  });

  it('offers it on every Elite row, not just the first', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42', 'item_99')));

    await render(<ShelfScreen {...routeProps} />);

    await waitFor(() => expect(screen.getAllByText('Grant access')).toHaveLength(2));
  });

  // A SUBSCRIPTION row resolves to read/download, which belong on the detail
  // screen — so no card button. This is what stops D12 becoming "a button on
  // every row".
  it('draws no queue button on a non-Elite row', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_SHELF));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());

    expect(screen.queryByText('Grant access')).toBeNull();
  });

  // The row is still a navigation target; D12 adds a button, it does not replace
  // the tap that opens the detail screen.
  it('keeps the row itself tappable alongside the button', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByText('Elite item_42'));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
  });

  it('borrows the pressed item through the existing licence source', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));

    await waitFor(() => expect(mockQueueBorrow).toHaveBeenCalledWith('item_42'));
    // Navigating to the detail screen is NOT part of pressing the button — the
    // whole point of D12 is that the reader does not have to go there.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('presses the right row when several are on screen', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42', 'item_99')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getAllByText('Grant access')).toHaveLength(2));

    fireEvent.press(screen.getAllByTestId('action-button-grantAccess')[1]);

    await waitFor(() => expect(mockQueueBorrow).toHaveBeenCalledWith('item_99'));
  });

  it('queues instead when no copy is free', async () => {
    mockQueueBorrow.mockRejectedValue(noCopiesFailure());
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));

    await waitFor(() => expect(mockQueuePlaceHold).toHaveBeenCalledWith('item_42'));
  });

  it('invalidates the holdings cache after the request', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));

    await waitFor(() => expect(mockQueueGetLibrary).toHaveBeenCalled());
  });

  it('leaves the button idle and pressable again after a success', async () => {
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));
    await waitFor(() => expect(mockQueueGetLibrary).toHaveBeenCalled());

    await waitFor(() =>
      expect(
        screen.getByTestId('action-button-grantAccess').props.accessibilityState,
      ).toEqual({ disabled: false, busy: false }),
    );
  });

  // A stuck spinner is the worst failure mode here, so failure gets its own test.
  it('leaves the button idle and pressable again after a failure', async () => {
    mockQueueBorrow.mockRejectedValue(new Error('boom'));
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));
    await waitFor(() => expect(mockQueueGetLibrary).toHaveBeenCalled());

    await waitFor(() =>
      expect(
        screen.getByTestId('action-button-grantAccess').props.accessibilityState,
      ).toEqual({ disabled: false, busy: false }),
    );
    expect(screen.queryByTestId('action-button-spinner')).toBeNull();
  });

  // LAST IN THE FILE, DELIBERATELY. This is the only test that holds the borrow
  // open, which is the only way to render the busy state — and an unresolved
  // promise at teardown is what corrupts a following render, so nothing follows.
  it('shows the button busy, and inert, while the request is in flight', async () => {
    mockQueueBorrow.mockReturnValue(new Promise(() => {}));
    setCatalogueSource(fakeSource(async () => eliteShelf('item_42')));

    await render(<ShelfScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));

    await waitFor(() => expect(screen.getByTestId('action-button-spinner')).toBeTruthy());
    // `disabled: true` is the duplicate-press guard, applied by ActionButton
    // itself — see its `inert`. `busy` is what a screen reader needs.
    expect(screen.getByTestId('action-button-grantAccess').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });
});
