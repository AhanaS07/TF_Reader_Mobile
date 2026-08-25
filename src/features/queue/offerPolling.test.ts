// src/features/queue/offerPolling.test.ts
// `pollOfferChanges` is the part of the poll worth testing directly — see its own
// comment in offerPolling.ts. The interval wrapper around it is not covered here.
import type { Changes, Hold } from '@model/types';
import type { LicenceSource, Library } from '@/licence';
import { useOfferStore } from '@store/offerStore';
import { pollOfferChanges } from './offerPolling';

// Every method `LicenceSource` declares, most refusing — this test only ever drives
// `getChanges` and `getLibrary`, and a stub that silently answered the other five
// would hide a poll that started calling something it should not.
function fakeSource(over: { changes?: Changes; library?: Library }): LicenceSource {
  const unused = async (): Promise<never> => {
    throw new Error('not used by the poll');
  };
  return {
    borrow: unused,
    returnLoan: unused,
    placeHold: unused,
    acceptOffer: unused,
    cancelHold: unused,
    openReadingSession: unused,
    getLibrary: async () => over.library ?? { loans: [], holds: [] },
    getChanges: async () => over.changes ?? { changes: [], nextCursor: '0', hasMore: false, serverTime: '' },
  };
}

const anOfferedHold = (over: Partial<Hold> = {}): Hold => ({
  holdId: 'hold_5d1',
  offerId: 'offer_a90',
  itemId: 'item_42',
  state: 'offered',
  offerExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  serverTime: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  useOfferStore.getState().clear();
});

describe('pollOfferChanges', () => {
  it('does not read the library when nothing was promoted', async () => {
    let readLibrary = false;
    const source = fakeSource({
      changes: { changes: [], nextCursor: '5', hasMore: false, serverTime: '' },
    });
    source.getLibrary = async () => {
      readLibrary = true;
      return { loans: [], holds: [] };
    };

    await pollOfferChanges(source, undefined);
    expect(readLibrary).toBe(false);
  });

  it('feeds an offered hold to offerStore when a HOLD_PROMOTED entry arrives', async () => {
    const offered = anOfferedHold();
    const source = fakeSource({
      changes: {
        changes: [
          {
            sequence: 12,
            reason: 'HOLD_PROMOTED',
            itemId: offered.itemId,
            holdId: offered.holdId,
            occurredAt: '2026-08-13T09:30:00Z',
          },
        ],
        nextCursor: '12',
        hasMore: false,
        serverTime: '',
      },
      library: { loans: [], holds: [offered] },
    });

    await pollOfferChanges(source, undefined);

    expect(useOfferStore.getState().offer).toMatchObject({ offerId: 'offer_a90' });
  });

  it('ignores a change reason other than HOLD_PROMOTED', async () => {
    let readLibrary = false;
    const source = fakeSource({
      changes: {
        changes: [
          { sequence: 3, reason: 'ENTITLEMENT_REVOKED', itemId: 'item_77', occurredAt: '2026-08-13T09:45:00Z' },
        ],
        nextCursor: '3',
        hasMore: false,
        serverTime: '',
      },
    });
    source.getLibrary = async () => {
      readLibrary = true;
      return { loans: [], holds: [] };
    };

    await pollOfferChanges(source, undefined);
    expect(readLibrary).toBe(false);
  });

  it('leaves a queued hold alone — only an offered one reaches the store', async () => {
    const queued: Hold = { holdId: 'hold_9', itemId: 'item_9', state: 'queued', position: 2 };
    const source = fakeSource({
      changes: {
        changes: [
          { sequence: 1, reason: 'HOLD_PROMOTED', itemId: 'item_9', holdId: 'hold_9', occurredAt: '2026-08-13T09:30:00Z' },
        ],
        nextCursor: '1',
        hasMore: false,
        serverTime: '',
      },
      library: { loans: [], holds: [queued] },
    });

    await pollOfferChanges(source, undefined);
    expect(useOfferStore.getState().offer).toBeNull();
  });

  it('returns nextCursor for the caller to pass back as since on the next tick', async () => {
    const source = fakeSource({
      changes: { changes: [], nextCursor: '42', hasMore: false, serverTime: '' },
    });
    await expect(pollOfferChanges(source, '7')).resolves.toBe('42');
  });
});
