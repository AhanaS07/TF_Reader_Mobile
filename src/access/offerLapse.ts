// src/access/offerLapse.ts
// Whether an Elite offer has stopped standing. One predicate, and it exists
// because `resolveAccess` may not answer this question itself.
//
// WHY IT IS NOT IN resolveAccess. That file reads no clock, on purpose: a resolve
// that consulted the time would return different answers for the same inputs, and
// a list of forty cards resolving forty times per render is only free because it
// cannot. But an offer lapses by the passage of time and nothing else, so the
// question needs a `now` from somewhere. Splitting it out keeps the resolve pure
// and puts the impurity in one named place a test can drive.
//
// IT STILL DOES NOT READ THE CLOCK. `now` is a parameter, not a `Date.now()` call.
// The caller — the offer store, which knows when it fetched — supplies it. That is
// what makes every case below testable without freezing time.
import type { Hold } from '@model/types';

// A hold that is actually offering a copy right now.
//
// EXISTS SO `lapseOffer` CANNOT BE MISCALLED. Handing that function a queued hold
// would strip a waiting reader's `position` and resolve them to `requires_grant` —
// their place in the line gone from the screen. A runtime guard would catch it by
// returning the hold untouched, which makes the caller's mistake silent at exactly
// the moment it wants to be loud. This makes it a compile error instead, which is
// the same objection answered without the silence.
export type OfferedHold = Hold & { state: 'offered' };

// The offer window is SHORT: flambeau told us 15 minutes on 17 Aug. That figure
// is NOT in their contract and NOT hardcoded here, and both of those are
// deliberate.
//
// `offerExpiresAt` is server-issued and absolute, so it is the only authority on
// when a particular offer ends. Deriving an expiry from "placed + 15 minutes"
// would substitute our arithmetic for their answer and drift the moment they tune
// the window. The 15 minutes is worth writing down for a different reason: it
// tells whoever builds the polling cadence that a minute between polls spends a
// fifteenth of the reader's window, which is a design constraint rather than a
// value to compute with.
export const OFFER_WINDOW_MINUTES_UNDOCUMENTED = 15;

// True when the offer named by this hold is over.
//
// `now` and `hold.offerExpiresAt` are both ISO-8601 instants. Compare them as
// instants rather than as strings: ISO-8601 sorts lexicographically only while
// both sides carry the same offset and the same precision, and flambeau's `Z`
// against a locally-formatted `+05:30` breaks that quietly rather than loudly.
//
// FALSE FOR EVERY STATE THAT IS NOT AN OFFER, including 'expired'. A hold that
// flambeau has already told us is expired has nothing left to lapse — asking this
// of it is a category error, and answering `true` would invite a caller to treat
// the two as interchangeable when only one of them needs acting on.
//
// FALSE WHEN THERE IS NO EXPIRY, which is the conservative direction and the one
// this whole module is arranged around. An offer we cannot date is one we must not
// withdraw from the reader on a guess: the cost of showing Accept a few seconds
// past the window is a `409 OFFER_EXPIRED` we already treat as an ordinary reply,
// and the cost of hiding it early is a copy the reader was entitled to and never
// saw.
export function isOfferLapsed(hold: Hold | undefined, now: string): boolean {
  if (hold?.state !== 'offered') return false;
  if (hold.offerExpiresAt === undefined) return false;

  const expires = Date.parse(hold.offerExpiresAt);
  const at = Date.parse(now);
  // An unparseable instant is not a lapsed offer. Same conservative direction as
  // a missing expiry, for the same reason — and `NaN` comparisons are false in
  // both directions, so this guard is about saying so rather than about behaviour.
  if (Number.isNaN(expires) || Number.isNaN(at)) return false;

  return at >= expires;
}

// The hold as the offer store should hold it once the window has closed.
//
// RETURNS A NEW HOLD, and drops `offerId`, `offerExpiresAt` and `position` with
// it. Every one of those is a fact about an offer that no longer exists, and a
// lapsed hold carrying an expiry is exactly the shape that lets a countdown keep
// rendering against a dead offer. `position` goes too: the reader did not keep
// their place, so reporting the one they had would be worse than reporting none.
//
// `holdId` STAYS. It is the identity of the hold across its whole life, and the
// store needs it to reconcile against what flambeau says next.
//
// TAKES AN `OfferedHold` AND NOT A `Hold`, which is the whole of the guard. There
// is no runtime check here and there should not be one: a guard that returned the
// hold untouched would swallow a caller's mistake at the moment it most wants to be
// loud. The type refuses the call instead, before it runs.
//
// Most callers should reach for `applyLapse` below rather than this, and then the
// narrowing is done for them.
export function lapseOffer(hold: OfferedHold): Hold {
  const { offerId: _offerId, offerExpiresAt: _offerExpiresAt, position: _position, ...rest } = hold;
  return { ...rest, state: 'expired' };
}

// The pair as one step: lapse the hold if its window has closed, otherwise hand
// back exactly what came in.
//
// THE ERGONOMIC PATH, and the one the offer store wants. `isOfferLapsed` and
// `lapseOffer` are separately useful — a countdown wants the predicate without the
// transform — but using them by hand means restating the `'offered'` check to get
// past the type, and a caller who finds that annoying is a caller who reaches for a
// cast. This does it once, here.
//
// PASSES EVERYTHING ELSE THROUGH UNTOUCHED, `undefined` included, so a caller can
// run every hold it holds through this without asking what state each one is in.
export function applyLapse(hold: Hold | undefined, now: string): Hold | undefined {
  if (!isOffered(hold)) return hold;
  return isOfferLapsed(hold, now) ? lapseOffer(hold) : hold;
}

// Narrows a hold to `OfferedHold`, and it has to be a written-out predicate rather
// than an inline `hold?.state === 'offered'`.
//
// WHY THE INLINE CHECK DOES NOT WORK. `Hold` is one interface with a union-typed
// `state`, not a discriminated union of four interfaces. Testing `hold.state`
// narrows the STATE, not the HOLD — so after `if (hold?.state !== 'offered')`
// TypeScript still types `hold` as `Hold` and refuses to pass it to `lapseOffer`.
// This asserts the link between the two that the shape cannot express.
//
// AND THAT IS THE ARGUMENT FOR MAKING `Hold` A DISCRIMINATED UNION, which is a real
// suggestion sitting on this PR. With one, this function would not need to exist and
// `offerId` / `offerExpiresAt` / `serverTime` could be REQUIRED on the offered
// variant instead of optional on all four — which is what they actually are. It is
// deferred rather than dismissed: it rewrites every `Loan` and `Hold` fixture in the
// suite, and that is not a thing to do in the same change as unblocking the calls.
//
// NOT A PREDICATE ON `isOfferLapsed` ITSELF, which would be unsound. That returns
// false for a live offer as well as for a queued hold, so `false` cannot be taken to
// mean "not offered" — and a predicate saying otherwise would narrow the else branch
// to something wrong.
export function isOffered(hold: Hold | undefined): hold is OfferedHold {
  return hold?.state === 'offered';
}
