// src/store/expiredLoansStore.test.ts
import { useExpiredLoansStore } from './expiredLoansStore';

afterEach(() => {
  useExpiredLoansStore.getState().dismissAll();
});

describe('expiredLoansStore', () => {
  it('records a notice', () => {
    useExpiredLoansStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 1_000,
    });

    expect(useExpiredLoansStore.getState().notices).toEqual([
      { itemId: 'item_42', title: 'Applied Thermodynamics', expiredAt: 1_000 },
    ]);
  });

  it('replaces rather than duplicates a notice for the same item', () => {
    useExpiredLoansStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 1_000,
    });
    useExpiredLoansStore.getState().recordExpired({
      itemId: 'item_42',
      title: 'Applied Thermodynamics',
      expiredAt: 2_000,
    });

    const { notices } = useExpiredLoansStore.getState();
    expect(notices).toHaveLength(1);
    expect(notices[0].expiredAt).toBe(2_000);
  });

  it('dismisses one notice by id, leaving the rest', () => {
    useExpiredLoansStore.getState().recordExpired({ itemId: 'item_a', title: 'A', expiredAt: 1 });
    useExpiredLoansStore.getState().recordExpired({ itemId: 'item_b', title: 'B', expiredAt: 2 });

    useExpiredLoansStore.getState().dismiss('item_a');

    expect(useExpiredLoansStore.getState().notices.map((n) => n.itemId)).toEqual(['item_b']);
  });

  it('dismisses every notice at once', () => {
    useExpiredLoansStore.getState().recordExpired({ itemId: 'item_a', title: 'A', expiredAt: 1 });
    useExpiredLoansStore.getState().recordExpired({ itemId: 'item_b', title: 'B', expiredAt: 2 });

    useExpiredLoansStore.getState().dismissAll();

    expect(useExpiredLoansStore.getState().notices).toEqual([]);
  });
});
