// src/licence/queueRequest.ts
// D12 — the Elite queue request, in one place, because it now has five callers.
//
// WHY THIS FILE EXISTS. "Grant access" used to live only on the item detail
// screen, so the borrow-then-queue rule lived there too. D12 puts the same
// button on the shelf, search and catalogue rows, and a rule copied into four
// screens is a rule that will be four different rules by Friday. Nothing here is
// new behaviour: it is `ItemDetailScreen`'s existing `grantAccess` branch, moved
// so that screen and the card surfaces share it.
//
// THIS IS NOT A NEW QUEUE ARCHITECTURE. There is no new store, no new endpoint
// and no new state shape. It calls the existing `LicenceSource` and invalidates
// the existing `libraryStore`, which is what every licence call in the app
// already does.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getLicenceSource } from '@config/licence';
import { isLicenceFailure, LicenceError, type LicenceSource } from '@/licence/LicenceSource';
import type { AccessResult, ActionId } from '@model/types';
import type { BookId } from '@/shared/types/primitives';
import { useLibraryStore } from '@store/libraryStore';

/**
 * Borrow first; join the queue only if the refusal was specifically "no copies".
 *
 * THE NARROW CATCH IS THE WHOLE POINT, and it is why this is a named function
 * rather than an inline `.catch`. A network error, an expired session or any
 * other refusal must NOT enqueue the reader — that would put somebody in a queue
 * for a title they may already hold elsewhere, off the back of a failure that
 * said nothing about availability. Only `REFUSED` + `NO_COPIES_AVAILABLE`, the
 * pair `POST /api/v1/loans` documents, falls through to the hold.
 *
 * Rejects on anything else, so the caller still sees the failure.
 */
export function borrowOrPlaceHold(source: LicenceSource, itemId: BookId): Promise<unknown> {
  return source.borrow(itemId).catch((err: unknown) => {
    if (
      isLicenceFailure(err) &&
      err.code === LicenceError.REFUSED &&
      err.errorCode === 'NO_COPIES_AVAILABLE'
    ) {
      return source.placeHold(itemId);
    }
    return Promise.reject(err);
  });
}

/**
 * The one action D12 puts on a card row.
 *
 * NAMED ONCE so the three card surfaces cannot disagree, and typed as `ActionId`
 * so a rename in the contract is a compile error here rather than three rows
 * that quietly stop offering the queue.
 *
 * WHY ONLY THIS ONE, when `resolveAccess` can return eight. A card is a row in a
 * list, not a detail screen: Read, Download and Revoke licence all belong on the
 * item's own page where there is room for the consequences, and `queued` and
 * `offered` are answered from the detail screen and the notification banner
 * respectively. `grantAccess` is the one action whose whole point is that it
 * should not require a trip to the detail screen first — which is what D12 says.
 *
 * This is SELECTING from a resolved answer, not computing one. Nothing here reads
 * a tier, a licence or a session; it filters the list `resolveAccess` already
 * returned, the same way `ActionBar` filters by `actionEmphasis`.
 */
export const QUEUE_ACTION: ActionId = 'grantAccess';

/** Whether a resolved access result offers the queue on a card row. */
export function offersQueue(access: Pick<AccessResult, 'actions'>): boolean {
  return access.actions.includes(QUEUE_ACTION);
}

export interface UseQueueRequest {
  /**
   * The item whose queue request is in flight, or null. A card compares its own
   * id against this to decide whether to show `state="loading"`.
   */
  pendingItemId: BookId | null;
  /**
   * Fire the request for one item. Ignored while any request is in flight — see
   * the note in the implementation.
   */
  requestQueue: (itemId: BookId) => void;
}

/**
 * The queue request as a screen sees it: one pending id, one callback.
 *
 * ONE REQUEST AT A TIME, ACROSS THE WHOLE LIST, not one per row. This is the
 * same rule `ActionBar` already states for its own bar — "Only one tap can be in
 * flight", which is why its `pending` prop is a single `ActionId` rather than a
 * set. A list of twenty Elite rows should not be able to fire twenty borrows,
 * and the second tap on the SAME row must not fire a second borrow either. Both
 * fall out of the single guard below.
 *
 * `refresh()` AFTER, ALWAYS, and on failure too. borrow and placeHold both mutate
 * server state, so the holdings cache is stale either way: a borrow that threw
 * may still have created the loan. `libraryStore.refresh` already keeps its
 * last-known data on a failed fetch, so this cannot blank a working list.
 */
export function useQueueRequest(): UseQueueRequest {
  const refresh = useLibraryStore((s) => s.refresh);
  const [pendingItemId, setPendingItemId] = useState<BookId | null>(null);

  // A REF, NOT THE STATE, IS THE GUARD. Two taps in the same tick both read the
  // pre-render value of `pendingItemId`, so a state check would let the second
  // through. The ref is written synchronously and closes the door immediately;
  // the state exists only for the UI to render from.
  const inFlight = useRef(false);

  // Guards the state write in the async continuation. A row unmounts as soon as
  // the resolve changes it, which is the common path here rather than an edge.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const requestQueue = useCallback(
    (itemId: BookId) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPendingItemId(itemId);

      borrowOrPlaceHold(getLicenceSource(), itemId)
        .catch(() => {
          // Swallowed for the same reason ItemDetailScreen swallows it: D13 owns
          // turning a licence refusal into a message, and D13 is Keshav's this
          // week. Caught HERE, before the refresh, so that a failed request
          // still invalidates the cache below.
        })
        .then(() => refresh())
        .catch(() => {
          // `libraryStore.refresh` keeps its last-known data on a failed fetch,
          // so there is nothing to repair — this only stops the rejection
          // escaping as unhandled.
        })
        .finally(() => {
          inFlight.current = false;
          if (!mounted.current) return;
          setPendingItemId(null);
        });
    },
    [refresh],
  );

  return { pendingItemId, requestQueue };
}
