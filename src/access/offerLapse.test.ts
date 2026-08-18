// src/access/offerLapse.test.ts
// Every case is driven by an explicit `now`, which is the point of the module:
// nothing here freezes a clock or mocks a timer, because nothing in it reads one.
import { isOfferLapsed, lapseOffer } from './offerLapse';
import type { Hold } from '@model/types';

const anOffer = (over: Partial<Hold> = {}): Hold => ({
  holdId: 'hold_5d1',
  offerId: 'offer_a90',
  itemId: 'item_42',
  state: 'offered',
  offerExpiresAt: '2026-08-17T10:15:00Z',
  serverTime: '2026-08-17T10:00:00Z',
  ...over,
});

describe('isOfferLapsed', () => {
  it('is false while the window is still open', () => {
    expect(isOfferLapsed(anOffer(), '2026-08-17T10:14:59Z')).toBe(false);
  });

  it('is true once the window has closed', () => {
    expect(isOfferLapsed(anOffer(), '2026-08-17T10:15:01Z')).toBe(true);
  });

  // The boundary belongs to the server: at the stated instant the offer is over,
  // because flambeau's sweep treats the expiry as the end and not the last moment.
  it('is true exactly at the expiry instant', () => {
    expect(isOfferLapsed(anOffer(), '2026-08-17T10:15:00Z')).toBe(true);
  });

  // The reason `Date.parse` is used rather than a string comparison. Both sides
  // name the same instant; only one of them is written in UTC.
  it('compares instants and not strings, so a non-UTC offset still lapses', () => {
    const stillOpen = isOfferLapsed(anOffer(), '2026-08-17T15:44:00+05:30');
    const lapsed = isOfferLapsed(anOffer(), '2026-08-17T15:46:00+05:30');
    expect(stillOpen).toBe(false);
    expect(lapsed).toBe(true);
  });

  describe('states that have nothing to lapse', () => {
    it.each(['none', 'queued', 'expired'] as const)('is false for %s', (state) => {
      expect(isOfferLapsed(anOffer({ state }), '2027-01-01T00:00:00Z')).toBe(false);
    });

    it('is false for an absent hold, which is the commonest case of all', () => {
      expect(isOfferLapsed(undefined, '2027-01-01T00:00:00Z')).toBe(false);
    });
  });

  describe('the conservative direction', () => {
    // Withdrawing Accept on a guess costs the reader a copy that was theirs. A
    // 409 costs them a sentence. So an undatable offer stays live.
    it('is false when the offer carries no expiry', () => {
      const noExpiry = anOffer();
      delete noExpiry.offerExpiresAt;
      expect(isOfferLapsed(noExpiry, '2027-01-01T00:00:00Z')).toBe(false);
    });

    it('is false when the expiry cannot be parsed', () => {
      expect(isOfferLapsed(anOffer({ offerExpiresAt: 'soon' }), '2027-01-01T00:00:00Z')).toBe(false);
    });

    it('is false when `now` cannot be parsed', () => {
      expect(isOfferLapsed(anOffer(), 'now')).toBe(false);
    });
  });
});

describe('lapseOffer', () => {
  it('marks the hold expired', () => {
    expect(lapseOffer(anOffer()).state).toBe('expired');
  });

  // Each of these is a fact about an offer that no longer exists. A lapsed hold
  // that still carries an expiry is the shape that lets a countdown keep running
  // against a dead offer.
  it('drops the offer id, the expiry and the position', () => {
    const lapsed = lapseOffer(anOffer({ position: 1 }));
    expect('offerId' in lapsed).toBe(false);
    expect('offerExpiresAt' in lapsed).toBe(false);
    expect('position' in lapsed).toBe(false);
  });

  it('keeps the hold id, which is the identity across the whole life of the hold', () => {
    expect(lapseOffer(anOffer()).holdId).toBe('hold_5d1');
  });

  it('does not mutate what it is handed', () => {
    const offer = anOffer();
    lapseOffer(offer);
    expect(offer.state).toBe('offered');
    expect(offer.offerId).toBe('offer_a90');
  });
});
