/**
 * flambeau's loan change feed — the contract's designed revocation channel.
 *
 * This closes finding `B6` in `API_CONTRACT_NOTES.md`. flambeau's own words on why the endpoint
 * exists:
 *
 *   > It carries more than loans, despite the path: hold promotions, offers lapsing, and
 *   > entitlement revocations are all here. A revocation is the reason this endpoint exists at
 *   > all — it is the only way the app learns that a book it is showing has stopped being
 *   > readable.
 *
 * Chosen over the `GET /api/v1/licences/book/{id}/expired` boolean poll that an earlier attempt
 * used, and the difference matters rather than being a style preference:
 *
 *   - That endpoint is in NEITHER published contract. It lives on the untracked Mongo service
 *     the client's `/api/v1/*` prefix happens to reach - see `B2` in the notes.
 *   - It answers only "expired", which is a date comparison Encryption already does offline from
 *     the licence it holds. It cannot answer "revoked", which is the case that needs a server.
 *   - Polling one book at a time does not scale past the single hard-coded BOOK_ID.
 *
 * The feed answers all three, incrementally, for every book at once.
 *
 * ─── WIRE SHAPE IS A MIRROR, NOT A VERIFIED SCHEMA ───────────────────────────────────────────
 * `API_CONTRACT_REVIEW_CONTEXT.md` quotes flambeau's prose and its `ChangeReason` values, but no
 * `ChangeEntry` JSON schema is reproduced in any tracked file, and the app has never called this
 * endpoint. So the field names below are inferred from the prose and from the shape of the
 * sibling flambeau responses, NOT confirmed against a published schema.
 *
 * Everything downstream is therefore written to tolerate a mismatch: `parseChangeEntry` returns
 * null for anything it does not recognise, an unrecognised `reason` is ignored rather than
 * guessed at, and a malformed page is treated as "no changes" rather than as "no entitlement".
 * Fixing the names later is a change to this file only.
 */
import type { BookId } from '@/shared/contracts';
import { LOAN_CHANGES_PATH } from './syncConfig';
import { api } from './syncApi';

/**
 * Why a loan changed.
 *
 * `ENTITLEMENT_REVOKED` is the one this feature acts on - flambeau: "why this feed exists".
 * The others are carried by the same feed and are deliberately parsed but not acted on here:
 * a hold promotion or a lapsed offer is a library-shelf concern, not an offline-lock one, and
 * inventing behaviour for them would be guessing at another capability's job.
 */
export type ChangeReason =
  | 'ENTITLEMENT_REVOKED'
  | 'ENTITLEMENT_EXPIRED'
  | 'ENTITLEMENT_SUSPENDED'
  | 'LOAN_RETURNED'
  | 'LOAN_RENEWED'
  | 'HOLD_PROMOTED'
  | 'OFFER_LAPSED';

/** Reasons that mean "this book has stopped being readable". */
const REVOKING_REASONS: ReadonlySet<string> = new Set<ChangeReason>([
  'ENTITLEMENT_REVOKED',
  'ENTITLEMENT_EXPIRED',
  'ENTITLEMENT_SUSPENDED',
  'LOAN_RETURNED',
]);

/** Reasons that mean "readable again" - a renewal restores what a revocation took away. */
const RESTORING_REASONS: ReadonlySet<string> = new Set<ChangeReason>(['LOAN_RENEWED']);

export interface ChangeEntry {
  /** The book this concerns. flambeau calls it itemId; the reader calls it bookId. */
  bookId: BookId;
  reason: ChangeReason;
  /** When the change happened, per the server. ISO-8601 UTC on the wire. */
  occurredAt: string;
  /**
   * The loan's due date, when the entry carries one.
   *
   * `B_ok2` is the trap here and it is worth restating, because getting it wrong expires every
   * offline book minutes after download: offline expiry comes from `loan.dueAt` and NEVER from
   * a reading session's `expiresAt`. A reading session is short-lived by design. This field is
   * the loan's, and it is the only expiry this feature will ever look at.
   */
  dueAt: string | null;
}

export interface LoanChangesPage {
  entries: ChangeEntry[];
  /**
   * Opaque cursor for the next call. Never parsed or compared - only stored and echoed back.
   *
   * Null means the server sent no cursor, in which case the caller keeps the one it had rather
   * than clearing it. Clearing would re-read the whole feed from the beginning on the next run
   * and re-announce revocations already handled.
   */
  nextCursor: string | null;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Reads one entry defensively, returning null for anything unrecognised.
 *
 * Accepts `bookId` or `itemId` for the identifier, since the two teams name it differently and
 * this shape is unconfirmed. An unknown `reason` yields null rather than a default: guessing
 * that an unfamiliar reason means "revoked" would lock books on a spec change, and guessing it
 * means "fine" would silently drop a real revocation. Ignoring it and leaving the cursor
 * unadvanced-for-that-entry is the only honest option.
 */
export function parseChangeEntry(raw: unknown): ChangeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const bookId = isNonEmptyString(record.bookId)
    ? record.bookId
    : isNonEmptyString(record.itemId)
      ? record.itemId
      : null;
  if (!bookId) return null;

  const reason = record.reason;
  if (!isNonEmptyString(reason)) return null;
  if (!REVOKING_REASONS.has(reason) && !RESTORING_REASONS.has(reason)) return null;

  return {
    bookId,
    reason: reason as ChangeReason,
    occurredAt: isNonEmptyString(record.occurredAt)
      ? record.occurredAt
      : isNonEmptyString(record.changedAt)
        ? record.changedAt
        : '',
    dueAt: isNonEmptyString(record.dueAt) ? record.dueAt : null,
  };
}

export function isRevoking(entry: ChangeEntry): boolean {
  return REVOKING_REASONS.has(entry.reason);
}

export function isRestoring(entry: ChangeEntry): boolean {
  return RESTORING_REASONS.has(entry.reason);
}

/**
 * Fetches one page of the feed.
 *
 * `A10` is unresolved - flambeau has proposed moving this to `GET /api/v1/changes`, because a
 * hold event arriving on a loan-shaped path mislabels it. The path is therefore a single
 * constant in `syncConfig`, so that move is a one-line change and not a search-and-replace.
 *
 * A response whose body is not a recognisable page yields an empty page rather than throwing.
 * The endpoint has never been called by this app, so a shape mismatch is a realistic first
 * outcome, and it must read as "learned nothing" - not as "everything is revoked".
 */
export async function fetchLoanChanges(cursor: string | null): Promise<LoanChangesPage> {
  const response = await api.loanChanges(LOAN_CHANGES_PATH, cursor);
  const body: unknown = response.data;

  // Tolerate both a bare array and an enveloped page - the shape is unconfirmed.
  const rawEntries: unknown = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((body as Record<string, unknown>).entries ??
        (body as Record<string, unknown>).changes ??
        [])
      : [];

  const entries = (Array.isArray(rawEntries) ? rawEntries : [])
    .map(parseChangeEntry)
    .filter((entry): entry is ChangeEntry => entry !== null);

  const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const nextCursor = isNonEmptyString(envelope.nextCursor)
    ? envelope.nextCursor
    : isNonEmptyString(envelope.cursor)
      ? envelope.cursor
      : null;

  return { entries, nextCursor };
}
