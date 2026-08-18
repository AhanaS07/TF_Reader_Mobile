// src/licence/normalizeLicence.ts
// flambeau's JSON → our `Loan` and `Hold`. PURE: no fetch, no clock, no config.
//
// The licence equivalent of `model/opds/normalize.ts`, and it exists for the same
// reason: one place understands the wire, so `MockLicenceClient` and
// `ApiLicenceClient` cannot disagree about the shape they produce — only about where
// the bytes came from. Input is `unknown` because it is untrusted JSON.
//
// THE VOCABULARIES DO NOT LINE UP, and that is the whole job. flambeau speak
// `ACTIVE` / `RETURNED` / `EXPIRED` and `QUEUED` / `OFFERED`; our `Loan.state` and
// `Hold.state` each carry a `'none'` they never send, and `Hold.state` carries an
// `'expired'` they never send either. Every one of those gaps is deliberate and
// commented at the point it matters below.
import type { Hold, Loan } from '@model/types';
import { LicenceError, LicenceFailure, type Library } from './LicenceSource';

type Json = Record<string, unknown>;

function malformed(what: string, target?: string): LicenceFailure {
  const options: { target?: string } = {};
  if (target !== undefined) options.target = target;
  return new LicenceFailure(LicenceError.MALFORMED_RESPONSE, { ...options, cause: what });
}

function asRecord(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed(`${what} is not an object`);
  }
  return value as Json;
}

function reqString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw malformed(`missing ${what}`);
  return value;
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// `dueAt` → `Loan.expiresAt`, which is epoch milliseconds rather than the ISO string
// the wire carries. `primitives.ts` reserves that representation for client wall-time
// and the field is already typed `number`, so the conversion happens here rather than
// leaking two time formats into the model.
//
// ABSENT IS LEGITIMATE: open access never expires and the contract omits `dueAt` for
// it entirely. An unparseable date is NOT legitimate and throws — a loan with a due
// date we cannot read would render a countdown to nowhere.
// A PRESENT-BUT-WRONG-TYPED `dueAt` THROWS rather than reading as absent. This used to
// route through `optString`, so a `dueAt` arriving as epoch milliseconds — or as null, or
// as an object — came back `undefined` and rendered as "never expires". Absence is
// reserved for open access, which genuinely never expires, so borrowing it for "we could
// not read this" would hand an Elite loan an unlimited-looking one. MALFORMED_RESPONSE is
// loud on purpose and this is exactly the case for it.
function toExpiresAt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(`dueAt is present but not an ISO string: ${JSON.stringify(value)}`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw malformed(`unparseable dueAt: ${value}`);
  return parsed;
}

// `LoanStatus` → `Loan.state`.
//
// ALL THREE OF THEIRS MAP TO ONE OF OURS EACH, with nothing collapsed. `RETURNED` and
// `EXPIRED` both mean the loan is over, and they are still kept apart because
// flambeau say the app shows them differently — the reader closed one and the sweep
// closed the other.
//
// `'none'` IS UNREACHABLE FROM HERE, and that is correct: flambeau never send a
// statusless loan. Our `'none'` means "no loan at all", which is the absence of an
// object rather than a value inside one.
function toLoanState(raw: string): Loan['state'] {
  switch (raw) {
    case 'ACTIVE':
      return 'active';
    case 'RETURNED':
      return 'returned';
    case 'EXPIRED':
      return 'expired';
    default:
      // Loud rather than defaulted. A fourth status defaulting to `'active'` hands a
      // reader a Read button for a loan that is over; defaulting to `'expired'` takes
      // one away from a reader who has it. Neither guess is safe, so neither is made.
      throw malformed(`unknown loan status: ${raw}`);
  }
}

// `HoldStatus` → `Hold.state`.
//
// THEIR ENUM HAS ONLY TWO VALUES, which is worth stating because ours has four.
// `'none'` is the absence of a hold, as above. `'expired'` is OURS ALONE and is never
// received: flambeau hard-delete a cancelled hold and drop a lapsed one, so a hold
// that is over does not come back with a status — it stops appearing in the list.
// `lapseOffer` in src/access is the only thing that produces `'expired'`, and it does
// so on the device when the window closes ahead of the next poll.
function toHoldState(raw: string): Hold['state'] {
  switch (raw) {
    case 'QUEUED':
      return 'queued';
    case 'OFFERED':
      return 'offered';
    default:
      throw malformed(`unknown hold status: ${raw}`);
  }
}

// TAKES NO `serverTime`, unlike `normalizeHold` below, and the asymmetry is the point:
// a loan has no countdown. `dueAt` is weeks out and renders as a date, so there is
// nothing to measure elapsed time against and no reference instant to keep. Only the
// offer window needs one. Accepting the parameter here and ignoring it would invite
// somebody to start rendering "time remaining" off it.
export function normalizeLoan(value: unknown): Loan {
  const loan = asRecord(value, 'loan');
  const expiresAt = toExpiresAt(loan.dueAt);

  return {
    loanId: reqString(loan.loanId, 'loanId'),
    itemId: reqString(loan.itemId, 'loan itemId'),
    state: toLoanState(reqString(loan.status, 'loan status')),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export function normalizeHold(value: unknown, serverTime?: string): Hold {
  const hold = asRecord(value, 'hold');
  const state = toHoldState(reqString(hold.status, 'hold status'));
  const clock = serverTime ?? optString(hold.serverTime);

  // The offer is a nested object, present only while OFFERED. Read it rather than
  // inferring an offer from the status alone: `offerId` is required inside it, so an
  // OFFERED hold with no offer block is a malformed response and not an offer we
  // should quietly render two buttons for.
  const offer = hold.offer === undefined ? undefined : asRecord(hold.offer, 'offer');
  if (state === 'offered' && offer === undefined) {
    throw malformed('hold is OFFERED but carries no offer block', optString(hold.holdId));
  }
  // AND THE INVERSE, which was missing. The offer fields below were spread on the mere
  // presence of an offer block while `serverTime` was gated on the state — so a QUEUED
  // hold arriving with an offer block normalized to an expiry with NO reference clock,
  // which is precisely the shape this file exists to prevent. Rejected rather than gated:
  // a queued hold carrying an offer is a contradiction on flambeau's side, and silently
  // dropping half of it would hide that rather than surface it.
  if (state !== 'offered' && offer !== undefined) {
    throw malformed(
      `hold is ${state.toUpperCase()} but carries an offer block`,
      optString(hold.holdId),
    );
  }

  const position = optNumber(hold.position);
  const queueLength = optNumber(hold.queueLength);

  return {
    holdId: reqString(hold.holdId, 'holdId'),
    itemId: reqString(hold.itemId, 'hold itemId'),
    state,
    // POSITION IS DROPPED FOR AN OFFER, deliberately. The contract sends `position: 1`
    // on an OFFERED hold and our own model says the field is absent when offered,
    // because the reader's turn has arrived and a position is no longer a fact about
    // them. Copying it would put "1 in the queue" beside an Accept button.
    ...(state !== 'offered' && position !== undefined ? { position } : {}),
    ...(queueLength !== undefined ? { queueLength } : {}),
    ...(offer !== undefined ? { offerId: reqString(offer.offerId, 'offerId') } : {}),
    ...(offer !== undefined
      ? { offerExpiresAt: reqString(offer.expiresAt, 'offer expiresAt') }
      : {}),
    // ONLY ON AN OFFER, matching what `AccessResult` promises. A queued reader has no
    // countdown, so a clock beside their position would be a field with nothing to
    // measure — the same leak the resolver's `result()` constructor already gates.
    ...(state === 'offered' && clock !== undefined ? { serverTime: clock } : {}),
  };
}

export function normalizeLibrary(value: unknown): Library {
  const body = asRecord(value, 'library');
  const serverTime = optString(body.serverTime);
  const cursor = optString(body.cursor);

  // Both arrays default to empty rather than throwing when absent. A reader who holds
  // nothing and waits for nothing is the ordinary first-run case, and the contract's
  // own example omits `groups`-style keys elsewhere for exactly that reason.
  const loans = body.loans === undefined ? [] : asArray(body.loans, 'loans');
  const holds = body.holds === undefined ? [] : asArray(body.holds, 'holds');

  return {
    loans: loans.map((loan) => normalizeLoan(loan)),
    holds: holds.map((hold) => normalizeHold(hold, serverTime)),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(serverTime !== undefined ? { serverTime } : {}),
  };
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw malformed(`${what} is not an array`);
  return value;
}
