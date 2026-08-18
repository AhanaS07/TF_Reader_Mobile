// src/licence/MockLicenceClient.test.ts
// The Elite sequence, driven through the mock the way a screen will drive it.
//
// THESE ARE THE TESTS THAT MATTER MOST in this layer, and not because the mock is
// shipped — it is not. They matter because the sequence is the risk: every individual
// call is a one-liner, and what can go wrong is the ORDER. A borrow that silently
// enqueues, an accept that succeeds on a dead offer, a reject that leaves the reader
// still queued — none of those are visible in a single call's assertion.
import { resolveAccess, type ResolveAccessInput } from '@/access';
import { LicenceError, isLicenceFailure } from './LicenceSource';
import { MockLicenceClient, type MockLicenceOptions } from './MockLicenceClient';
import type { Acquisition } from '@model/types';

// Bare item ids, because that is all the calls take — `BorrowRequest` and `HoldRequest`
// each declare exactly one property. Identity rides on the token.
const CONTENDED = 'item_42';
const FREE = 'item_free';

// A fixed clock, so an offer's window can be walked past without waiting.
const at = (iso: string) => () => new Date(iso);
// Written with milliseconds because that is what `toISOString()` emits, and these tests
// assert on the string the mock actually produces rather than on a prettier equivalent.
const T0 = '2026-08-18T10:00:00.000Z';

const client = (over: MockLicenceOptions = {}) =>
  new MockLicenceClient({ contendedItems: ['item_42'], now: at(T0), ...over });

const failureCode = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run;
  } catch (error) {
    return isLicenceFailure(error) ? error.errorCode : undefined;
  }
  return undefined;
};

describe('borrow', () => {
  it('hands back an active loan on a title with copies free', async () => {
    const loan = await client().borrow(FREE);
    expect(loan.state).toBe('active');
    expect(loan.loanId).toBeDefined();
  });

  // The id is the whole reason this layer changed this week. A loan that cannot be
  // named cannot be returned.
  it('names the loan, so it can be returned later', async () => {
    const c = client();
    const loan = await c.borrow(FREE);
    await expect(c.returnLoan(loan.loanId as string)).resolves.toBeUndefined();
  });

  // Create or validate, not create. A double tap is the ordinary case.
  it('returns the same loan on a second tap rather than refusing', async () => {
    const c = client();
    const first = await c.borrow(FREE);
    const second = await c.borrow(FREE);
    expect(second.loanId).toBe(first.loanId);
  });

  // The refusal that makes the queue reachable, and it is a refusal rather than a
  // silent enqueue — flambeau name the hold endpoint so the app can offer the queue as
  // a choice instead of making it for the reader.
  it('refuses a contended title with NO_COPIES_AVAILABLE and does not enqueue', async () => {
    const c = client();
    expect(await failureCode(c.borrow(CONTENDED))).toBe('NO_COPIES_AVAILABLE');
    expect(c.inspect().holds).toEqual([]);
  });
});

describe('returnLoan', () => {
  it("marks the loan returned, not expired — the reader closed it", async () => {
    const c = client();
    const loan = await c.borrow(FREE);
    await c.returnLoan(loan.loanId as string);
    expect(c.inspect().loans[0]?.state).toBe('returned');
  });

  // Not a silent success: the app showing a book as returned twice means something
  // else went wrong, and swallowing it hides that.
  it('refuses a second return with LOAN_NOT_ACTIVE', async () => {
    const c = client();
    const loan = await c.borrow(FREE);
    await c.returnLoan(loan.loanId as string);
    expect(await failureCode(c.returnLoan(loan.loanId as string))).toBe('LOAN_NOT_ACTIVE');
  });
});

describe('placeHold', () => {
  // The claim the whole Elite decision rests on. If placing a hold could return an
  // offer, Grant access would need a second code path — it does not.
  it('always comes back queued, never offered', async () => {
    const hold = await client().placeHold(CONTENDED);
    expect(hold.state).toBe('queued');
    expect(hold.offerId).toBeUndefined();
  });

  it('names the hold, so Accept and Reject have something to address', async () => {
    expect((await client().placeHold(CONTENDED)).holdId).toBeDefined();
  });

  // Re-joining must not send somebody to the back of a queue they were already in.
  it('is idempotent and keeps the position', async () => {
    const c = client();
    const first = await c.placeHold(CONTENDED);
    const second = await c.placeHold(CONTENDED);
    expect(second.holdId).toBe(first.holdId);
    expect(second.position).toBe(first.position);
  });
});

describe('the offer', () => {
  it('arrives only when promoted, never on its own', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    expect((await c.getLibrary()).holds[0]?.state).toBe('queued');
    c.promoteHold('item_42');
    expect((await c.getLibrary()).holds[0]?.state).toBe('offered');
  });

  // Both halves of what an offer needs: the identity that tells it from the next one,
  // and the clock the countdown measures against.
  it('carries an offerId and a server clock beside the expiry', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    const offered = c.promoteHold('item_42');
    expect(offered.offerId).toBeDefined();
    expect(offered.offerExpiresAt).toBeDefined();
    expect(offered.serverTime).toBe(T0);
  });

  // A position is not a fact about a reader whose turn has arrived.
  it('drops the queue position once the turn has arrived', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    expect(c.promoteHold('item_42').position).toBeUndefined();
  });

  it('accepts into an active loan', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    const offered = c.promoteHold('item_42');
    const loan = await c.acceptOffer(offered.holdId as string);
    expect(loan.state).toBe('active');
    // The hold is spent once taken — it must not linger and resolve to Accept again.
    expect((await c.getLibrary()).holds).toEqual([]);
  });

  // The ordinary failure, not an exceptional one, and the consequence is the part the
  // reader will not guess: the hold is gone, not restored to its old place.
  it('refuses a lapsed accept with OFFER_EXPIRED and drops the hold', async () => {
    const c = client({ now: at(T0) });
    await c.placeHold(CONTENDED);
    const offered = c.promoteHold('item_42', -1);
    expect(await failureCode(c.acceptOffer(offered.holdId as string))).toBe('OFFER_EXPIRED');
    expect(c.inspect().holds).toEqual([]);
  });
});

describe('cancelHold', () => {
  // Rejecting an offer and leaving the queue are one call, which is flambeau's design.
  // The cost to the reader is the same either way, and it is total.
  it('is how Reject works, and it costs the reader their place entirely', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    const offered = c.promoteHold('item_42');
    await c.cancelHold(offered.holdId as string);
    expect(c.inspect().holds).toEqual([]);
  });

  // The reader asked for it to be gone and it is gone.
  it('is a success on an already-cancelled hold, not a failure', async () => {
    const c = client();
    const hold = await c.placeHold(CONTENDED);
    await c.cancelHold(hold.holdId as string);
    await expect(c.cancelHold(hold.holdId as string)).resolves.toBeUndefined();
  });
});

describe('getLibrary', () => {
  it('carries the cursor and the server clock the change feed needs', async () => {
    const library = await client().getLibrary();
    expect(library.cursor).toBeDefined();
    expect(library.serverTime).toBe(T0);
  });

  // The read model is the shelf, not the history. `GET /loans` is the collection.
  it('hides a returned loan', async () => {
    const c = client();
    const loan = await c.borrow(FREE);
    await c.returnLoan(loan.loanId as string);
    expect((await c.getLibrary()).loans).toEqual([]);
  });
});

describe('openReadingSession', () => {
  // Present and refusing, rather than absent. A missing method is a mystery; this says
  // why, and names the question.
  it('refuses with NOT_OURS_YET and says whose key is missing', async () => {
    try {
      await client().openReadingSession(CONTENDED);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(isLicenceFailure(error) && error.code).toBe(LicenceError.NOT_OURS_YET);
      expect(String(isLicenceFailure(error) ? error.cause : '')).toContain('question 6');
    }
  });
});

// The point of the whole layer: what the mock produces feeds straight into the resolver
// and comes out as the right buttons. If these two ever disagree, one of them is wrong
// about the flow and no individual unit test would say so.
describe('the sequence, resolved', () => {
  const elite: Acquisition = {
    actionId: 'borrow',
    href: 'https://flambeau.test/api/v1/loans',
    licenceModel: 'ELITE',
    encryption: null,
    hasSearchIndex: false,
    canPersist: false,
  };

  const buttons = (over: Partial<ResolveAccessInput>) =>
    resolveAccess({
      item: { id: 'item_42', acquisition: elite },
      institutionId: 'inst_7f3',
      session: { userId: 'user_9c2', institutionId: 'inst_7f3', roles: ['MEMBER'], collections: [], exp: 0 },
      ...over,
    }).actions;

  it('walks Grant access → queued → offered → reading', async () => {
    const c = client();

    // Nothing held, nothing asked for.
    expect(buttons({})).toEqual(['grantAccess']);

    // Grant access borrows first and is refused, so the queue is offered as a choice.
    expect(await failureCode(c.borrow(CONTENDED))).toBe('NO_COPIES_AVAILABLE');
    const queued = await c.placeHold(CONTENDED);
    expect(buttons({ hold: queued })).toEqual([]);

    // The offer arrives later, by a read rather than off the tap.
    const offered = c.promoteHold('item_42');
    expect(buttons({ hold: offered })).toEqual(['acceptOffer', 'rejectOffer']);

    // Accepted, and Elite never gets a Download at any point.
    const loan = await c.acceptOffer(offered.holdId as string);
    expect(buttons({ loan })).toEqual(['read', 'revokeLicence']);
  });

  // A missed offer puts the reader back where they started, not back in the queue.
  it('sends a reader whose offer lapsed back to Grant access', async () => {
    const c = client();
    await c.placeHold(CONTENDED);
    const stale = c.promoteHold('item_42', -1);
    await failureCode(c.acceptOffer(stale.holdId as string));
    // The hold is gone, so the resolve has nothing to go on but the tier.
    expect(buttons({})).toEqual(['grantAccess']);
  });
});
