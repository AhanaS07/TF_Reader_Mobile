// src/store/pendingIntentStore.test.ts
//
// The behaviours worth defending are the ones about NOT replaying: an intent that
// fires twice, or fires a day late, is worse than one that is quietly dropped.
// A dropped intent costs the reader one extra tap; a doubled one spends their data
// or writes twice against a licence.
//
// `now` is passed explicitly throughout rather than faking timers. The store takes
// it as an argument for exactly this reason, and a test that controls time by
// argument cannot be broken by a slow CI machine.
import { waitFor } from '@testing-library/react-native';
import {
  INTENT_MAX_AGE_MS,
  usePendingIntentStore,
  type PendingIntentRequest,
} from './pendingIntentStore';

const mockGetItem = jest.fn<Promise<string | null>, [string]>();

jest.mock('@storage/storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const anIntent = (over: Partial<PendingIntentRequest> = {}): PendingIntentRequest => ({
  action: 'read',
  itemId: 'item_42',
  institutionId: 'inst_7f3',
  ...over,
});

// The store is a module singleton, so state leaks between tests unless it is
// reset. Resetting through the public `clear` rather than `setState` keeps the test
// honest about what callers can actually do.
beforeEach(() => {
  usePendingIntentStore.getState().clear();
  usePendingIntentStore.setState({ _hasHydrated: false });
  mockGetItem.mockReset();
});

describe('pendingIntentStore', () => {
  describe('remember', () => {
    it('holds what the reader was trying to do', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);

      expect(usePendingIntentStore.getState().pending).toEqual({
        action: 'read',
        itemId: 'item_42',
        institutionId: 'inst_7f3',
        createdAt: 1000,
      });
    });

    it('stamps the time itself, so no call site can forget to', () => {
      usePendingIntentStore.getState().remember(anIntent());
      expect(typeof usePendingIntentStore.getState().pending?.createdAt).toBe('number');
    });

    // One slot. The latest tap is by definition the one they still want, which is
    // the opposite of the queue-offer store's rule.
    it('replaces an earlier intent rather than queuing it', () => {
      const store = usePendingIntentStore.getState();
      store.remember(anIntent({ action: 'read', itemId: 'item_42' }), 1000);
      store.remember(anIntent({ action: 'download', itemId: 'item_77' }), 2000);

      expect(usePendingIntentStore.getState().pending).toMatchObject({
        action: 'download',
        itemId: 'item_77',
      });
    });

    // Resuming in the wrong institution would replay against different access
    // rules, so the null case has to survive the round trip as null.
    it('keeps a null institution as null, not as absent', () => {
      usePendingIntentStore.getState().remember(anIntent({ institutionId: null }), 1000);
      expect(usePendingIntentStore.getState().pending).toHaveProperty('institutionId', null);
    });
  });

  describe('take', () => {
    it('returns the intent', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);
      expect(usePendingIntentStore.getState().take(2000)).toMatchObject({
        action: 'read',
        itemId: 'item_42',
      });
    });

    // The reason `take` exists instead of a getter. A second replay of `download`
    // fetches the same file twice; of a licence call, writes twice for one tap.
    it('clears as it returns, so the same intent cannot fire twice', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);

      expect(usePendingIntentStore.getState().take(2000)).not.toBeNull();
      expect(usePendingIntentStore.getState().take(2000)).toBeNull();
      expect(usePendingIntentStore.getState().pending).toBeNull();
    });

    it('returns null when there was never anything', () => {
      expect(usePendingIntentStore.getState().take(2000)).toBeNull();
    });
  });

  describe('staleness', () => {
    it('returns an intent that is still inside the window', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);
      const takenAt = 1000 + INTENT_MAX_AGE_MS - 1;
      expect(usePendingIntentStore.getState().take(takenAt)).not.toBeNull();
    });

    // The scenario: they abandoned sign-in, and came back tomorrow for an
    // unrelated reason. Opening a forgotten book — or spending their data on a
    // forgotten download — reads as a broken app, not a helpful one.
    it('drops an intent that has been sitting too long', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);
      const takenAt = 1000 + INTENT_MAX_AGE_MS + 1;
      expect(usePendingIntentStore.getState().take(takenAt)).toBeNull();
    });

    // Otherwise a stale intent is re-examined and re-rejected on every launch,
    // forever.
    it('clears a stale intent rather than leaving it to be re-rejected', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);
      usePendingIntentStore.getState().take(1000 + INTENT_MAX_AGE_MS + 1);
      expect(usePendingIntentStore.getState().pending).toBeNull();
    });
  });

  describe('clear', () => {
    it('forgets without replaying, for a reader who backed out of sign-in', () => {
      usePendingIntentStore.getState().remember(anIntent(), 1000);
      usePendingIntentStore.getState().clear();

      expect(usePendingIntentStore.getState().pending).toBeNull();
      expect(usePendingIntentStore.getState().take(2000)).toBeNull();
    });
  });

  describe('hydration', () => {
    // The FL-5 trap: a cold start must not resolve "nothing pending" against a
    // store that simply had not loaded yet. The flag is what the navigator waits
    // on, so it has to start false rather than assuming an empty store is a
    // hydrated one.
    it('exposes a hydration flag for the navigator to wait on', () => {
      const { _hasHydrated, setHasHydrated } = usePendingIntentStore.getState();
      expect(typeof _hasHydrated).toBe('boolean');

      setHasHydrated(true);
      expect(usePendingIntentStore.getState()._hasHydrated).toBe(true);
    });

    // The same error-path trap as institutionStore (FL-5): if storage rejects,
    // _hasHydrated must still flip true so the navigator doesn't wait forever.
    it('flips _hasHydrated=true even when storage rejects', async () => {
      mockGetItem.mockRejectedValue(new Error('AsyncStorage unavailable'));

      usePendingIntentStore.persist.rehydrate();

      await waitFor(() =>
        expect(usePendingIntentStore.getState()._hasHydrated).toBe(true),
      );
      // No intent is replayed — failing storage is the same as first launch.
      expect(usePendingIntentStore.getState().pending).toBeNull();
    });

    it('restores a pending intent from a valid stored value', async () => {
      const stored = {
        state: {
          pending: {
            action: 'read',
            itemId: 'item_42',
            institutionId: 'inst_7f3',
            createdAt: Date.now() - 1000,
          },
        },
        version: 1,
      };
      mockGetItem.mockResolvedValue(JSON.stringify(stored));

      usePendingIntentStore.persist.rehydrate();

      await waitFor(() =>
        expect(usePendingIntentStore.getState()._hasHydrated).toBe(true),
      );
      expect(usePendingIntentStore.getState().pending).toMatchObject({
        action: 'read',
        itemId: 'item_42',
      });
    });
  });
});
