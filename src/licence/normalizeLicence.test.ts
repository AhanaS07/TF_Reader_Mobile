// src/licence/normalizeLicence.test.ts
// Bodies here are copied from flambeau's own worked examples in
// docs/contracts/flambeau-api.yaml, not invented. A normalizer tested against fixtures
// we wrote ourselves only proves we agree with ourselves.
import { LicenceError, isLicenceFailure } from './LicenceSource';
import { normalizeHold, normalizeLibrary, normalizeLoan } from './normalizeLicence';

// From `POST /api/v1/loans`, the 200 example.
const LOAN = {
  loanId: 'loan_3b8',
  itemId: 'item_42',
  userId: 'user_9c2',
  institutionId: 'inst_7f3',
  licenceModel: 'ELITE',
  status: 'ACTIVE',
  borrowedAt: '2026-08-01T09:00:00Z',
  dueAt: '2026-08-15T09:00:00Z',
  canPersist: false,
  serverTime: '2026-08-13T10:00:00Z',
};

// From `GET /api/v1/library`, the OFFERED hold.
const OFFERED = {
  holdId: 'hold_5d1',
  itemId: 'item_77',
  status: 'OFFERED',
  position: 1,
  queueLength: 7,
  placedAt: '2026-08-10T14:00:00Z',
  offer: { offerId: 'offer_a90', expiresAt: '2026-08-13T10:30:00Z' },
};

// From the same example, the QUEUED hold.
const QUEUED = {
  holdId: 'hold_9a4',
  itemId: 'item_42',
  status: 'QUEUED',
  position: 4,
  queueLength: 11,
  estimatedWaitDays: 12,
  placedAt: '2026-08-12T08:00:00Z',
};

const codeOf = (run: () => unknown): LicenceError | undefined => {
  try {
    run();
  } catch (error) {
    return isLicenceFailure(error) ? error.code : undefined;
  }
  return undefined;
};

describe('normalizeLoan', () => {
  it('reads the id, the item and the state', () => {
    const loan = normalizeLoan(LOAN);
    expect(loan.loanId).toBe('loan_3b8');
    expect(loan.itemId).toBe('item_42');
    expect(loan.state).toBe('active');
  });

  // `dueAt` is an ISO string on the wire and epoch ms in our model — primitives.ts
  // reserves that representation, so the conversion belongs at the boundary.
  it('converts dueAt to epoch milliseconds', () => {
    expect(normalizeLoan(LOAN).expiresAt).toBe(Date.parse('2026-08-15T09:00:00Z'));
  });

  // Open access never expires and the contract omits `dueAt` for it entirely.
  it('omits expiresAt when there is no due date', () => {
    const openAccess = { ...LOAN, licenceModel: 'OPEN_ACCESS', dueAt: undefined };
    expect('expiresAt' in normalizeLoan(openAccess)).toBe(false);
  });

  // The distinction flambeau asked us to keep: the reader closed one, the sweep closed
  // the other, and the app shows them differently.
  it('keeps RETURNED and EXPIRED apart', () => {
    expect(normalizeLoan({ ...LOAN, status: 'RETURNED' }).state).toBe('returned');
    expect(normalizeLoan({ ...LOAN, status: 'EXPIRED' }).state).toBe('expired');
  });

  // Neither guess is safe. Defaulting to active hands out a Read button for a loan that
  // is over; defaulting to expired takes one away from a reader who holds the book.
  it('throws on a status it does not know rather than guessing', () => {
    expect(codeOf(() => normalizeLoan({ ...LOAN, status: 'SUSPENDED' }))).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });

  // Absence is reserved for open access, which genuinely never expires. Borrowing it for
  // "we could not read this" would give an Elite loan an unlimited-looking one.
  it.each([
    ['epoch milliseconds', 1_755_432_000_000],
    ['null', null],
    ['an object', { at: '2026-08-15' }],
    ['an empty string', ''],
  ])('throws when dueAt is present as %s rather than reading as absent', (_label, dueAt) => {
    expect(codeOf(() => normalizeLoan({ ...LOAN, dueAt }))).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });

  // A loan with no id cannot be returned, and finding that out at the Revoke tap is
  // worse than finding it out here.
  it('throws when the loan has no id', () => {
    const { loanId: _loanId, ...noId } = LOAN;
    expect(codeOf(() => normalizeLoan(noId))).toBe(LicenceError.MALFORMED_RESPONSE);
  });
});

describe('normalizeHold', () => {
  it('reads a queued hold with its position', () => {
    const hold = normalizeHold(QUEUED);
    expect(hold.holdId).toBe('hold_9a4');
    expect(hold.state).toBe('queued');
    expect(hold.position).toBe(4);
    expect(hold.queueLength).toBe(11);
  });

  // The clock is passed because an offered hold cannot arrive without one: on
  // `GET /library` it sits beside the arrays and is threaded down, and on `POST /holds` it
  // is `required` on the object itself. A bare call here would be testing a shape neither
  // call path produces.
  it('flattens the offer block onto the hold', () => {
    const hold = normalizeHold(OFFERED, '2026-08-13T10:00:00Z');
    expect(hold.state).toBe('offered');
    expect(hold.offerId).toBe('offer_a90');
    expect(hold.offerExpiresAt).toBe('2026-08-13T10:30:00Z');
  });

  // The contract sends `position: 1` on an offered hold. Our model says the field is
  // absent when offered, because a position is no longer a fact about a reader whose
  // turn has arrived — copying it would print "1 in the queue" beside Accept.
  it('drops the position once the hold is offered', () => {
    expect('position' in normalizeHold(OFFERED, '2026-08-13T10:00:00Z')).toBe(false);
  });

  it('takes the server clock from the enclosing response', () => {
    expect(normalizeHold(OFFERED, '2026-08-13T10:00:00Z').serverTime).toBe(
      '2026-08-13T10:00:00Z',
    );
  });

  // A queued reader has no countdown, so a clock beside their position would be a field
  // with nothing to measure. Same gate the resolver's own constructor applies.
  it('withholds the server clock from a queued hold', () => {
    expect('serverTime' in normalizeHold(QUEUED, '2026-08-13T10:00:00Z')).toBe(false);
  });

  // An OFFERED hold with no offer block is malformed, not an offer to quietly render
  // two buttons for — `offerId` is required inside it.
  it('throws when a hold claims OFFERED but carries no offer', () => {
    const { offer: _offer, ...noOffer } = OFFERED;
    expect(codeOf(() => normalizeHold(noOffer))).toBe(LicenceError.MALFORMED_RESPONSE);
  });

  // The inverse: this shape would produce an expiry with no reference instant.
  it('throws when a QUEUED hold carries an offer block', () => {
    const contradictory = { ...QUEUED, offer: { offerId: 'offer_a90', expiresAt: '2026-08-13T10:30:00Z' } };
    expect(codeOf(() => normalizeHold(contradictory, '2026-08-13T10:00:00Z'))).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });

  // Held to the same standard as `dueAt`, which they were not before: this went through
  // `reqString`, so any non-empty string passed and became an expiry nothing could measure.
  it.each([
    ['a word', 'soon'],
    ['a number', 1_755_432_000_000],
    ['null', null],
    ['an empty string', ''],
  ])('throws when the offer expiry is %s rather than an instant', (_label, expiresAt) => {
    const bad = { ...OFFERED, offer: { offerId: 'offer_a90', expiresAt } };
    expect(codeOf(() => normalizeHold(bad, '2026-08-13T10:00:00Z'))).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });

  // Kept verbatim, not reformatted. It is server-issued and absolute, and the countdown
  // measures it against `serverTime` — re-serialising it here would be our clock leaking in.
  it('keeps a valid expiry exactly as sent', () => {
    expect(normalizeHold(OFFERED, '2026-08-13T10:00:00Z').offerExpiresAt).toBe(
      '2026-08-13T10:30:00Z',
    );
  });

  // The rule stated on `Hold.serverTime`, tested where it can actually break.
  //
  // AN EARLIER VERSION OF THIS TEST WAS WORTHLESS: it called
  // `normalizeHold(OFFERED, '...')`, supplying the clock as an argument, so `serverTime`
  // was present by construction and the assertion could not fail. The case that leaks is
  // an offered hold with no clock in the payload AND no argument — which is how
  // `ApiLicenceClient.placeHold` calls it.
  it('rejects an offered hold with no server clock, rather than yielding a dangling expiry', () => {
    const { serverTime: _serverTime, ...noClock } = { ...OFFERED, serverTime: undefined };
    expect(codeOf(() => normalizeHold(noClock))).toBe(LicenceError.MALFORMED_RESPONSE);
  });

  // Reachable only from a non-conformant server, since `serverTime` is required on their
  // `Hold` — but so are `holdId` and `offerId`, and both of those are already checked.
  it('takes the clock off the object when no argument is given', () => {
    const withOwnClock = { ...OFFERED, serverTime: '2026-08-13T10:00:00Z' };
    expect(normalizeHold(withOwnClock).serverTime).toBe('2026-08-13T10:00:00Z');
  });

  // And the positive case the old test was trying to make, stated so it can fail: whatever
  // comes out of a successful normalize, the two travel together or not at all.
  it('never yields an expiry without a clock beside it', () => {
    const hold = normalizeHold(OFFERED, '2026-08-13T10:00:00Z');
    expect(hold.offerExpiresAt !== undefined).toBe(hold.serverTime !== undefined);
  });

  // Their enum has exactly two values. Ours has four, and the other two are ours alone:
  // 'none' is the absence of a hold and 'expired' is produced on the device by
  // lapseOffer. Neither is ever received, so neither is accepted here.
  it.each(['EXPIRED', 'CANCELLED', 'NONE'])('throws on the unsent status %s', (status) => {
    expect(codeOf(() => normalizeHold({ ...QUEUED, status }))).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });
});

describe('normalizeLibrary', () => {
  const LIBRARY = {
    loans: [LOAN],
    holds: [OFFERED, QUEUED],
    cursor: '1189',
    serverTime: '2026-08-13T10:00:00Z',
  };

  it('reads both lists, the cursor and the clock', () => {
    const library = normalizeLibrary(LIBRARY);
    expect(library.loans).toHaveLength(1);
    expect(library.holds).toHaveLength(2);
    expect(library.cursor).toBe('1189');
    expect(library.serverTime).toBe('2026-08-13T10:00:00Z');
  });

  // The clock sits beside the arrays rather than on each row, so it has to be threaded
  // down — and only onto the offered hold.
  it('threads the response clock onto the offered hold only', () => {
    const [offered, queued] = normalizeLibrary(LIBRARY).holds;
    expect(offered?.serverTime).toBe('2026-08-13T10:00:00Z');
    expect(queued?.serverTime).toBeUndefined();
  });

  // A reader who holds nothing and waits for nothing is the ordinary first-run case.
  it('treats both lists as empty when absent, rather than failing', () => {
    const library = normalizeLibrary({ serverTime: '2026-08-13T10:00:00Z' });
    expect(library.loans).toEqual([]);
    expect(library.holds).toEqual([]);
  });
});
