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

  it('carries only the real fields a row needs, inventing nothing', () => {
    useRecentlyViewedStore.getState().recordView(
      aPublication({ id: 'item_1', title: 'Climate Change', authors: ['R. Wilson'], published: '2024-01-01' }),
    );

    expect(useRecentlyViewedStore.getState().items[0]).toEqual({
      itemId: 'item_1',
      title: 'Climate Change',
      authors: ['R. Wilson'],
      published: '2024-01-01',
    });
  });

  it('omits a field the publication did not carry, rather than storing undefined', () => {
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1' }));

    expect(useRecentlyViewedStore.getState().items[0]).not.toHaveProperty('coverUrl');
    expect(useRecentlyViewedStore.getState().items[0]).not.toHaveProperty('workType');
  });

  it('re-viewing something already there moves it to the front rather than duplicating it', () => {
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1', title: 'First' }));
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_2', title: 'Second' }));
    useRecentlyViewedStore.getState().recordView(aPublication({ id: 'item_1', title: 'First' }));

    const { items } = useRecentlyViewedStore.getState();
    expect(items.map((i) => i.itemId)).toEqual(['item_1', 'item_2']);
  });

  it(`caps the list at ${MAX_RECENTLY_VIEWED}`, () => {
    for (let i = 0; i < MAX_RECENTLY_VIEWED + 2; i += 1) {
      useRecentlyViewedStore.getState().recordView(aPublication({ id: `item_${i}` }));
    }

    const { items } = useRecentlyViewedStore.getState();
    expect(items).toHaveLength(MAX_RECENTLY_VIEWED);
    // The oldest two fell off the end, not the newest.
    expect(items[0].itemId).toBe(`item_${MAX_RECENTLY_VIEWED + 1}`);
  });

  it('clears every remembered view', () => {
    useRecentlyViewedStore.getState().recordView(aPublication());

    useRecentlyViewedStore.getState().clear();

    expect(useRecentlyViewedStore.getState().items).toEqual([]);
  });
});
