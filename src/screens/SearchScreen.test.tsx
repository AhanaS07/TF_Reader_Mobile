// src/screens/SearchScreen.test.tsx
// The B1 query surface, driven through a stub pipeline.
//
// WHAT THIS SUITE IS FOR: proving the surface tells the three outcomes apart —
// results, a successful empty answer, and an actual failure — and that a filter
// leaves as part of the request rather than being applied to whatever came back.
// Those are the claims that cannot be checked from a screenshot.
//
// `await render(...)` is required — @testing-library/react-native v14 returns a
// Promise. See the note in App.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { setSearchPipeline } from '@config/search';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import type { NavLink, Publication, SearchFeed } from '@model/types';
import type { CatalogueSearchPipeline, SearchRequest } from '@/search';

import SearchScreen from './SearchScreen';

const mockNavigate = jest.fn();

// The screen calls `useNavigation`, which needs a navigation container it has no
// business owning in a unit test. Mocked rather than wrapped: what is under test
// is the query surface, and a real navigator would only add a tree to search
// through.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ─── Test doubles ────────────────────────────────────────────────────────────

function publication(id: string, title: string, publisher: string): Publication {
  return {
    id,
    title,
    publisher,
    authors: [],
    subjects: [],
    format: 'EPUB',
    acquisition: {
      actionId: 'openAccess',
      href: `https://api.tf/api/v1/reading-sessions?itemId=${id}`,
      licenceModel: 'OPEN_ACCESS',
      encryption: null,
      hasSearchIndex: true,
      canPersist: true,
    },
  };
}

const FIRST = publication('item_env', 'Environmental Policy in China', 'Routledge');
const SECOND = publication('item_ab6', 'Ethnographies of Waiting', 'CRC Press');

const BROWSE: NavLink[] = [
  { title: 'eBooks', href: 'https://api.tf/groups/ebooks', shelfId: 'ebooks' },
  { title: 'Open access', href: 'https://api.tf/groups/open-access', shelfId: 'open-access' },
];

function feed(overrides: Partial<SearchFeed> = {}): SearchFeed {
  return { publications: [], browseInstead: [], ...overrides };
}

// Records what it was asked for, so a test can assert the REQUEST rather than
// inferring it from the response.
interface Stub extends CatalogueSearchPipeline {
  searchCalls: SearchRequest[];
  nextCalls: string[];
}

function stub(
  onSearch: (request: SearchRequest) => Promise<SearchFeed>,
  onNext: (next: string) => Promise<SearchFeed> = () => Promise.resolve(feed()),
): Stub {
  const searchCalls: SearchRequest[] = [];
  const nextCalls: string[] = [];

  return {
    searchCalls,
    nextCalls,
    search(request) {
      searchCalls.push(request);
      return onSearch(request);
    },
    next(value) {
      nextCalls.push(value);
      return onNext(value);
    },
  };
}

async function submit(query: string) {
  await fireEvent.changeText(screen.getByTestId('search-input-field'), query);
  await fireEvent(screen.getByTestId('search-input-field'), 'submitEditing');
}

afterEach(() => {
  setSearchPipeline(undefined);
  mockNavigate.mockClear();
});

// ─── Metadata-only copy ──────────────────────────────────────────────────────

// The failure this guards against is silent: a reader searches for a phrase they
// remember from chapter nine, gets nothing, and concludes the app is broken. The
// copy has to rule that expectation out before they type.
describe('the surface says what it searches', () => {
  it('names the four metadata fields in the placeholder', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    expect(screen.getByTestId('search-input-field').props.placeholder).toBe(
      'Search titles, authors, subjects, and descriptions',
    );
  });

  it('says outright that it does not search inside books', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    expect(screen.getByTestId('search-helper').props.children).toBe(
      'Catalogue metadata only — this does not search inside books.',
    );
  });
});

// ─── Query state ─────────────────────────────────────────────────────────────

describe('query state', () => {
  it('asks nothing until a query is submitted', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await fireEvent.changeText(screen.getByTestId('search-input-field'), 'clim');

    expect(pipeline.searchCalls).toEqual([]);
    expect(screen.getByTestId('search-idle')).toBeTruthy();
  });

  it('sends the committed query on submit', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));
    expect(pipeline.searchCalls[0]).toEqual({
      institutionId: 'inst_7f3',
      query: 'climate',
      filters: {},
    });
  });

  it('shows skeletons while the request is in flight', async () => {
    // Never resolves — the loading state is the whole assertion.
    setSearchPipeline(stub(() => new Promise<SearchFeed>(() => {})));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getAllByTestId('content-card-skeleton')).toHaveLength(3));
  });
});

// ─── Results ─────────────────────────────────────────────────────────────────

describe('successful results', () => {
  it('renders a row per publication, in the order the server sent them', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST, SECOND] }))));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getAllByTestId('content-card-title')).toHaveLength(2));
    expect(screen.getAllByTestId('content-card-title')[0].props.children).toBe(
      'Environmental Policy in China',
    );
  });

  it('reports the server total rather than the page length', async () => {
    setSearchPipeline(
      stub(() => Promise.resolve(feed({ publications: [FIRST], totalItems: 3 }))),
    );
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('search-total')).toBeTruthy());
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy();
  });

  it('opens detail for a row that was tapped', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('content-card')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('content-card'));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_env' });
  });

  it('renders no empty state and no error alongside results', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('content-card')).toBeTruthy());
    expect(screen.queryByTestId('search-empty')).toBeNull();
    expect(screen.queryByTestId('search-error')).toBeNull();
  });
});

// ─── Filters as query parameters, before pagination ──────────────────────────

describe('filters are part of the request', () => {
  it('sends a selected contentType as part of the search', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));

    await fireEvent.press(screen.getByLabelText('Audiobooks'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1]).toEqual({
      institutionId: 'inst_7f3',
      query: 'climate',
      filters: { contentType: 'AUDIO' },
    });
  });

  // The banned flow is fetch a page, then narrow it locally. A filter change
  // starts a NEW search, which is why the cursor is not followed here.
  it('re-searches from the beginning rather than paging or filtering in place', async () => {
    const pipeline = stub(() =>
      Promise.resolve(feed({ publications: [FIRST], next: 'https://api.tf/search?page=1' })),
    );
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('eBooks'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.nextCalls).toEqual([]);
  });

  it('clears the dimension again through the All chip', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));

    await fireEvent.press(screen.getByLabelText('All'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(3));
    expect(pipeline.searchCalls[2].filters).toEqual({});
  });

  it('records a filter without searching when no query has been committed', async () => {
    const pipeline = stub(() => Promise.resolve(feed()));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await fireEvent.press(screen.getByLabelText('Audiobooks'));

    expect(pipeline.searchCalls).toEqual([]);
  });
});

// Q-12 resolved: wokay's contract confirms `accessTier` as a real filter
// parameter, so the dimension is enabled and a selected tier is sent.
describe('access tier is enabled now that Q-12 is resolved', () => {
  it('renders a chip per tier', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    expect(screen.getByLabelText('Open access')).toBeTruthy();
    expect(screen.getByLabelText('Subscription')).toBeTruthy();
    expect(screen.getByLabelText('Elite')).toBeTruthy();
  });

  it('announces every tier chip as enabled', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    for (const label of ['Open access', 'Subscription', 'Elite']) {
      expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({
        disabled: false,
      });
    }
  });

  it('shows no "awaiting confirmation" note', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    expect(screen.queryByTestId('search-tier-note')).toBeNull();
  });

  it('starts a new search carrying the tier when a tier chip is pressed', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));

    await fireEvent.press(screen.getByLabelText('Elite'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1]?.filters).toEqual({ accessTier: 'ELITE' });
  });
});

// ─── Zero results ────────────────────────────────────────────────────────────

// A SUCCESSFUL RESPONSE WITH NOTHING IN IT. The distinction this suite protects
// is that none of it renders as an error.
describe('a zero-result response', () => {
  it('says no publications were found', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [] }))));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.getByText('No publications found')).toBeTruthy();
  });

  it('does NOT render the error state', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [] }))));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.queryByTestId('search-error')).toBeNull();
    expect(screen.queryByTestId('search-retry')).toBeNull();
  });

  it('names the query that found nothing', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [] }))));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() =>
      expect(screen.getByText(/quantum basket weaving/)).toBeTruthy(),
    );
  });

  it('offers no next page', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [] }))));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.queryByTestId('search-load-more')).toBeNull();
  });
});

// The response the whole zero-result design is for: a navigation feed with NO
// `publications` key at all, carrying browse targets instead.
describe('a response with no publications key, carrying browseInstead', () => {
  // What normalizeSearchFeed hands over for exactly that payload.
  const asNormalized = feed({ browseInstead: BROWSE });

  it('is a valid empty state, not a malformed feed', async () => {
    setSearchPipeline(stub(() => Promise.resolve(asNormalized)));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.queryByTestId('search-error')).toBeNull();
  });

  it('renders the browse-instead affordance from the returned data', async () => {
    setSearchPipeline(stub(() => Promise.resolve(asNormalized)));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-browse-instead')).toBeTruthy());
    expect(screen.getByText('Browse instead')).toBeTruthy();
  });

  it('renders a card per returned target', async () => {
    setSearchPipeline(stub(() => Promise.resolve(asNormalized)));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getAllByTestId('category-card')).toHaveLength(2));
  });

  it('shows no browse section when the response offered none', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.queryByTestId('search-browse-instead')).toBeNull();
  });
});

// ─── Pagination ──────────────────────────────────────────────────────────────

describe('pagination is driven by the next value', () => {
  const CURSOR = 'https://api.tf/opds/v1/institutions/inst_7f3/search?query=climate&page=1';

  function paged() {
    return stub(
      () => Promise.resolve(feed({ publications: [FIRST], totalItems: 2, next: CURSOR })),
      () => Promise.resolve(feed({ publications: [SECOND], totalItems: 2 })),
    );
  }

  it('offers a next affordance only when the response carried a next', async () => {
    setSearchPipeline(paged());
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
  });

  it('offers none on a response with no next', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('content-card')).toBeTruthy());
    expect(screen.queryByTestId('search-load-more')).toBeNull();
  });

  it('requests the next value verbatim, never a page number', async () => {
    const pipeline = paged();
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-load-more'));

    await waitFor(() => expect(pipeline.nextCalls).toEqual([CURSOR]));
  });

  it('appends the next page below the results already read', async () => {
    setSearchPipeline(paged());
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-load-more'));

    await waitFor(() => expect(screen.getAllByTestId('content-card-title')).toHaveLength(2));
    const titles = screen.getAllByTestId('content-card-title').map((node) => node.props.children);
    expect(titles).toEqual(['Environmental Policy in China', 'Ethnographies of Waiting']);
  });

  it('withdraws the affordance once the last page has no next', async () => {
    setSearchPipeline(paged());
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-load-more'));

    await waitFor(() => expect(screen.queryByTestId('search-load-more')).toBeNull());
  });

  it('does not re-send the search when paging', async () => {
    const pipeline = paged();
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-load-more'));

    await waitFor(() => expect(pipeline.nextCalls).toHaveLength(1));
    expect(pipeline.searchCalls).toHaveLength(1);
  });
});

// ─── Errors ──────────────────────────────────────────────────────────────────

describe('an actual failure', () => {
  function failing(code: CatalogueError) {
    return stub(() => Promise.reject(new CatalogueFailure(code, 'search')));
  }

  it('renders the error state', async () => {
    setSearchPipeline(failing(CatalogueError.NETWORK_UNAVAILABLE));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('search-error')).toBeTruthy());
  });

  it('says what went wrong in wokay’s own vocabulary, never an HTTP status', async () => {
    setSearchPipeline(failing(CatalogueError.NETWORK_UNAVAILABLE));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByText('You appear to be offline.')).toBeTruthy());
  });

  it('distinguishes a timeout from being offline', async () => {
    setSearchPipeline(failing(CatalogueError.TIMEOUT));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() =>
      expect(screen.getByText('The search took too long to answer.')).toBeTruthy(),
    );
  });

  it('is not the empty state', async () => {
    setSearchPipeline(failing(CatalogueError.TIMEOUT));
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getByTestId('search-error')).toBeTruthy());
    expect(screen.queryByTestId('search-empty')).toBeNull();
  });

  it('retries the search', async () => {
    let attempt = 0;
    const pipeline = stub(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new CatalogueFailure(CatalogueError.TIMEOUT, 'search'))
        : Promise.resolve(feed({ publications: [FIRST] }));
    });
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-retry')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-retry'));

    await waitFor(() => expect(screen.getByTestId('content-card')).toBeTruthy());
  });

  // A next page that failed is no reason to throw away what the reader is
  // part-way through, so this is a different treatment from a failed search.
  it('keeps the results already read when a next page fails', async () => {
    const pipeline = stub(
      () => Promise.resolve(feed({ publications: [FIRST], next: 'cursor' })),
      () => Promise.reject(new CatalogueFailure(CatalogueError.TIMEOUT, 'next')),
    );
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(screen.getByTestId('search-load-more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('search-load-more'));

    await waitFor(() => expect(screen.getByTestId('search-page-error')).toBeTruthy());
    expect(screen.getByTestId('content-card')).toBeTruthy();
    expect(screen.queryByTestId('search-error')).toBeNull();
  });
});
