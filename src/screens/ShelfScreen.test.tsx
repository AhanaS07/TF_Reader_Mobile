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

import ShelfScreen from './ShelfScreen';

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

// A single-page shelf: no `next` link in the feed, so no `nextPage` and no
// "Load more".
const FAKE_SHELF: Shelf = {
  id: 'ebooks',
  title: 'eBooks',
  publications: [publication('item_42', 'Rights for Robots')],
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
    getInstitutions: unused,
    getInstitution: unused,
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

// Route prop ShelfScreen actually reads (`route.params.shelfId`). `title` is in
// the param list because RootNavigator uses it for the app bar, so it is supplied
// here for type parity even though the screen itself never reads it.
// `navigation` is never read from props — the screen gets it from the
// `useNavigation` mock above — so it is cast rather than fully constructed.
type ShelfProps = { route: { params: CatalogueStackParamList['Shelf'] } };
const routeProps = {
  route: { params: { shelfId: 'ebooks', title: 'eBooks' } },
} as unknown as Parameters<typeof ShelfScreen>[0] & ShelfProps;

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
    // Second argument is the shelfId — first is the (currently hardcoded)
    // institution id, which is not this test's concern.
    expect(getShelf.mock.calls[0][1]).toBe('ebooks');
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
