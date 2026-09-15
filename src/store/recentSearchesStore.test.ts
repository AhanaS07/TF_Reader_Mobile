// src/store/recentSearchesStore.test.ts
import { MAX_RECENT_SEARCHES, useRecentSearchesStore } from './recentSearchesStore';

// The store is a module singleton, so state leaks between tests unless it is
// reset — same reasoning as pendingIntentStore.test.ts.
beforeEach(() => {
  useRecentSearchesStore.getState().clear();
});

describe('recentSearchesStore', () => {
  it('remembers a query, most recent first', () => {
    useRecentSearchesStore.getState().addQuery('climate');
    useRecentSearchesStore.getState().addQuery('open access');

    expect(useRecentSearchesStore.getState().queries).toEqual(['open access', 'climate']);
  });

  it('ignores a blank query', () => {
    useRecentSearchesStore.getState().addQuery('   ');

    expect(useRecentSearchesStore.getState().queries).toEqual([]);
  });

  it('trims before storing', () => {
    useRecentSearchesStore.getState().addQuery('  climate  ');

    expect(useRecentSearchesStore.getState().queries).toEqual(['climate']);
  });

  // Re-searching something already recent should move it to the front, not
  // create a second, differently-cased entry.
  it('deduplicates case-insensitively and moves the repeat to the front', () => {
    useRecentSearchesStore.getState().addQuery('climate');
    useRecentSearchesStore.getState().addQuery('open access');
    useRecentSearchesStore.getState().addQuery('Climate');

    expect(useRecentSearchesStore.getState().queries).toEqual(['Climate', 'open access']);
  });

  it(`caps the list at ${MAX_RECENT_SEARCHES}`, () => {
    for (let i = 0; i < MAX_RECENT_SEARCHES + 2; i += 1) {
      useRecentSearchesStore.getState().addQuery(`query ${i}`);
    }

    const { queries } = useRecentSearchesStore.getState();
    expect(queries).toHaveLength(MAX_RECENT_SEARCHES);
    // The oldest two fell off the end, not the newest.
    expect(queries[0]).toBe(`query ${MAX_RECENT_SEARCHES + 1}`);
  });

  it('removes a single query', () => {
    useRecentSearchesStore.getState().addQuery('climate');
    useRecentSearchesStore.getState().addQuery('open access');

    useRecentSearchesStore.getState().removeQuery('climate');

    expect(useRecentSearchesStore.getState().queries).toEqual(['open access']);
  });

  it('clears every remembered query', () => {
    useRecentSearchesStore.getState().addQuery('climate');

    useRecentSearchesStore.getState().clear();

    expect(useRecentSearchesStore.getState().queries).toEqual([]);
  });
});
