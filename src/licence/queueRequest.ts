// src/licence/queueRequest.ts
// The two pieces of the Elite queue flow that the item detail screen needs.
//
// SCOPE — D12 IS ITEM DETAIL ONLY. Confirmed team decision, 26 Aug: the Grant
// access / queue-position / Accept-Reject affordances live on
// `ItemDetailScreen` and on no card surface. The catalogue, shelf, search and
// public-catalogue rows draw no queue button regardless of tier.
//
// WHAT THAT LEAVES HERE. An earlier pass added a card-row descriptor
// (`queueCardState`), an action constant, a predicate and a `useQueueRequest`
// hook so three list screens could render the three states. All four went with
// the decision — nothing consumed them once the rows stopped drawing buttons,
// and CONVENTIONS §10 rules out keeping code with no caller. What remains is the
// two functions the detail screen actually calls.
//
// WHY THEY LIVE HERE RATHER THAN IN THE SCREEN. `borrowOrPlaceHold` encodes a
// refusal rule that is easy to get subtly wrong and dangerous when wrong, so it
// is worth a named home and its own tests. `queuePositionLabel` is the copy for
// a status line, kept beside it because both belong to the same flow.
//
// THIS IS NOT A QUEUE ARCHITECTURE. No store, no endpoint, no state shape of its
// own — it calls the existing `LicenceSource`.
import { isLicenceFailure, LicenceError, type LicenceSource } from '@/licence/LicenceSource';
import type { AccessResult } from '@model/types';
import type { BookId } from '@/shared/types/primitives';

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
 * The reader's place in the queue, as one short line. Undefined when there is
 * nothing to say.
 *
 * A STATUS, NEVER A BUTTON — the 16 Aug decision record puts it exactly that
 * way: "a queue position is a status and never a button, which is why addToQueue
 * leaves the vocabulary". So this returns a string for the screen to render as
 * text, and there is deliberately no callback anywhere near it.
 *
 * `queueLength` IS A NICETY AND THE POSITION IS NOT — the contract marks it
 * optional for exactly that reason — so the copy degrades instead of waiting for
 * it. A position with no total still tells the reader the thing they came for.
 */
export function queuePositionLabel(
  access: Pick<AccessResult, 'queuePosition' | 'queueLength'>,
): string | undefined {
  if (access.queuePosition === undefined) return undefined;
  return access.queueLength === undefined
    ? `Position ${access.queuePosition} in queue`
    : `Position ${access.queuePosition} of ${access.queueLength} in queue`;
}
