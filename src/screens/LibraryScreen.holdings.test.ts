// src/screens/LibraryScreen.holdings.test.ts
// The Library screen's arithmetic, tested without a renderer.
//
// EVERY CLOCK VALUE IS PASSED IN, which is the point of these helpers living in
// their own file. The device-clock-five-minutes-fast case below is the one
// behaviour Module E's definition of done names explicitly, and it is only
// assertable because no function here reads `Date.now()`.
import { MAX_BATCH_IDS } from '@model/batchItems';
import type { Hold, Loan } from '@model/types';

import {
  activeLoans,
  collectItemIds,
  dueLabel,
  offerMinutesRemaining,
  ordinal,
  partitionHolds,
  queueLabel,
} from './LibraryScreen.holdings';

const SERVER_NOW = '2026-08-26T10:00:00Z';
const SERVER_NOW_MS = Date.parse(SERVER_NOW);

function aLoan(over: Partial<Loan> = {}): Loan {
  return { loanId: 'loan_1', itemId: 'item_42', state: 'active', ...over };
}

function aHold(over: Partial<Hold> = {}): Hold {
  return { holdId: 'hold_1', itemId: 'item_77', state: 'queued', serverTime: SERVER_NOW, ...over };
}

describe('partitionHolds', () => {
  it('puts an offered hold in offered and a queued one in waiting', () => {
    const offer = aHold({ holdId: 'h_off', state: 'offered', offerExpiresAt: SERVER_NOW });
    const queued = aHold({ holdId: 'h_q', state: 'queued' });

    const { offered, waiting } = partitionHolds([queued, offer]);

    expect(offered.map((h) => h.holdId)).toEqual(['h_off']);
    expect(waiting.map((h) => h.holdId)).toEqual(['h_q']);
  });

  it('keeps an offered hold whose expiry is missing — hiding it would lose the reader a copy', () => {
    const malformed = aHold({ state: 'offered' });

    const { offered, waiting } = partitionHolds([malformed]);

    expect(offered).toHaveLength(1);
    expect(waiting).toHaveLength(0);
  });

  it('shows neither expired nor none as waiting — the reader is in no queue in either case', () => {
    const { offered, waiting } = partitionHolds([
      aHold({ state: 'expired' }),
      aHold({ state: 'none' }),
    ]);

    expect(offered).toHaveLength(0);
    expect(waiting).toHaveLength(0);
  });
});

describe('activeLoans', () => {
  it('keeps active and drops returned and expired — neither is on the shelf', () => {
    const kept = activeLoans([
      aLoan({ loanId: 'a', state: 'active' }),
      aLoan({ loanId: 'b', state: 'returned' }),
      aLoan({ loanId: 'c', state: 'expired' }),
      aLoan({ loanId: 'd', state: 'none' }),
    ]);

    expect(kept.map((l) => l.loanId)).toEqual(['a']);
  });
});

describe('collectItemIds', () => {
  it('returns each id once across all three sections', () => {
    const { ids } = collectItemIds(
      [aLoan({ itemId: 'shared' })],
      [aHold({ itemId: 'offered_1', state: 'offered' })],
      [aHold({ itemId: 'shared' })],
    );

    expect(ids.sort()).toEqual(['offered_1', 'shared']);
  });

  it('orders offers before loans before waiting, so truncation falls on the queue', () => {
    const { ids } = collectItemIds(
      [aLoan({ itemId: 'loan' })],
      [aHold({ itemId: 'offer', state: 'offered' })],
      [aHold({ itemId: 'wait' })],
    );

    expect(ids).toEqual(['offer', 'loan', 'wait']);
  });

  it('caps at the batch limit and reports how many rows went unhydrated', () => {
    const many = Array.from({ length: MAX_BATCH_IDS + 7 }, (_, i) =>
      aLoan({ loanId: `loan_${i}`, itemId: `item_${i}` }),
    );

    const { ids, truncated } = collectItemIds(many, [], []);

    expect(ids).toHaveLength(MAX_BATCH_IDS);
    expect(truncated).toBe(7);
  });

  it('reports no truncation when the shelf fits', () => {
    expect(collectItemIds([aLoan()], [], []).truncated).toBe(0);
  });
});

describe('offerMinutesRemaining', () => {
  // The device is five minutes FAST: its clock reads later than the server's, so
  // the offset is negative. A countdown that ignored the offset would report
  // five minutes less than the reader actually has, and they would abandon a
  // copy that is still theirs.
  const DEVICE_FAST_BY_MS = 5 * 60_000;
  const deviceNowMs = SERVER_NOW_MS + DEVICE_FAST_BY_MS;
  const offsetMs = -DEVICE_FAST_BY_MS;

  it('survives a device clock five minutes fast', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS + 15 * 60_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(15);
    // Without the offset the same hold reads five minutes short.
    expect(offerMinutesRemaining(hold, 0, deviceNowMs)).toBe(10);
  });

  it('floors, so the last live minute reads as 0 rather than disappearing', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS + 30_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(0);
  });

  it('clamps a lapsed offer to 0 rather than going negative', () => {
    const hold = aHold({
      state: 'offered',
      offerExpiresAt: new Date(SERVER_NOW_MS - 60 * 60_000).toISOString(),
    });

    expect(offerMinutesRemaining(hold, offsetMs, deviceNowMs)).toBe(0);
  });

  it('answers undefined when there is nothing to count', () => {
    expect(offerMinutesRemaining(aHold({ state: 'offered' }), 0, SERVER_NOW_MS)).toBeUndefined();
    expect(
      offerMinutesRemaining(aHold({ state: 'offered', offerExpiresAt: 'soon' }), 0, SERVER_NOW_MS),
    ).toBeUndefined();
  });
});

describe('dueLabel', () => {
  it('says so plainly when a loan has no due date — open access never expires', () => {
    expect(dueLabel(aLoan(), 0, SERVER_NOW_MS)).toBe('No due date');
  });

  it('ceils, so a loan with hours left is due in 1 day rather than 0', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 4 * 60 * 60_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due in 1 day');
  });

  it('pluralises', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 14 * 86_400_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due in 14 days');
  });

  it('measures against the server clock, not the device one', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS + 2 * 86_400_000 });
    const deviceSlowBy = 3 * 86_400_000;

    // A device three days behind would otherwise read five days remaining.
    expect(dueLabel(loan, deviceSlowBy, SERVER_NOW_MS - deviceSlowBy)).toBe('Due in 2 days');
  });

  it('reports a lapsed loan as due now rather than as a negative count', () => {
    const loan = aLoan({ expiresAt: SERVER_NOW_MS - 60_000 });

    expect(dueLabel(loan, 0, SERVER_NOW_MS)).toBe('Due now');
  });
});

describe('ordinal', () => {
  it('handles the teens, which are the ones a naive suffix gets wrong', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('handles 1, 2, 3 and the twenties', () => {
    expect([1, 2, 3, 4, 21, 22, 23].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '21st',
      '22nd',
      '23rd',
    ]);
  });
});

describe('queueLabel', () => {
  it('reads "3rd of 7" when both the place and the length are known', () => {
    expect(queueLabel(aHold({ position: 3, queueLength: 7 }))).toBe('3rd of 7');
  });

  it('drops the length rather than inventing one', () => {
    expect(queueLabel(aHold({ position: 3 }))).toBe('3rd in the queue');
  });

  it('says nothing without a position — a bare queue length is not a fact about this reader', () => {
    expect(queueLabel(aHold({ queueLength: 7 }))).toBeUndefined();
  });
});
