// src/search/searchState.test.ts
// Query state, tested as a pure function — no render, no pipeline, no timers.
// That is the payoff for keeping the transitions out of the hook: every rule the
// surface depends on is asserted here in a line, including the three that are
// only visible as bugs much later (a filter change that forgot to drop the
// cursor, an empty response rendered as an error, a superseded response applied
// on arrival).
import { CatalogueError } from '@model/errors';
import type { NavLink, Publication, SearchFeed } from '@model/types';

import { initialSearchState, searchReducer, type SearchAction, type SearchState } from '@search/searchState';

// Enough of a Publication to be one. Cast-free construction would mean spelling
// out an Acquisition per row, which tests nothing about the reducer — so the two
// rows below are built once, honestly typed, and reused.
function publication(id: string, title: string): Publication {
  return {
    id,
    title,
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

const FIRST = publication('item_env', 'Environmental Policy and Air Pollution in China');
const SECOND = publication('item_ab6', 'Ethnographies of Waiting');

const BROWSE: NavLink[] = [
  { title: 'eBooks', href: 'https://api.tf/groups/ebooks', shelfId: 'ebooks', target: 'shelf' },
];

function feed(overrides: Partial<SearchFeed> = {}): SearchFeed {
  return { publications: [], browseInstead: [], ...overrides };
}

// Runs a sequence from the initial state, so each test reads as the interaction
// it describes rather than as a hand-assembled state object.
function run(...actions: SearchAction[]): SearchState {
  return actions.reduce(searchReducer, initialSearchState);
}

// The id the surface is currently waiting on — what an outcome must echo to be
// applied.
function search(query: string): SearchAction[] {
  return [{ type: 'draftChanged', draft: query }, { type: 'submitted' }];
}

describe('typing is not searching', () => {
  it('records the draft without starting a request', () => {
    const state = run({ type: 'draftChanged', draft: 'clim' });

    expect(state.draft).toBe('clim');
    expect(state.status).toBe('idle');
    expect(state.requestId).toBe(0);
  });

  it('leaves the committed query untouched until submit', () => {
    expect(run({ type: 'draftChanged', draft: 'clim' }).query).toBe('');
  });
});

describe('submitting a query', () => {
  it('commits it, trimmed, and starts one request', () => {
    const state = run(...search('  climate  '));

    expect(state.query).toBe('climate');
    expect(state.status).toBe('loading');
    expect(state.requestId).toBe(1);
  });

  // Firing a blank query at an entitlement-scoped endpoint is worse than doing
  // nothing, and "no publications found" for a question nobody asked is a lie.
  it('starts nothing for a blank query and stays idle', () => {
    const state = run(...search('   '));

    expect(state.status).toBe('idle');
    expect(state.requestId).toBe(0);
  });

  it('discards the previous answer before the new one arrives', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      ...search('policy'),
    );

    expect(state.publications).toEqual([]);
    expect(state.next).toBeUndefined();
    expect(state.status).toBe('loading');
  });
});

describe('clearing the field', () => {
  it('returns to idle with nothing on screen', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST] }) },
      { type: 'cleared' },
    );

    expect(state.draft).toBe('');
    expect(state.query).toBe('');
    expect(state.status).toBe('idle');
    expect(state.publications).toEqual([]);
  });

  // The chips are still visibly selected, so clearing them silently would make
  // the surface disagree with itself.
  it('keeps the filters, which are still on screen', () => {
    const state = run(
      { type: 'filterChanged', filters: { contentType: 'AUDIO' } },
      { type: 'cleared' },
    );

    expect(state.filters).toEqual({ contentType: 'AUDIO' });
  });

  it('invalidates a response still in flight', () => {
    const state = run(
      ...search('climate'),
      { type: 'cleared' },
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST] }) },
    );

    expect(state.publications).toEqual([]);
    expect(state.status).toBe('idle');
  });
});

// THE RULE THE WHOLE FEATURE TURNS ON. Filters are part of the request, so
// changing one starts a new search from the beginning. It never narrows the page
// already on screen, and the cursor into the old result set is dropped because it
// does not point into the new one.
describe('filters happen before pagination', () => {
  it('starts a fresh request when a filter changes', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      { type: 'filterChanged', filters: { contentType: 'AUDIO' } },
    );

    expect(state.status).toBe('loading');
    expect(state.requestId).toBe(2);
  });

  it('throws away the page in hand rather than filtering it locally', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      { type: 'filterChanged', filters: { contentType: 'AUDIO' } },
    );

    expect(state.publications).toEqual([]);
  });

  it('drops the cursor, which pointed into the unfiltered set', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      { type: 'filterChanged', filters: { contentType: 'AUDIO' } },
    );

    expect(state.next).toBeUndefined();
  });

  it('keeps the committed query, so a filter refines the same search', () => {
    const state = run(
      ...search('climate'),
      { type: 'filterChanged', filters: { contentType: 'PDF' } },
    );

    expect(state.query).toBe('climate');
  });

  it('merges dimensions rather than replacing the set', () => {
    const state = run(
      { type: 'filterChanged', filters: { contentType: 'PDF' } },
      { type: 'filterChanged', filters: { accessTier: 'OPEN_ACCESS' } },
    );

    expect(state.filters).toEqual({ contentType: 'PDF', accessTier: 'OPEN_ACCESS' });
  });

  // "No constraint" gets exactly one representation, so nothing downstream has to
  // treat a present-but-undefined key as absent.
  it('deletes a dimension set back to no constraint', () => {
    const state = run(
      { type: 'filterChanged', filters: { contentType: 'PDF' } },
      { type: 'filterChanged', filters: { contentType: undefined } },
    );

    expect(state.filters).toEqual({});
  });

  it('records a filter without searching when no query has been committed', () => {
    const state = run({ type: 'filterChanged', filters: { contentType: 'PDF' } });

    expect(state.filters).toEqual({ contentType: 'PDF' });
    expect(state.status).toBe('idle');
    expect(state.requestId).toBe(0);
  });
});

describe('results arriving', () => {
  it('renders the page and settles', () => {
    const state = run(
      ...search('climate'),
      {
        type: 'pageArrived',
        requestId: 1,
        feed: feed({ publications: [FIRST], totalItems: 3, next: 'p2' }),
      },
    );

    expect(state.status).toBe('results');
    expect(state.publications).toEqual([FIRST]);
    expect(state.totalItems).toBe(3);
    expect(state.next).toBe('p2');
  });

  it('clears a previous error', () => {
    const state = run(
      ...search('climate'),
      { type: 'requestFailed', requestId: 1, code: CatalogueError.TIMEOUT },
      { type: 'retried' },
      { type: 'pageArrived', requestId: 2, feed: feed({ publications: [FIRST] }) },
    );

    expect(state.errorCode).toBeUndefined();
    expect(state.status).toBe('results');
  });

  // A response for a request nobody is waiting on any more. Applying it would show
  // results for a query the reader has already moved on from.
  it('ignores a superseded response', () => {
    const state = run(
      ...search('climate'),
      ...search('policy'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST] }) },
    );

    expect(state.status).toBe('loading');
    expect(state.publications).toEqual([]);
  });
});

// A SUCCESSFUL RESPONSE WITH NOTHING IN IT IS NOT AN ERROR, and nothing in the
// reducer can reach `error` from a well-formed response. This is the distinction
// the surface renders differently and the one most easily collapsed by accident.
describe('a zero-result response', () => {
  it('settles on empty, not error', () => {
    const state = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: feed({ publications: [] }),
    });

    expect(state.status).toBe('empty');
    expect(state.errorCode).toBeUndefined();
  });

  it('carries the browse-instead targets the response offered', () => {
    const state = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: feed({ publications: [], browseInstead: BROWSE }),
    });

    expect(state.status).toBe('empty');
    expect(state.browseInstead).toEqual(BROWSE);
  });

  // The response that omitted `publications` altogether: `normalizeSearchFeed`
  // hands it over as an empty array, so it lands here identically.
  it('is the same state whether publications was empty or absent', () => {
    const absent = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: { browseInstead: BROWSE, publications: [] },
    });

    expect(absent.status).toBe('empty');
    expect(absent.browseInstead).toEqual(BROWSE);
  });

  it('offers no next page', () => {
    const state = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: feed({ browseInstead: BROWSE }),
    });

    expect(state.next).toBeUndefined();
  });
});

describe('pagination follows the response next value', () => {
  const withFirstPage = [
    ...search('climate'),
    {
      type: 'pageArrived' as const,
      requestId: 1,
      feed: feed({ publications: [FIRST], totalItems: 3, next: 'p2' }),
    },
  ];

  it('starts a request for the next page', () => {
    const state = run(...withFirstPage, { type: 'nextRequested' });

    expect(state.status).toBe('paging');
    expect(state.requestId).toBe(2);
  });

  it('keeps the results already read on screen while paging', () => {
    const state = run(...withFirstPage, { type: 'nextRequested' });

    expect(state.publications).toEqual([FIRST]);
  });

  it('appends the next page rather than replacing the list', () => {
    const state = run(...withFirstPage, { type: 'nextRequested' }, {
      type: 'pageArrived',
      requestId: 2,
      feed: feed({ publications: [SECOND], totalItems: 3 }),
    });

    expect(state.publications).toEqual([FIRST, SECOND]);
    expect(state.status).toBe('results');
  });

  it('stops offering a next page once the response carries none', () => {
    const state = run(...withFirstPage, { type: 'nextRequested' }, {
      type: 'pageArrived',
      requestId: 2,
      feed: feed({ publications: [SECOND] }),
    });

    expect(state.next).toBeUndefined();
  });

  it('does nothing without a cursor, so no page can be invented', () => {
    const state = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: feed({ publications: [FIRST] }),
    });

    expect(searchReducer(state, { type: 'nextRequested' })).toBe(state);
  });

  // A double tap must not queue two requests for the same cursor.
  it('ignores a second request while one is already in flight', () => {
    const paging = run(...withFirstPage, { type: 'nextRequested' });

    expect(searchReducer(paging, { type: 'nextRequested' })).toBe(paging);
  });
});

describe('an actual failure', () => {
  it('is its own state, carrying the code the copy is keyed on', () => {
    const state = run(...search('climate'), {
      type: 'requestFailed',
      requestId: 1,
      code: CatalogueError.NETWORK_UNAVAILABLE,
    });

    expect(state.status).toBe('error');
    expect(state.errorCode).toBe(CatalogueError.NETWORK_UNAVAILABLE);
  });

  it('has nothing on screen when the first search failed', () => {
    const state = run(...search('climate'), {
      type: 'requestFailed',
      requestId: 1,
      code: CatalogueError.TIMEOUT,
    });

    expect(state.publications).toEqual([]);
  });

  // A next page that failed is no reason to throw away twenty results the reader
  // is part-way through.
  it('keeps the results already read when a next page failed', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      { type: 'nextRequested' },
      { type: 'requestFailed', requestId: 2, code: CatalogueError.TIMEOUT },
    );

    expect(state.publications).toEqual([FIRST]);
    expect(state.status).toBe('error');
  });

  it('ignores a failure for a request that has been superseded', () => {
    const state = run(
      ...search('climate'),
      ...search('policy'),
      { type: 'requestFailed', requestId: 1, code: CatalogueError.TIMEOUT },
    );

    expect(state.status).toBe('loading');
  });
});

describe('retrying works out which request failed', () => {
  it('re-runs the search when there was nothing on screen', () => {
    const state = run(
      ...search('climate'),
      { type: 'requestFailed', requestId: 1, code: CatalogueError.TIMEOUT },
      { type: 'retried' },
    );

    expect(state.status).toBe('loading');
    expect(state.requestId).toBe(2);
  });

  it('re-runs the next page when results were already read', () => {
    const state = run(
      ...search('climate'),
      { type: 'pageArrived', requestId: 1, feed: feed({ publications: [FIRST], next: 'p2' }) },
      { type: 'nextRequested' },
      { type: 'requestFailed', requestId: 2, code: CatalogueError.TIMEOUT },
      { type: 'retried' },
    );

    expect(state.status).toBe('paging');
    expect(state.publications).toEqual([FIRST]);
  });

  it('does nothing when nothing failed', () => {
    const state = run(...search('climate'), {
      type: 'pageArrived',
      requestId: 1,
      feed: feed({ publications: [FIRST] }),
    });

    expect(searchReducer(state, { type: 'retried' })).toBe(state);
  });
});
