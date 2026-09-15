// src/store/expiredDownloadsStore.test.ts
import { useExpiredDownloadsStore } from './expiredDownloadsStore';

afterEach(() => {
  useExpiredDownloadsStore.getState().dismissAll();
});

describe('expiredDownloadsStore', () => {
  it('records a notice', () => {
    useExpiredDownloadsStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 1_000,
    });

    expect(useExpiredDownloadsStore.getState().notices).toEqual([
      { itemId: 'item_42', title: 'Applied Thermodynamics', expiredAt: 1_000 },
    ]);
  });

  it('replaces rather than duplicates a notice for the same item', () => {
    useExpiredDownloadsStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 1_000,
    });
    useExpiredDownloadsStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 2_000,
    });

    const { notices } = useExpiredDownloadsStore.getState();
    expect(notices).toHaveLength(1);
    expect(notices[0].expiredAt).toBe(2_000);
  });

  it('dismisses one notice by id, leaving the rest', () => {
    useExpiredDownloadsStore.getState().recordExpired({ itemId: 'item_a', title: 'A', expiredAt: 1 });
    useExpiredDownloadsStore.getState().recordExpired({ itemId: 'item_b', title: 'B', expiredAt: 2 });

    useExpiredDownloadsStore.getState().dismiss('item_a');

    expect(useExpiredDownloadsStore.getState().notices.map((n) => n.itemId)).toEqual(['item_b']);
  });

  it('dismisses every notice at once', () => {
    useExpiredDownloadsStore.getState().recordExpired({ itemId: 'item_a', title: 'A', expiredAt: 1 });
    useExpiredDownloadsStore.getState().recordExpired({ itemId: 'item_b', title: 'B', expiredAt: 2 });

    useExpiredDownloadsStore.getState().dismissAll();

    expect(useExpiredDownloadsStore.getState().notices).toEqual([]);
  });
});
