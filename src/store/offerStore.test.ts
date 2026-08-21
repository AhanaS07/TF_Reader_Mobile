// src/store/offerStore.test.ts
//
// The behaviours worth defending: a second offer cannot silently displace an
// unanswered first one, the countdown is computed against the server's clock
// and not the device's, and accepting/rejecting/lapsing all free the slot
// rather than leaving a dead offer stuck in it.
//
// `now` is passed explicitly throughout rather than faking timers — same
// convention as pendingIntentStore.test.ts, and for the same reason: a test
// that controls time by argument cannot be broken by a slow CI machine.
import type { Hold } from '@model/types';
import { useOfferStore } from './offerStore';

const BASE = 1_000_000; // an arbitrary device/server instant, in ms

const anOffer = (over: Partial<Hold> = {}): Hold => ({
  holdId: 'hold_5d1',
  offerId: 'offer_a90',
  itemId: 'item_42',
  state: 'offered',
  offerExpiresAt: new Date(BASE + 10 * 60_000).toISOString(),
  serverTime: new Date(BASE).toISOString(),
  ...over,
});

// The store is a module singleton, so state leaks between tests unless reset.
// Reset through the public `clear` rather than `setState`, same reasoning as
// pendingIntentStore.test.ts.
beforeEach(() => {
  useOfferStore.getState().clear();
});

describe('offerStore', () => {
  describe('receiveOffer', () => {
    it('accepts an offer into an empty slot', () => {
      const accepted = useOfferStore.getState().receiveOffer(anOffer(), BASE);

      expect(accepted).toBe(true);
      expect(useOfferStore.getState().offer).toMatchObject({ offerId: 'offer_a90' });
    });

    it('stamps receivedAt itself', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      expect(useOfferStore.getState().receivedAt).toBe(BASE);
    });

    it('refuses a different offer while the current one is still live', () => {
      useOfferStore.getState().receiveOffer(anOffer({ offerId: 'offer_a90' }), BASE);

      const refused = useOfferStore
        .getState()
        .receiveOffer(anOffer({ offerId: 'offer_zzz', itemId: 'item_99' }), BASE + 1000);

      expect(refused).toBe(false);
      // The original offer is untouched — no silent overwrite.
      expect(useOfferStore.getState().offer).toMatchObject({ offerId: 'offer_a90' });
    });

    it('accepts a same-offerId redelivery even though the held offer has not lapsed', () => {
      useOfferStore.getState().receiveOffer(anOffer({ offerId: 'offer_a90' }), BASE);

      const refreshed = anOffer({
        offerId: 'offer_a90',
        offerExpiresAt: new Date(BASE + 20 * 60_000).toISOString(),
      });
      const accepted = useOfferStore.getState().receiveOffer(refreshed, BASE + 1000);

      expect(accepted).toBe(true);
      expect(useOfferStore.getState().offer?.offerExpiresAt).toBe(refreshed.offerExpiresAt);
    });

    it('accepts a replacement once the held offer has lapsed by the clock', () => {
      useOfferStore.getState().receiveOffer(anOffer({ offerId: 'offer_a90' }), BASE);

      const lapsedAt = BASE + 11 * 60_000; // past the 10-minute expiry
      const accepted = useOfferStore
        .getState()
        .receiveOffer(anOffer({ offerId: 'offer_zzz', itemId: 'item_99' }), lapsedAt);

      expect(accepted).toBe(true);
      expect(useOfferStore.getState().offer).toMatchObject({ offerId: 'offer_zzz' });
    });

    // Regression: a slot holding a hold this store has already marked
    // 'expired' (left behind by acceptOffer/rejectOffer noticing a lapse) must
    // not be mistaken for "occupied" just because `isOfferLapsed` itself
    // answers false for a state that is not 'offered'.
    it('accepts a replacement when the slot holds an already-expired hold', () => {
      useOfferStore.setState({
        offer: { holdId: 'hold_5d1', itemId: 'item_42', state: 'expired' },
        receivedAt: null,
      });

      const accepted = useOfferStore.getState().receiveOffer(anOffer({ offerId: 'offer_zzz' }), BASE);

      expect(accepted).toBe(true);
      expect(useOfferStore.getState().offer).toMatchObject({ offerId: 'offer_zzz' });
    });

    it('falls back to comparing against device time when the offer carries no serverTime', () => {
      const noServerTime = anOffer({ offerExpiresAt: new Date(5000).toISOString() });
      delete noServerTime.serverTime;
      useOfferStore.getState().receiveOffer(noServerTime, 1000);

      const stillLive = useOfferStore
        .getState()
        .receiveOffer(anOffer({ offerId: 'offer_zzz' }), 4000);
      expect(stillLive).toBe(false); // original still live at device time 4000

      const nowLapsed = useOfferStore
        .getState()
        .receiveOffer(anOffer({ offerId: 'offer_zzz' }), 6000);
      expect(nowLapsed).toBe(true); // original lapsed by device time 6000
    });
  });

  describe('minutesRemaining', () => {
    it('is undefined when there is no offer', () => {
      expect(useOfferStore.getState().minutesRemaining(BASE)).toBeUndefined();
    });

    it('counts down against server time, not raw device-elapsed time', () => {
      // Server clock reads 500_000 at receipt while the device is at BASE — a
      // deliberate skew. The offer expires 10 server-minutes after that.
      const skewed = anOffer({
        serverTime: new Date(500_000).toISOString(),
        offerExpiresAt: new Date(500_000 + 10 * 60_000).toISOString(),
      });
      useOfferStore.getState().receiveOffer(skewed, BASE);

      // One device-minute later: effective server time is 500_000 + 60_000 =
      // 560_000, ten server-minutes out is 1_100_000, so 9 minutes remain —
      // not the ~17 minutes a naive device-clock comparison would report.
      expect(useOfferStore.getState().minutesRemaining(BASE + 60_000)).toBe(9);
    });

    it('floors partial minutes rather than rounding up', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      // 90 seconds before expiry.
      expect(useOfferStore.getState().minutesRemaining(BASE + 10 * 60_000 - 90_000)).toBe(1);
    });

    it('reaches 0 for the last live minute', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      expect(useOfferStore.getState().minutesRemaining(BASE + 10 * 60_000 - 1000)).toBe(0);
    });

    it('is undefined exactly at the expiry instant and past it', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      expect(useOfferStore.getState().minutesRemaining(BASE + 10 * 60_000)).toBeUndefined();
      expect(useOfferStore.getState().minutesRemaining(BASE + 10 * 60_000 + 1)).toBeUndefined();
    });

    it('is undefined once the slot holds an already-expired hold, without throwing', () => {
      useOfferStore.setState({
        offer: { holdId: 'hold_5d1', itemId: 'item_42', state: 'expired' },
        receivedAt: null,
      });

      expect(() => useOfferStore.getState().minutesRemaining(BASE)).not.toThrow();
      expect(useOfferStore.getState().minutesRemaining(BASE)).toBeUndefined();
    });

    it('does not mutate the stored offer as a side effect of being read', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      useOfferStore.getState().minutesRemaining(BASE + 60_000);
      expect(useOfferStore.getState().offer).toMatchObject({ state: 'offered' });
    });
  });

  describe('acceptOffer', () => {
    it('is null when nothing is offered', () => {
      expect(useOfferStore.getState().acceptOffer(BASE)).toBeNull();
    });

    it('returns the offer and clears the slot', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);

      const accepted = useOfferStore.getState().acceptOffer(BASE + 1000);

      expect(accepted).toMatchObject({ offerId: 'offer_a90' });
      expect(useOfferStore.getState().offer).toBeNull();
      expect(useOfferStore.getState().receivedAt).toBeNull();
    });

    it('is consume-once: a second call after accepting returns null', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      useOfferStore.getState().acceptOffer(BASE + 1000);

      expect(useOfferStore.getState().acceptOffer(BASE + 2000)).toBeNull();
    });

    it('returns null and marks the slot expired when the offer already lapsed', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);

      const result = useOfferStore.getState().acceptOffer(BASE + 11 * 60_000);

      expect(result).toBeNull();
      // Not null — lapseOffer's hold stays put as a record, but receivedAt
      // clears and `state: 'expired'` is what lets a new offer take the slot.
      expect(useOfferStore.getState().offer).toMatchObject({ state: 'expired' });
      expect(useOfferStore.getState().receivedAt).toBeNull();
    });

    it('freeing a lapsed slot lets a brand new offer be accepted next', () => {
      useOfferStore.getState().receiveOffer(anOffer({ offerId: 'offer_a90' }), BASE);
      useOfferStore.getState().acceptOffer(BASE + 11 * 60_000);

      const accepted = useOfferStore
        .getState()
        .receiveOffer(anOffer({ offerId: 'offer_zzz' }), BASE + 12 * 60_000);

      expect(accepted).toBe(true);
    });
  });

  describe('rejectOffer', () => {
    it('returns the offer and clears the slot', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);

      const rejected = useOfferStore.getState().rejectOffer(BASE + 1000);

      expect(rejected).toMatchObject({ offerId: 'offer_a90' });
      expect(useOfferStore.getState().offer).toBeNull();
    });

    it('is null when nothing is offered', () => {
      expect(useOfferStore.getState().rejectOffer(BASE)).toBeNull();
    });

    it('returns null and marks the slot expired when the offer already lapsed', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);

      const result = useOfferStore.getState().rejectOffer(BASE + 11 * 60_000);

      expect(result).toBeNull();
      expect(useOfferStore.getState().offer).toMatchObject({ state: 'expired' });
    });
  });

  describe('clear', () => {
    it('empties the slot regardless of what was in it', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);
      useOfferStore.getState().clear();

      expect(useOfferStore.getState().offer).toBeNull();
      expect(useOfferStore.getState().receivedAt).toBeNull();
    });
  });

  describe('persistence', () => {
    it('only persists the offer and when it was received', () => {
      useOfferStore.getState().receiveOffer(anOffer(), BASE);

      const options = useOfferStore.persist.getOptions();
      const persisted = options.partialize?.(useOfferStore.getState());

      expect(persisted).toEqual({
        offer: useOfferStore.getState().offer,
        receivedAt: BASE,
      });
    });
  });

  describe('hydration', () => {
    it('exposes a hydration flag for callers to wait on', () => {
      const { _hasHydrated, setHasHydrated } = useOfferStore.getState();
      expect(typeof _hasHydrated).toBe('boolean');

      setHasHydrated(true);
      expect(useOfferStore.getState()._hasHydrated).toBe(true);
    });

    it('flips the hydration flag once storage has loaded', async () => {
      useOfferStore.getState().setHasHydrated(false);
      await useOfferStore.persist.rehydrate();

      expect(useOfferStore.getState()._hasHydrated).toBe(true);
    });

    // Regression for the bug found in this codebase's other persisted stores
    // (institutionStore.ts): `onRehydrateStorage: () => (state) => state?.setHasHydrated(true)`
    // never flips the flag on a rehydration failure, because `state` is
    // `undefined` on that path and the optional chain silently no-ops. This
    // store reaches for its own hook instead, so the flag must flip on
    // failure too.
    it('flips the hydration flag even when rehydration fails', async () => {
      jest.resetModules();
      await jest.isolateModulesAsync(async () => {
        jest.doMock('@storage/storage', () => ({
          __esModule: true,
          default: {
            getItem: jest.fn().mockRejectedValue(new Error('boom')),
            setItem: jest.fn(),
            removeItem: jest.fn(),
          },
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- a
        // fresh module instance inside isolateModulesAsync must be required at
        // call time; a static import would resolve before the mock is set up.
        const fresh = require('./offerStore').useOfferStore as typeof useOfferStore;
        fresh.getState().setHasHydrated(false);

        await fresh.persist.rehydrate();

        expect(fresh.getState()._hasHydrated).toBe(true);
      });
    });
  });
});
