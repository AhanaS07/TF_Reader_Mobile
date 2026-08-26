// src/licence/queueRequest.test.ts
// D12 — the Elite queue flow, which is ITEM DETAIL ONLY (confirmed team
// decision, 26 Aug). The card-row descriptor and the `useQueueRequest` hook were
// removed with that decision, along with their tests; what remains is the two
// functions the detail screen calls.
//
// `borrowOrPlaceHold` IS TESTED DIRECTLY, with a hand-built source, because the
// rule it encodes is the dangerous one: falling through to a hold on the WRONG
// failure would enqueue a reader off the back of a network error. The narrow
// catch gets a test per failure shape rather than one happy path.

import { LicenceError, LicenceFailure, type LicenceSource } from '@/licence/LicenceSource';

import { borrowOrPlaceHold, queuePositionLabel } from './queueRequest';

const LOAN = { loanId: 'loan_1', itemId: 'item_42', state: 'active' as const, expiresAt: 9_999 };
const HELD = {
  holdId: 'hold_1',
  itemId: 'item_42',
  state: 'queued' as const,
  position: 3,
  queueLength: 5,
  serverTime: '',
};

/** A source built by hand, for the pure function's own tests. */
function source(over: Partial<LicenceSource> = {}): LicenceSource {
  return {
    borrow: jest.fn().mockResolvedValue(LOAN),
    placeHold: jest.fn().mockResolvedValue(HELD),
    returnLoan: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
    getLibrary: jest.fn(),
    ...over,
  } as unknown as LicenceSource;
}

const noCopies = () =>
  new LicenceFailure(LicenceError.REFUSED, { errorCode: 'NO_COPIES_AVAILABLE' });

describe('borrowOrPlaceHold', () => {
  it('borrows, and does not touch the queue, when a copy is free', async () => {
    const s = source();

    await borrowOrPlaceHold(s, 'item_42');

    expect(s.borrow).toHaveBeenCalledWith('item_42');
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('falls through to the queue when the refusal is NO_COPIES_AVAILABLE', async () => {
    const s = source({ borrow: jest.fn().mockRejectedValue(noCopies()) });

    await borrowOrPlaceHold(s, 'item_42');

    expect(s.placeHold).toHaveBeenCalledWith('item_42');
  });

  // THE IMPORTANT HALF. Each of these is a failure that says nothing about
  // availability, so none of them may put the reader in a queue.
  it('does NOT queue on a refusal with a different error code', async () => {
    const err = new LicenceFailure(LicenceError.REFUSED, { errorCode: 'LICENCE_EXPIRED' });
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('does NOT queue on a non-REFUSED licence failure', async () => {
    // The case that matters most: offline is not "no copies available", and
    // queueing off the back of it would enqueue a reader who asked for nothing.
    const err = new LicenceFailure(LicenceError.NETWORK_UNAVAILABLE);
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('does NOT queue on a plain Error that is not a licence failure at all', async () => {
    const err = new Error('boom');
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });
});

// ── queuePositionLabel — the copy for the queued state on item detail ─────────
//
// A status line, never a button (16 Aug decision record), so this returns a
// string and nothing else.
describe('queuePositionLabel', () => {
  it('gives position and total when both are known', () => {
    expect(queuePositionLabel({ queuePosition: 3, queueLength: 7 })).toBe(
      'Position 3 of 7 in queue',
    );
  });

  // `queueLength` is optional in the contract precisely because it is a nicety;
  // the position is the thing the reader came for, so the copy degrades rather
  // than waiting for a total that may never arrive.
  it('drops the total rather than the position when the total is missing', () => {
    expect(queuePositionLabel({ queuePosition: 1 })).toBe('Position 1 in queue');
  });

  // No position means there is nothing to say — the screen renders no line at
  // all rather than "Position undefined".
  it('says nothing when there is no position', () => {
    expect(queuePositionLabel({})).toBeUndefined();
    expect(queuePositionLabel({ queueLength: 7 })).toBeUndefined();
  });
});
