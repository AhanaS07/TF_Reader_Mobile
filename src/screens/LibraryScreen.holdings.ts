// Pure helpers for the Library screen — CAP-4 Module E, Library & Sync.
//
// Everything here is a function of its arguments. No store, no fetch, and NO
// CLOCK: `deviceNowMs` and `arrivalMs` are always passed in. That is what makes
// the countdown testable against a device clock deliberately set five minutes
// fast, which is the one screen behaviour Module E's definition of done names
// explicitly.
//
// WHY A SIBLING FILE RATHER THAN INLINE. Same shape as
// `ReaderPreferencesScreen.*Section.tsx`: the screen keeps the rendering and
// the store subscription, and the arithmetic it would otherwise bury lives
// where a test can reach it without a renderer.
import { MAX_BATCH_IDS } from '@model/batchItems';
import type { Hold, Loan } from '@model/types';

// ─── the three sections ──────────────────────────────────────────────────────

/**
 * The reader's holds split into the two sections that render them.
 *
 * SPLIT ON `state` ALONE, AND AN OFFER WITH NO `offerExpiresAt` STILL COUNTS AS
 * OFFERED. That case is a malformed response — the contract marks the expiry
 * required whenever a hold is offered — but dropping the row is the worse
 * failure of the two available. A copy has genuinely been reassigned to this
 * reader; hiding it loses them a book, whereas showing it without a countdown
 * costs them only the deadline. `QueueNotification` is built for exactly this:
 * `expiresInMinutes` is optional and absent renders no expiry line, so the
 * offer stays answerable.
 *
 * This is the one place the under-show rule is read the other way, and
 * deliberately: "show a reader less than they have" exists to stop someone
 * tapping Accept on a copy that is already gone. An offer with an unreadable
 * expiry has not been shown to be gone.
 *
 * `'expired'` AND `'none'` REACH NEITHER SECTION. Both mean the reader is not
 * in a queue: `'none'` is our own sentinel for absence, and a lapsed offer
 * "does not return the reader to their old place" — it is behaviourally the
 * same as never having asked. Rendering either as "waiting" would tell a reader
 * they are in a line they are not in.
 */
export function partitionHolds(holds: Hold[]): { offered: Hold[]; waiting: Hold[] } {
  const offered: Hold[] = [];
  const waiting: Hold[] = [];
  for (const hold of holds) {
    if (hold.state === 'offered') offered.push(hold);
    else if (hold.state === 'queued') waiting.push(hold);
  }
  return { offered, waiting };
}

/**
 * The loans a shelf may show.
 *
 * `'returned'` and `'expired'` are both over and are deliberately kept apart in
 * the model — but neither is on the reader's shelf. The read model behind
 * `GET /api/v1/library` already filters to live rows; this is the same rule
 * applied again on the device, because a shelf that renders a returned loan
 * invites a tap that can only be refused.
 */
export function activeLoans(loans: Loan[]): Loan[] {
  return loans.filter((loan) => loan.state === 'active');
}

// ─── hydration ───────────────────────────────────────────────────────────────

/**
 * Every distinct item id across the three sections, capped at wokay's batch
 * limit, plus how many rows were left unhydrated.
 *
 * ONE CALL, NOT TWENTY. The response carries ids; titles and covers come from a
 * single `getItemsBatch`. Copying catalogue metadata into the shelf would
 * duplicate data this module does not own, and a stale title is a second source
 * of truth.
 *
 * THE CAP IS HANDLED RATHER THAN ASSUMED AWAY. `items:batch` is frozen at 100
 * ids, so a reader with more rows than that cannot be hydrated in one call.
 * Ordered offered → loans → waiting so the truncation falls on the section that
 * can least afford to be wrong last: an offer is the only row that dies, and a
 * queue position is the only row nothing depends on. `truncated` is returned
 * rather than swallowed — silently dropping rows reads as "everything is here"
 * when it is not, and that bug only ever shows up in the demo account somebody
 * has been testing with for three weeks.
 */
export function collectItemIds(
  loans: Loan[],
  offered: Hold[],
  waiting: Hold[],
): { ids: string[]; truncated: number } {
  const seen = new Set<string>();
  for (const row of [...offered, ...loans, ...waiting]) seen.add(row.itemId);
  const all = [...seen];
  return { ids: all.slice(0, MAX_BATCH_IDS), truncated: Math.max(0, all.length - MAX_BATCH_IDS) };
}

// ─── the one place the two clocks meet ───────────────────────────────────────

// `serverOffsetMs` lives in `@hooks/useServerClock` rather than here. It is the
// other half of the same rule, but it belongs beside the only code that samples
// the device clock — keeping the offset and the sampling apart is how the two
// drifted into disagreeing in the first place.

/**
 * Whole minutes left on an offer, floored, or `undefined` when there is nothing
 * to count.
 *
 * FLOORED, SO THE LAST LIVE MINUTE READS AS `0` rather than skipping to
 * `undefined`. `QueueNotification` renders 0 as "Expiring now", which is the
 * honest thing to say in the final sixty seconds — and it is the caller's job to
 * do this arithmetic, because that component deliberately reads no clock.
 *
 * HITTING ZERO IS A PROMPT TO RE-FETCH, NEVER A CONCLUSION. The server decides
 * an offer is dead. A negative remainder clamps to 0 rather than going negative
 * so the row stays on screen, still answerable, until a refresh replaces it.
 */
export function offerMinutesRemaining(
  hold: Hold,
  offsetMs: number,
  deviceNowMs: number,
): number | undefined {
  if (hold.offerExpiresAt === undefined) return undefined;
  const expiresAt = Date.parse(hold.offerExpiresAt);
  if (Number.isNaN(expiresAt)) return undefined;
  const remaining = expiresAt - (deviceNowMs + offsetMs);
  return Math.max(0, Math.floor(remaining / 60_000));
}

/**
 * The countdown line on an offered row.
 *
 * A SECOND COPY OF `QueueNotification`'s OWN `expiryLabel`, AND THAT IS A
 * DUPLICATION WORTH NAMING RATHER THAN HIDING. That component computes the same
 * three sentences from the same number, but does not export the function — so
 * the Library screen either restates them here or renders a second banner
 * beside the global one (see the header of `LibraryScreen.tsx`). Restating five
 * words is the smaller of the two wrongs.
 *
 * THE FIX IS TO EXPORT IT FROM `QueueNotification`, not to keep both. Raised
 * with that component's author; the day it lands, this function is deleted and
 * the import replaces it. Kept adjacent to `offerMinutesRemaining` so the two
 * are found together when that happens.
 */
export function offerExpiryLabel(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined;
  if (minutes <= 0) return 'Expiring now';
  return minutes === 1 ? 'Expires in 1 minute' : `Expires in ${minutes} minutes`;
}

const MS_PER_DAY = 86_400_000;

/**
 * Due-date copy for a loan on the shelf.
 *
 * ABSENT `expiresAt` IS NOT AN ERROR. Open access never expires and the
 * contract omits `dueAt` for it entirely, so "No due date" is the correct
 * sentence rather than a fallback hiding missing data.
 *
 * Measured against the server's clock like everything else here. Days are
 * CEILED: a loan with four hours left is due "in 1 day", not "in 0 days" —
 * rounding a live loan down to nothing reads as expired.
 */
export function dueLabel(
  loan: Loan,
  offsetMs: number,
  deviceNowMs: number,
): string {
  if (loan.expiresAt === undefined) return 'No due date';
  const remaining = loan.expiresAt - (deviceNowMs + offsetMs);
  if (remaining <= 0) return 'Due now';
  const days = Math.ceil(remaining / MS_PER_DAY);
  return days === 1 ? 'Due in 1 day' : `Due in ${days} days`;
}

// ─── queue copy ──────────────────────────────────────────────────────────────

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const value = Math.abs(Math.trunc(n));
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * What a waiting reader is shown: "3rd of 7".
 *
 * `position` IS THE WHOLE OF IT AND `queueLength` IS CONTEXT. Without a
 * position there is nothing to say — a bare "7 people waiting" is a fact about
 * a queue, not about this reader, so it is omitted rather than padded out.
 */
export function queueLabel(hold: Hold): string | undefined {
  if (hold.position === undefined) return undefined;
  const place = ordinal(hold.position);
  return hold.queueLength === undefined ? `${place} in the queue` : `${place} of ${hold.queueLength}`;
}

// NOT BUILT: the estimated wait, which Module E's screen spec asks for as "a
// guess and labelled one". `Hold` in `src/model/types.ts` carries no
// `estimatedWaitDays` — flambeau's `LibraryHold` sends it and
// `normalizeLicence.ts` drops it at the boundary, along with `placedAt`,
// `canPersist`, `licenceModel`, `borrowedAt` and `returnedAt`.
//
// LEFT ABSENT RATHER THAN FAKED. The estimate cannot be derived on the device:
// it comes from the loan period and the copy count, and neither reaches here.
// Deriving something plausible from `queueLength` would produce a number that
// reads as a promise and answers to nothing — exactly what the "labelled a
// guess" instruction exists to prevent. The field has to come back through the
// boundary first; raised rather than worked around.
