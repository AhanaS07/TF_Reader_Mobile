// src/store/recentlyViewedStore.test.ts
import type { Publication } from '@model/types';

import { MAX_RECENTLY_VIEWED, useRecentlyViewedStore } from './recentlyViewedStore';

function aPublication(over: Partial<Publication> = {}): Publication {
  return {
    id: 'item_1',
    title: 'Climate Change and Global Sustainability',
    authors: ['R. Wilson', 'T. Gupta'],
    subjects: [],
    acquisition: {
      actionId: 'openAccess',
      href: 'https://example.com',
      licenceModel: 'OPEN_ACCESS',
      encryption: null,
    },
    ...over,
  };
}

// The store is a module singleton, so state leaks between tests unless it is
// reset — same reasoning as recentSearchesStore.test.ts.
beforeEach(() => {
  useRecentlyViewedStore.getState().clear();
});

describe('recentlyViewedStore', () => {
  it('remembers a view, most recent first', () => {
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1', title: 'First' }));
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_2', title: 'Second' }));

    expect(useRecentlyViewedStore.getState().items.map((i) => i.title)).toEqual(['Second', 'First']);
  });

  it('stores the real publication verbatim, inventing nothing', () => {
    const publication = aPublication({ id: 'item_1', publisher: 'Routledge', numberOfPages: 212 });

    useRecentlyViewedStore.getState().recordView(publication);

    expect(useRecentlyViewedStore.getState().items[0]).toEqual(publication);
  });

  it('re-viewing something already there moves it to the front rather than duplicating it', () => {
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1', title: 'First' }));
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_2', title: 'Second' }));
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1', title: 'First' }));

    const { items } = useRecentlyViewedStore.getState();
    expect(items.map((i) => i.id)).toEqual(['item_1', 'item_2']);
  });

  it(`caps the list at ${MAX_RECENTLY_VIEWED}`, () => {
    for (let i = 0; i < MAX_RECENTLY_VIEWED + 2; i += 1) {
      useRecentlyViewedStore.getState().recordView(aPublication({ id: `item_${i}` }));
    }

    const { items } = useRecentlyViewedStore.getState();
    expect(items).toHaveLength(MAX_RECENTLY_VIEWED);
    // The oldest two fell off the end, not the newest.
    expect(items[0].id).toBe(`item_${MAX_RECENTLY_VIEWED + 1}`);
  });

  it('clears every remembered view', () => {
    useRecentlyViewedStore.getState().recordView(aPublication());

    useRecentlyViewedStore.getState().clear();

    expect(useRecentlyViewedStore.getState().items).toEqual([]);
  });
});
