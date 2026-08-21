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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { setSearchPipeline } from '@config/search';
// The Jest double registered globally in jest.setup.js — importing it here is
// how the voice block below states the permission answer and drives the
// recogniser's events. See the file for what it does and does not fake.
import { mockSpeechRecognition } from '@search/MockSpeechRecognition';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import type { NavLink, Publication, SearchFeed } from '@model/types';
import type { CatalogueSearchPipeline, SearchRequest } from '@/search';
import { useRecentSearchesStore } from '@store/recentSearchesStore';

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

function publication(
  id: string,
  title: string,
  publisher: string,
  licenceModel: Publication['acquisition']['licenceModel'] = 'OPEN_ACCESS',
): Publication {
  return {
    id,
    title,
    publisher,
    authors: [],
    subjects: [],
    format: 'EPUB',
    acquisition: {
      actionId: licenceModel === 'OPEN_ACCESS' ? 'openAccess' : 'borrow',
      href: `https://api.tf/api/v1/reading-sessions?itemId=${id}`,
      licenceModel,
      encryption: null,
      hasSearchIndex: true,
      canPersist: true,
    },
  };
}

const FIRST = publication('item_env', 'Environmental Policy in China', 'Routledge');
const SECOND = publication('item_ab6', 'Ethnographies of Waiting', 'CRC Press');
const SUBSCRIPTION_ITEM = publication(
  'item_sub',
  'Advanced Ethnographic Methods',
  'CRC Press',
  'SUBSCRIPTION',
);

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
  // The recent-searches store is a module singleton — every submit() in this
  // file writes to it, so it must not leak from one test into the next.
  useRecentSearchesStore.getState().clear();
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

// ─── Recent searches ─────────────────────────────────────────────────────────
// Client-side only (recentSearchesStore.ts) — nothing here goes near a pipeline.

describe('recent searches', () => {
  it('shows nothing before any search has been submitted', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    expect(screen.queryByTestId('search-recent')).toBeNull();
  });

  it('remembers a submitted query and offers it back', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');
    await fireEvent.press(screen.getByTestId('search-input-clear'));

    await waitFor(() => expect(screen.getByTestId('search-recent')).toBeTruthy());
    expect(screen.getByText('climate')).toBeTruthy();
  });

  it('re-runs a recent query when it is tapped', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await fireEvent.press(screen.getByTestId('search-input-clear'));
    await waitFor(() => expect(screen.getByText('climate')).toBeTruthy());

    await fireEvent.press(screen.getByText('climate'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1]).toMatchObject({ query: 'climate' });
  });

  it('hides the list again once a fresh query is being typed', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');
    await fireEvent.press(screen.getByTestId('search-input-clear'));
    await waitFor(() => expect(screen.getByTestId('search-recent')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('search-input-field'), 'open');

    expect(screen.queryByTestId('search-recent')).toBeNull();
  });

  it('clears every remembered query', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
    await render(<SearchScreen />);

    await submit('climate');
    await fireEvent.press(screen.getByTestId('search-input-clear'));
    await waitFor(() => expect(screen.getByTestId('search-recent-clear')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('search-recent-clear'));

    expect(screen.queryByTestId('search-recent')).toBeNull();
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

  it('renders one access-tier badge per result, resolved per row', async () => {
    setSearchPipeline(
      stub(() => Promise.resolve(feed({ publications: [FIRST, SUBSCRIPTION_ITEM] }))),
    );
    await render(<SearchScreen />);

    await submit('climate');

    await waitFor(() => expect(screen.getAllByTestId('content-card-badge')).toHaveLength(2));
    const badges = screen.getAllByTestId('content-card-badge');
    expect(within(badges[0]).getByText('Open Access')).toBeTruthy();
    expect(within(badges[1]).getByText('Subscription')).toBeTruthy();
  });
});

// ─── Filters as query parameters, before pagination ──────────────────────────

// Every dimension lives behind one "Filter and sort" trigger and a sheet —
// same component ShelfScreen already uses. A chip is never reachable until the
// sheet is open, and nothing re-searches until Apply is pressed.
async function openFilterSheet() {
  await fireEvent.press(screen.getByLabelText('Filter and sort'));
}

async function applyFilters() {
  await fireEvent.press(screen.getByTestId('filter-sort-sheet-apply'));
}

describe('filters are part of the request', () => {
  it('sends a selected contentType as part of the search', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await applyFilters();

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

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('eBooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('eBooks'));
    await applyFilters();

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.nextCalls).toEqual([]);
  });

  it('clears the dimension again through the All chip', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await applyFilters();
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));

    await openFilterSheet();
    // Both dimensions offer an "All" chip inside the sheet — content type's
    // renders first, so index 0 is the one this test means to press.
    await waitFor(() => expect(screen.getAllByLabelText('All')).toHaveLength(2));
    await fireEvent.press(screen.getAllByLabelText('All')[0]);
    await applyFilters();

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(3));
    expect(pipeline.searchCalls[2].filters).toEqual({});
  });

  it('records a filter without searching when no query has been committed', async () => {
    const pipeline = stub(() => Promise.resolve(feed()));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await applyFilters();

    expect(pipeline.searchCalls).toEqual([]);
  });
});

// Q-12 resolved: wokay's contract confirms `accessTier` as a real filter
// parameter, so the dimension is enabled and a selected tier is sent.
describe('access tier is enabled now that Q-12 is resolved', () => {
  it('renders a chip per tier', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await openFilterSheet();

    await waitFor(() => expect(screen.getByLabelText('Open access')).toBeTruthy());
    expect(screen.getByLabelText('Subscription')).toBeTruthy();
    expect(screen.getByLabelText('Elite')).toBeTruthy();
  });

  it('announces every tier chip as enabled', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Open access')).toBeTruthy());

    for (const label of ['Open access', 'Subscription', 'Elite']) {
      expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({
        disabled: false,
      });
    }
  });

  it('starts a new search carrying the tier when a tier chip is pressed', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Elite')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Elite'));
    await applyFilters();

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1]?.filters).toEqual({ accessTier: 'ELITE' });
  });
});

// Both dimensions live in one sheet session, so one Apply press must commit
// both together rather than one silently overwriting the other.
describe('applying more than one filter dimension at once', () => {
  it('sends both filters together from a single Apply press', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await submit('climate');
    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await fireEvent.press(screen.getByLabelText('Elite'));
    await applyFilters();

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1].filters).toEqual({
      contentType: 'AUDIO',
      accessTier: 'ELITE',
    });
  });
});

// Search has no sort parameter at all (searchCatalogue's own contract carries
// none) — unlike ShelfScreen, this is not conditional on which shelf is open.
describe('sort is not offered for search', () => {
  it('always greys the sort row with an explanatory note', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await openFilterSheet();

    await waitFor(() => expect(screen.getByLabelText('Newest')).toBeTruthy());
    expect(screen.getByTestId('filter-sort-sheet-sort-note')).toBeTruthy();
    expect(screen.getByLabelText('Newest').props.accessibilityState).toMatchObject({
      disabled: true,
    });
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
    expect(
      screen.getByText('No articles or books match “quantum basket weaving”.'),
    ).toBeTruthy();
  });

  it('shows the filter-narrowed message instead when a filter is active', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [] }))));
    await render(<SearchScreen />);

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await applyFilters();
    await submit('quantum basket weaving');

    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
    expect(screen.getByText('Try adjusting your filters.')).toBeTruthy();
  });

  it('clearing filters from the empty state starts a new, unfiltered search', async () => {
    const pipeline = stub(() => Promise.resolve(feed({ publications: [] })));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await openFilterSheet();
    await waitFor(() => expect(screen.getByLabelText('Audiobooks')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Audiobooks'));
    await applyFilters();
    await submit('quantum basket weaving');
    await waitFor(() => expect(screen.getByText('Clear filters')).toBeTruthy());

    await fireEvent.press(screen.getByText('Clear filters'));

    await waitFor(() => expect(pipeline.searchCalls).toHaveLength(2));
    expect(pipeline.searchCalls[1].filters).toEqual({});
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
      expect(screen.getByText('This took too long to respond.')).toBeTruthy(),
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
    await waitFor(() => expect(screen.getByLabelText('Retry')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Retry'));

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

// ─── Screen 11 — voice search ────────────────────────────────────────────────

// WHAT THIS BLOCK IS FOR: proving that speech becomes an ORDINARY query. Voice
// adds no endpoint, no second pipeline and no new error surface, so almost every
// assertion below is that an existing path was reached — `searchCalls`,
// `search-error`, `search-empty`, the recent-searches store. The genuinely new
// claims are narrow: a refusal must not search, a silence must not search, and a
// cancel must not search.
//
// The native module is mocked globally (jest.setup.js → MockSpeechRecognition).
// It fakes the module surface and the event stream; the permission answer and
// the recognition events are stated by each test, because those are exactly what
// a real device decides. No microphone and no OS dialog is exercised here.
describe('voice search', () => {
  beforeEach(() => {
    mockSpeechRecognition.reset();
  });

  // Opens the overlay and gets as far as an open microphone.
  async function pressMic() {
    await fireEvent.press(screen.getByTestId('search-input-voice'));
    await waitFor(() => expect(mockSpeechRecognition.isRunning()).toBe(true));
    await act(async () => {
      mockSpeechRecognition.emit('start', null);
    });
  }

  async function say(words: string) {
    await act(async () => {
      mockSpeechRecognition.emitTranscript(words);
    });
  }

  // The recogniser stops hearing speech, resolves a final, and closes.
  async function stopSpeaking() {
    await act(async () => {
      mockSpeechRecognition.emit('speechend', null);
      mockSpeechRecognition.emit('end', null);
    });
  }

  it('opens the listening surface when the mic is pressed', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await pressMic();

    expect(screen.getByTestId('voice-overlay')).toBeTruthy();
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  // The transcript has to appear as it is spoken — it is the only evidence the
  // microphone is working, and the mockup shows it growing under the disc.
  it('asks the recogniser for interim results', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await pressMic();

    expect(mockSpeechRecognition.startCalls()).toHaveLength(1);
    expect(mockSpeechRecognition.startCalls()[0]).toMatchObject({ interimResults: true });
  });

  it('shows partial results as they arrive', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await pressMic();
    await say('machine');
    expect(screen.getByText('machine')).toBeTruthy();

    await say('machine learning');
    expect(screen.getByText('machine learning')).toBeTruthy();
  });

  // ── Regression: the session-counter race ───────────────────────────────────

  // Two mic presses committed in ONE React batch. `fireEvent` is act()-wrapped,
  // so nesting both inside an outer act() defers the passive effects until the
  // batch closes — which is exactly the window the bug needed, and the one a
  // pair of ordinary awaited presses can never produce.
  //
  // The bug: the hook kept its own session counter beside the reducer's and
  // guarded it with a copy of the state that a passive effect updated. Batched
  // presses advanced that counter twice while the reducer accepted one session,
  // and the two never resynchronised — every event belonging to the session that
  // actually ran was then rejected as stale.
  //
  // It does not crash and it does not look broken: `checkingPermission` renders
  // as "Listening…", so the overlay sits there looking healthy over a live
  // microphone it is ignoring. The assertion therefore has to be that speech
  // still reaches the surface, not that something threw.
  describe('two mic presses in a single React batch', () => {
    async function doublePressMic() {
      await act(async () => {
        fireEvent.press(screen.getByTestId('search-input-voice'));
        fireEvent.press(screen.getByTestId('search-input-voice'));
      });
      await waitFor(() => expect(mockSpeechRecognition.isRunning()).toBe(true));
    }

    it('starts exactly one recogniser', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await doublePressMic();

      expect(mockSpeechRecognition.startCalls()).toHaveLength(1);
    });

    // The discriminator. Under the old counter this transcript never arrived.
    it('still delivers the transcript to the surface', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await doublePressMic();
      await act(async () => {
        mockSpeechRecognition.emit('start', null);
        mockSpeechRecognition.emitTranscript('machine learning');
      });

      expect(screen.getByText('machine learning')).toBeTruthy();
    });

    // The drift was permanent, not per-session: once the two counters parted,
    // every later session was dead too. So the cycle after it has to work.
    it('leaves the next session working after a cancel', async () => {
      const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await doublePressMic();
      await fireEvent.press(screen.getByTestId('voice-overlay-cancel'));

      // A whole fresh session, end to end.
      await pressMic();
      await say('climate');
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));
      expect(pipeline.searchCalls[0].query).toBe('climate');
    });
  });

  // ── Permission ─────────────────────────────────────────────────────────────

  describe('when the microphone is refused', () => {
    it('says so, in copy that names the fix', async () => {
      mockSpeechRecognition.setPermissionGranted(false);
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await fireEvent.press(screen.getByTestId('search-input-voice'));

      await waitFor(() => expect(screen.getByTestId('voice-overlay-error')).toBeTruthy());
      expect(
        screen.getByText('Microphone access is off. Turn it on in Settings to search by voice.'),
      ).toBeTruthy();
    });

    it('never opens the microphone', async () => {
      mockSpeechRecognition.setPermissionGranted(false);
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await fireEvent.press(screen.getByTestId('search-input-voice'));

      await waitFor(() => expect(screen.getByTestId('voice-overlay-error')).toBeTruthy());
      expect(mockSpeechRecognition.startCalls()).toHaveLength(0);
    });

    // The one that matters: a refusal is not a query.
    it('starts no search', async () => {
      mockSpeechRecognition.setPermissionGranted(false);
      const pipeline = stub(() => Promise.resolve(feed()));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await fireEvent.press(screen.getByTestId('search-input-voice'));

      await waitFor(() => expect(screen.getByTestId('voice-overlay-error')).toBeTruthy());
      expect(pipeline.searchCalls).toHaveLength(0);
    });
  });

  // ── The transcript becomes a query ─────────────────────────────────────────

  describe('a recognised transcript', () => {
    it('sends the transcript to the search pipeline, unchanged', async () => {
      const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await pressMic();
      await say('machine learning in healthcare');
      await stopSpeaking();

      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));
      expect(pipeline.searchCalls[0].query).toBe('machine learning in healthcare');
    });

    // Same store, same cap, same dedupe as a typed query — a voice search is a
    // search, so it belongs in the list of recent ones.
    it('is remembered as a recent search', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
      await render(<SearchScreen />);

      await pressMic();
      await say('climate');
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() =>
        expect(useRecentSearchesStore.getState().queries).toContain('climate'),
      );
    });

    it('closes the overlay, revealing the results underneath', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed({ publications: [FIRST] }))));
      await render(<SearchScreen />);

      await pressMic();
      await say('climate');
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(screen.getByTestId('content-card')).toBeTruthy());
      expect(screen.queryByTestId('voice-overlay')).toBeNull();
      expect(screen.getByText('Environmental Policy in China')).toBeTruthy();
    });

    // The mockup shows Search live while the title still reads "Listening…",
    // so a reader may commit before the recogniser decides they have stopped.
    // The overlay must still close, and the microphone must still shut.
    it('can be committed mid-utterance, closing the microphone with it', async () => {
      const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await pressMic();
      await say('machine learning');
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(pipeline.searchCalls).toHaveLength(1));
      expect(pipeline.searchCalls[0].query).toBe('machine learning');
      expect(screen.queryByTestId('voice-overlay')).toBeNull();
      expect(mockSpeechRecognition.isRunning()).toBe(false);
    });

    // Voice adds no error surface of its own. Once the transcript is submitted
    // it is an ordinary search and fails like one.
    it('renders a post-recognition failure through the existing search error', async () => {
      setSearchPipeline(
        stub(() => Promise.reject(new CatalogueFailure(CatalogueError.TIMEOUT, 'search'))),
      );
      await render(<SearchScreen />);

      await pressMic();
      await say('climate');
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(screen.getByTestId('search-error')).toBeTruthy());
      expect(screen.getByText('This took too long to respond.')).toBeTruthy();
    });

    it('renders zero results through the existing empty state, not an error', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await pressMic();
      await say('quantum basket weaving');
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-submit'));

      await waitFor(() => expect(screen.getByTestId('search-empty')).toBeTruthy());
      expect(screen.queryByTestId('search-error')).toBeNull();
    });
  });

  // ── The two ways a session ends without a query ────────────────────────────

  describe('when nothing was heard', () => {
    it('says so rather than reporting a breakage', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await pressMic();
      await stopSpeaking();

      expect(screen.getByText('No speech was heard. Try again.')).toBeTruthy();
    });

    it('starts no search', async () => {
      const pipeline = stub(() => Promise.resolve(feed()));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await pressMic();
      await stopSpeaking();

      expect(pipeline.searchCalls).toHaveLength(0);
      expect(screen.queryByTestId('search-empty')).toBeNull();
    });

    // Clear is the recovery, and it must reopen the microphone rather than
    // leaving the reader on a dead surface.
    it('offers a retry that listens again', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await pressMic();
      await stopSpeaking();
      await fireEvent.press(screen.getByTestId('voice-overlay-clear'));

      await waitFor(() => expect(mockSpeechRecognition.startCalls()).toHaveLength(2));
      expect(screen.queryByTestId('voice-overlay-error')).toBeNull();
    });
  });

  describe('when the reader cancels', () => {
    it('starts no search, even with a transcript on screen', async () => {
      const pipeline = stub(() => Promise.resolve(feed({ publications: [FIRST] })));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await pressMic();
      await say('climate');
      await fireEvent.press(screen.getByTestId('voice-overlay-cancel'));

      expect(pipeline.searchCalls).toHaveLength(0);
      expect(screen.queryByTestId('voice-overlay')).toBeNull();
    });

    it('closes the microphone', async () => {
      setSearchPipeline(stub(() => Promise.resolve(feed())));
      await render(<SearchScreen />);

      await pressMic();
      await fireEvent.press(screen.getByTestId('voice-overlay-cancel'));

      expect(mockSpeechRecognition.isRunning()).toBe(false);
    });

    // The native recogniser keeps emitting after abort(). A trailing end would
    // otherwise put a dismissed overlay back on screen as "no speech heard".
    it('ignores the events the recogniser emits after it was stopped', async () => {
      const pipeline = stub(() => Promise.resolve(feed()));
      setSearchPipeline(pipeline);
      await render(<SearchScreen />);

      await pressMic();
      await say('climate');
      await fireEvent.press(screen.getByTestId('voice-overlay-cancel'));

      await act(async () => {
        mockSpeechRecognition.emitTranscript('climate change', true);
        mockSpeechRecognition.emit('end', null);
      });

      expect(screen.queryByTestId('voice-overlay')).toBeNull();
      expect(pipeline.searchCalls).toHaveLength(0);
    });
  });

  // ── A recogniser that broke ────────────────────────────────────────────────

  it('reports a recogniser failure without starting a search', async () => {
    const pipeline = stub(() => Promise.resolve(feed()));
    setSearchPipeline(pipeline);
    await render(<SearchScreen />);

    await pressMic();
    await act(async () => {
      mockSpeechRecognition.emit('error', { error: 'network', message: 'no connection' });
      mockSpeechRecognition.emit('end', null);
    });

    expect(screen.getByText('You appear to be offline.')).toBeTruthy();
    expect(pipeline.searchCalls).toHaveLength(0);
  });

  it('keeps a device with no recogniser out of the retry loop', async () => {
    setSearchPipeline(stub(() => Promise.resolve(feed())));
    await render(<SearchScreen />);

    await pressMic();
    await act(async () => {
      mockSpeechRecognition.emit('error', {
        error: 'service-not-allowed',
        message: 'no recognition service',
      });
    });

    expect(
      screen.getByText('Voice search is not available on this device. Type your search instead.'),
    ).toBeTruthy();
  });
});
