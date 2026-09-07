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
import type { Bookmark } from '@/shared/contracts';
import { MAX_BATCH_IDS } from '@model/batchItems';
import type { Hold, Loan } from '@model/types';
import type { DownloadRecord } from '@store/downloadStore';

// ─── the five sections ───────────────────────────────────────────────────────
//
// Offered to you · On loan · Downloads · Bookmarks · Waiting.
//
// Holds stay SPLIT across the first and last of those, unchanged: an offer dies
// and a queue position does not, so they are not one list with two badges (see
// `partitionHolds`). Downloads and Bookmarks are device-local and sit between
// them — sourced from `downloadStore` and `bookmarkStore` rather than from
// `GET /api/v1/library`, which carries neither.

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

/**
 * The downloads a shelf may show, newest first.
 *
 * NO TIER FILTER HERE, AND THAT IS THE RULE RATHER THAN AN OMISSION. Download
 * is permitted for OPEN_ACCESS and SUBSCRIPTION and refused for ELITE — wokay
 * answers `403 DOWNLOAD_NOT_PERMITTED` whatever the app offered — but that is a
 * decision about whether a download may START, enforced by the server and by
 * the download action. By the time a record reaches this store the bytes are
 * already on the device, and a shelf that re-derived "should this have been
 * allowed?" from `accessTier` would be the UI calculating access rights, which
 * Design Spec §5.1 and CONVENTIONS §3 forbid outright. So this renders what the
 * device downloaded; it does not audit it.
 *
 * A SUBSCRIPTION DOWNLOAD APPEARS TWICE ON PURPOSE — once under On loan, once
 * here. They are two different facts about one book: the institution has leased
 * a copy to this reader, and its bytes are on this phone. The loan is what
 * expires; the download is what works in a tunnel. Collapsing them would mean
 * dropping one of the two, and each is the answer to a question the other
 * cannot answer. An OPEN_ACCESS download has no loan at all, so it appears only
 * here — which is also why Downloads cannot be rendered as a badge on the loan
 * rows instead.
 */
export function sortedDownloads(downloads: DownloadRecord[]): DownloadRecord[] {
  // Copied before sorting: `downloads` is the store's own array, and sorting it
  // in place would mutate state outside a `set` and skip the re-render.
  return [...downloads].sort((a, b) => b.downloadedAt - a.downloadedAt);
}

/**
 * The bookmarks a shelf may show, most recently edited first.
 *
 * ONE ROW PER BOOKMARK, NOT PER BOOK. A bookmark is a place — the page a reader
 * stopped on — so the row has to carry the position or it says nothing the
 * title above it did not. Grouping to "Applied Thermodynamics · 3 bookmarks"
 * was the other option and loses exactly the thing the reader saved.
 *
 * TOMBSTONES DROPPED. `bookmarkStore` soft-deletes to keep deletions sendable
 * to the sync layer, so `isDeleted` rows are real records in state and must not
 * reach the shelf.
 *
 * SORTED ON `updatedAt`, which the sync contract has the CLIENT stamp at edit
 * time as its LWW key. It is a device wall-clock reading, so it is used to
 * ORDER and never to count down — a phone five minutes fast reorders this
 * section against another device's bookmarks and cannot mislabel any of them.
 */
export function sortedBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return bookmarks
    .filter((bookmark) => !bookmark.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─── hydration ───────────────────────────────────────────────────────────────

/** Every section that puts an id on screen, in hydration priority order. */
export interface ShelfSections {
  offered: Hold[];
  loans: Loan[];
  downloads: DownloadRecord[];
  bookmarks: Bookmark[];
  waiting: Hold[];
}

/**
 * Every distinct item id across the five sections, capped at wokay's batch
 * limit, plus how many rows were left unhydrated.
 *
 * ONE CALL, NOT TWENTY. The response carries ids; titles and covers come from a
 * single `getItemsBatch`. Copying catalogue metadata into the shelf would
 * duplicate data this module does not own, and a stale title is a second source
 * of truth. Downloads and bookmarks join the SAME call rather than adding two
 * more — they are ids in the same namespace, and a book that is on loan, on
 * this device AND bookmarked is one id, not three. `Bookmark.bookId` is that
 * same identity under the content layer's name for it; ten bookmarks in one
 * book contribute one id, not ten.
 *
 * THE CAP IS HANDLED RATHER THAN ASSUMED AWAY. `items:batch` is frozen at 100
 * ids, so a reader with more rows than that cannot be hydrated in one call.
 * Ordered offered → loans → downloads → bookmarks → waiting so the truncation
 * falls on the section that can least afford to be wrong last: an offer is the
 * only row that dies, and a queue position is the only row nothing depends on.
 * Downloads and bookmarks sit above waiting because an unhydrated row there is
 * strictly worse — a queued hold at least renders its position, whereas a
 * bookmark with no title is a bare id and nothing else. `truncated` is returned
 * rather than swallowed — silently dropping rows reads as "everything is here"
 * when it is not, and that bug only ever shows up in the demo account somebody
 * has been testing with for three weeks.
 *
 * AN OBJECT RATHER THAN FIVE POSITIONAL ARRAYS. Three was already at the limit
 * of what a call site can be read for; five arrays of two interchangeable types
 * is a swap waiting to happen, and swapping `offered` with `waiting` silently
 * inverts the truncation priority this function exists to get right.
 */
export function collectItemIds(sections: ShelfSections): { ids: string[]; truncated: number } {
  const { offered, loans, downloads, bookmarks, waiting } = sections;
  const seen = new Set<string>();
  for (const row of [...offered, ...loans, ...downloads]) seen.add(row.itemId);
  for (const bookmark of bookmarks) seen.add(bookmark.bookId);
  for (const row of waiting) seen.add(row.itemId);
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

// ─── downloads copy ──────────────────────────────────────────────────────────

const BYTES_PER_MB = 1_048_576;

/**
 * The badge on a downloaded row.
 *
 * IT SAYS "Downloaded", NOT "Available offline", AND THE WORD IS THE POINT.
 * `downloadStore` records that this device downloaded a book; the bytes, the
 * wrapped key and the licence live in CAP-7's `ContentStore`, and only its
 * `isAvailableOffline` can promise the book still opens with no network — a key
 * destroyed at expiry turns the ciphertext into noise while our record of the
 * download sits there unchanged. "Downloaded" is a claim about the past and
 * cannot go stale. "Available offline" is a promise about now, and this screen
 * is not the thing that can make it. Under-show, never over-show.
 *
 * SIZE IS APPENDED ONLY WHEN THE DOWNLOAD LAYER REPORTED ONE. Absent is the
 * common path today, and "Downloaded · 0 MB" would read as a failed download.
 * Rounded to one decimal, and anything under 0.1 MB floors to "0.1 MB" rather
 * than "0 MB" for the same reason.
 */
export function downloadedLabel(record: DownloadRecord): string {
  if (record.sizeBytes === undefined) return 'Downloaded';
  const mb = record.sizeBytes / BYTES_PER_MB;
  const shown = mb < 0.1 ? '0.1' : mb.toFixed(1);
  return `Downloaded · ${shown} MB`;
}

/**
 * The line under the Downloads heading: "2 items · 22.8 MB".
 *
 * SIZE IS SUMMED ONLY OVER THE RECORDS THAT REPORTED ONE. `sizeBytes` is absent
 * on the common path (see `DownloadRecord`), so a total is shown only when at
 * least one download carried a size — otherwise the count stands alone rather
 * than reading as "· 0.0 MB", which would look like nothing was downloaded. The
 * total is therefore a floor ("at least this much"), never a claim about bytes
 * the download layer never reported.
 *
 * Returns `undefined` for an empty list so the caller draws no caption at all
 * rather than "0 items".
 */
export function downloadsSummaryLabel(downloads: DownloadRecord[]): string | undefined {
  if (downloads.length === 0) return undefined;
  const items = downloads.length === 1 ? '1 item' : `${downloads.length} items`;
  const totalBytes = downloads.reduce((sum, record) => sum + (record.sizeBytes ?? 0), 0);
  if (totalBytes === 0) return items;
  return `${items} · ${(totalBytes / BYTES_PER_MB).toFixed(1)} MB`;
}

// ─── bookmarks copy ──────────────────────────────────────────────────────────

/**
 * Where a bookmark points, in words a reader recognises.
 *
 * A PAGE NUMBER FOR PDFs, AND NOTHING FOR EPUBs. `Locator` is a discriminated
 * union from the annotations contract: PDF carries a page, EPUB carries a CFI —
 * an `epubfcfi(/6/14!/4/2/1:0)` string that addresses a position in a spine
 * item and means nothing on a shelf. Resolving a CFI to a chapter or a
 * percentage needs the book's own spine loaded in the reader, which is CAP-7's
 * side of the seam and not something this screen can do or should fake.
 *
 * SO AN EPUB BOOKMARK FALLS BACK TO ITS `chapterId`, and to no badge at all
 * when it has none. The row still renders — the reader keeps the bookmark and
 * can still tap through to it — it just does not claim a position it cannot
 * compute. Rendering a truncated CFI would be a label that looks like data and
 * answers to nothing.
 *
 * `offset` IS DELIBERATELY IGNORED even though PDF locators may carry one. It
 * is a scroll position inside the page, and "Page 42 (+0.3)" is precision no
 * reader asked for.
 */
export function bookmarkLocationLabel(bookmark: Bookmark): string | undefined {
  const { locator } = bookmark;
  if (locator.type === 'PDF') return `Page ${locator.page}`;
  return bookmark.chapterId;
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

/**
 * A 0–1 fill for the queue-progress bar on a waiting row, or `undefined` when
 * there is not enough to draw one.
 *
 * A POSITIONAL INDICATOR, NOT A TIME ESTIMATE, and the distinction matters: the
 * bar shows how near the FRONT the reader is (1st of N fills it, last of N
 * barely does), which is a fact the response already carries. It is NOT the
 * "estimated wait" Module E's spec asks for — that needs `estimatedWaitDays`,
 * which the boundary drops (see the note at the foot of this file) — so this
 * makes no claim about days and cannot mislead the way a faked ETA would.
 *
 * NEEDS BOTH `position` AND `queueLength`. A position with no length is a place
 * with no scale, so `queueLabel` still renders "3rd in the queue" but the bar is
 * omitted rather than drawn against a denominator that is not there.
 */
export function queueProgressFraction(hold: Hold): number | undefined {
  if (hold.position === undefined || hold.queueLength === undefined) return undefined;
  if (hold.queueLength <= 0) return undefined;
  const fromFront = hold.queueLength - hold.position + 1;
  return Math.max(0, Math.min(1, fromFront / hold.queueLength));
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
