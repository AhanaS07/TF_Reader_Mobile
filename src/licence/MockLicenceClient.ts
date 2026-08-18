// src/licence/MockLicenceClient.ts
// A `LicenceSource` backed by memory. This is how the Elite flow gets built and
// demonstrated before flambeau finish theirs.
//
// IT IS A STATE MACHINE, NOT A STUB, and that is the point. Returning a canned loan
// from every call would let the buttons render and prove nothing: the whole risk in
// this flow is the SEQUENCE — borrow refused, hold placed, offer arrives, offer
// accepted or declined or missed. So this keeps real per-item state and refuses the
// transitions flambeau would refuse, which is what makes a demo against it worth
// believing.
//
// IT MODELS flambeau's REFUSALS, not just their successes. `NO_COPIES_AVAILABLE` on a
// contended title, `OFFER_EXPIRED` on a stale accept, `409` on re-borrowing — every one
// of those is an ordinary path in the real flow, and a mock that only ever succeeds
// teaches the app nothing about them.
//
// PROMOTION IS MANUAL, by design. `promoteHold` is the fake trigger — there is no timer
// in here and nothing happens on its own, because a demo where the offer appears when
// the presenter says so is worth more than one that fires on a schedule nobody can see.
// flambeau's real mechanism is polling `GET /loans/changes`; that is D16, and it does not
// change this file.
import type { BookId } from '@/shared/types/primitives';
import type { Hold, Loan } from '@model/types';
import {
  LicenceError,
  LicenceFailure,
  type Library,
  type LicenceSource,
} from './LicenceSource';

export interface MockLicenceOptions {
  // Items whose copies are all out, so `borrow` refuses with `NO_COPIES_AVAILABLE`
  // and the queue becomes the reader's only route. Without at least one of these the
  // whole Elite sequence is unreachable, because borrowing always succeeds.
  contendedItems?: string[];
  // The clock. Injected rather than read, so a test can drive an offer to its expiry
  // without waiting and without faking timers globally.
  now?: () => Date;
  // Loan length for a new borrow. Not a constant in the real system either — flambeau
  // read it off the entitlement — so it is configurable here rather than hardcoded.
  loanDays?: number;
}

const DEFAULT_LOAN_DAYS = 14;

export class MockLicenceClient implements LicenceSource {
  private readonly loans = new Map<string, Loan>();
  private readonly holds = new Map<string, Hold>();
  private readonly contended: Set<string>;
  private readonly now: () => Date;
  private readonly loanDays: number;
  // PER INSTANCE, not module scope, and both halves of that matter. As a module counter
  // it meant minting an id on one client moved another client's `cursor` — and
  // `resetLicenceSource`, whose whole job is keeping one test's state out of the next,
  // could drop the client but not the counter, so ids and cursors carried across tests.
  //
  // A counter rather than randomness stays right: a demo that produces the same ids twice
  // is one you can compare two runs of. That only holds per instance.
  private sequence = 0;

  constructor(options: MockLicenceOptions = {}) {
    this.contended = new Set(options.contendedItems ?? []);
    this.now = options.now ?? (() => new Date());
    this.loanDays = options.loanDays ?? DEFAULT_LOAN_DAYS;
  }

  // Ids look like flambeau's, so a log or a screenshot from the mock reads the same as one
  // from the real thing.
  private nextId(prefix: string): string {
    return `${prefix}_${(++this.sequence).toString(36)}`;
  }

  async borrow(itemId: BookId): Promise<Loan> {
    // Create or validate, not create — flambeau return the existing loan and a 200
    // rather than an error, because a double tap is the ordinary case. Callers rely on
    // this, so the mock has to honour it or it will teach the app to add a guard it
    // does not need.
    const held = this.loans.get(itemId);
    if (held?.state === 'active') return held;

    // The refusal that makes the queue reachable. Note it is a REFUSAL and not a
    // silent enqueue: flambeau name the hold endpoint in the message so the app can
    // offer the queue as a choice, which is a different thing from making it for them.
    if (this.contended.has(itemId)) {
      throw new LicenceFailure(LicenceError.REFUSED, {
        errorCode: 'NO_COPIES_AVAILABLE',
        target: itemId,
      });
    }

    const loan: Loan = {
      loanId: this.nextId('loan'),
      itemId: itemId,
      state: 'active',
      expiresAt: this.now().getTime() + this.loanDays * 24 * 60 * 60 * 1000,
    };
    this.loans.set(itemId, loan);
    return loan;
  }

  async returnLoan(loanId: string): Promise<void> {
    const entry = [...this.loans.values()].find((loan) => loan.loanId === loanId);
    if (entry === undefined) {
      throw new LicenceFailure(LicenceError.REFUSED, {
        errorCode: 'NOT_FOUND',
        target: loanId,
      });
    }
    // Returning an already-returned loan is a refusal, not a silent success — the app
    // showing a book as returned twice means something else went wrong, and swallowing
    // it hides that.
    if (entry.state !== 'active') {
      throw new LicenceFailure(LicenceError.REFUSED, {
        errorCode: 'LOAN_NOT_ACTIVE',
        target: loanId,
      });
    }
    // 'returned' and not 'expired': the reader closed this one. The sweep closing a
    // loan at its due date is the other value, and the two are shown differently.
    this.loans.set(entry.itemId, { ...entry, state: 'returned' });
  }

  async placeHold(itemId: BookId): Promise<Hold> {
    // Idempotent: a reader already in the queue gets their existing hold with the
    // position unchanged. Re-joining must not send somebody to the back of a queue
    // they were already in.
    //
    // A LAPSED OFFER IS NOT "ALREADY IN THE QUEUE", and missing that was a real bug.
    // This used to return any hold whose state was queued or offered, without asking
    // whether the offer window had closed — so a reader who missed their turn got the
    // dead offer handed back, `offerExpiresAt` already in the past and no new position.
    // Meanwhile `acceptOffer` treated that same hold as gone and deleted it, so the two
    // methods disagreed about one state. The doctrine settles it: a lapsed offer means
    // the hold is gone and the reader rejoins at the back, so this mints a fresh one.
    const existing = this.holds.get(itemId);
    const stillLive =
      existing?.state === 'queued' || (existing?.state === 'offered' && !this.hasLapsed(existing));
    if (stillLive && existing !== undefined) return existing;

    // Always QUEUED, never OFFERED — there is no response shape in which placing a
    // hold hands back an offer, however free the copies are. `promoteHold` is the only
    // route to an offer.
    const hold: Hold = {
      holdId: this.nextId('hold'),
      itemId: itemId,
      state: 'queued',
      position: 3,
      queueLength: 7,
      serverTime: this.now().toISOString(),
    };
    this.holds.set(itemId, hold);
    return hold;
  }

  async acceptOffer(holdId: string): Promise<Loan> {
    const hold = this.findHold(holdId);

    // The ordinary failure, not an exceptional one. Two ways to get here: the offer was
    // never live, or it lapsed between the render and the tap. Either way the hold is
    // GONE rather than restored — the reader rejoins at the back.
    if (hold.state !== 'offered' || this.hasLapsed(hold)) {
      this.holds.delete(hold.itemId);
      throw new LicenceFailure(LicenceError.REFUSED, {
        errorCode: 'OFFER_EXPIRED',
        target: holdId,
      });
    }

    // Hands back exactly what borrowing would. The copy was already leased in this
    // reader's name during the offer window, so this only writes the loan.
    const loan: Loan = {
      loanId: this.nextId('loan'),
      itemId: hold.itemId,
      state: 'active',
      expiresAt: this.now().getTime() + this.loanDays * 24 * 60 * 60 * 1000,
    };
    this.loans.set(hold.itemId, loan);
    this.holds.delete(hold.itemId);
    return loan;
  }

  async cancelHold(holdId: string): Promise<void> {
    const hold = [...this.holds.values()].find((h) => h.holdId === holdId);
    // Cancelling an already-cancelled hold is a success, not a 404. The reader asked
    // for it to be gone and it is gone.
    if (hold === undefined) return;
    // A hard delete, and the only one in this file — a queue that remembers everybody
    // who ever left it cannot answer "what position am I". This is also what Reject
    // does, which is why declining an offer costs the reader their place outright.
    this.holds.delete(hold.itemId);
  }

  async getLibrary(): Promise<Library> {
    const serverTime = this.now().toISOString();
    return {
      // Only live rows. A returned or expired loan is not on the reader's shelf, and
      // the read model is what the shelf renders — `GET /loans` is the collection for
      // history, and this is not it.
      loans: [...this.loans.values()].filter((loan) => loan.state === 'active'),
      holds: [...this.holds.values()].filter(
        (hold) => hold.state === 'queued' || hold.state === 'offered',
      ),
      cursor: String(this.sequence),
      serverTime,
    };
  }

  async openReadingSession(itemId: BookId): Promise<never> {
    throw new LicenceFailure(LicenceError.NOT_OURS_YET, {
      target: itemId,
      cause:
        'POST /api/v1/reading-sessions needs a devicePublicKey from t4targaryen’s ' +
        'keystore. Whether we call it or they do is open question 6 and unclaimed.',
    });
  }

  // ── the fake trigger ───────────────────────────────────────────────────────────
  //
  // NOT PART OF `LicenceSource`, deliberately. Nothing in the app may call this — it is
  // the demo's hand on the lever, standing in for a promotion arriving off
  // `GET /loans/changes`. Keeping it off the interface means a screen cannot reach it
  // even by accident, and swapping in `ApiLicenceClient` cannot leave a caller
  // depending on something that only exists in the mock.
  //
  // Turns this reader's queued hold into an offer. `windowMinutes` defaults to the 15
  // flambeau quoted on 17 Aug; pass a smaller number to watch the countdown run out, or
  // a negative one to produce an already-lapsed offer for the error path.
  promoteHold(itemId: string, windowMinutes = 15): Hold {
    const hold = this.holds.get(itemId);
    if (hold === undefined) {
      throw new Error(`MockLicenceClient: no hold on ${itemId} to promote`);
    }
    // REFUSES TO REPLACE A LIVE OFFER, and the rule is not this file's invention: the
    // note on `Hold.offerId` says the offer store must not let a second offer silently
    // replace a first, and that `offerId` exists so the rule is enforceable. This used to
    // mint a new id and a new window straight over a standing offer — so the mock broke
    // the one rule the field was added for, and the app is built against the mock.
    //
    // A LAPSED OFFER MAY BE PROMOTED AGAIN, because that is a real transition: the window
    // closed, the reader rejoined, their turn came round. Only a live one is refused.
    if (hold.state === 'offered' && !this.hasLapsed(hold)) {
      throw new Error(
        `MockLicenceClient: ${itemId} already has a live offer (${hold.offerId ?? 'no id'}). ` +
          'A second offer must not silently replace it — accept, cancel, or let it lapse first.',
      );
    }
    const at = this.now();
    const offered: Hold = {
      holdId: hold.holdId ?? this.nextId('hold'),
      itemId,
      state: 'offered',
      offerId: this.nextId('offer'),
      offerExpiresAt: new Date(at.getTime() + windowMinutes * 60 * 1000).toISOString(),
      serverTime: at.toISOString(),
      ...(hold.queueLength !== undefined ? { queueLength: hold.queueLength } : {}),
    };
    this.holds.set(itemId, offered);
    return offered;
  }

  // Everything this reader holds, live rows and dead ones. For assertions and for the
  // gallery's debug panel — `getLibrary` deliberately hides the dead ones.
  inspect(): { loans: Loan[]; holds: Hold[] } {
    return { loans: [...this.loans.values()], holds: [...this.holds.values()] };
  }

  private findHold(holdId: string): Hold {
    const hold = [...this.holds.values()].find((h) => h.holdId === holdId);
    if (hold === undefined) {
      throw new LicenceFailure(LicenceError.REFUSED, {
        errorCode: 'NOT_FOUND',
        target: holdId,
      });
    }
    return hold;
  }

  // The mock's own clock check, and NOT `isOfferLapsed` from src/access. That function
  // answers what the DEVICE believes about a hold it was handed; this is the server
  // deciding whether the window it issued has closed. Same arithmetic, opposite sides
  // of the wire — and a mock that borrowed the client's opinion could never disagree
  // with it, which is exactly the disagreement the 409 path exists to exercise.
  private hasLapsed(hold: Hold): boolean {
    if (hold.offerExpiresAt === undefined) return false;
    return this.now().getTime() >= Date.parse(hold.offerExpiresAt);
  }
}
