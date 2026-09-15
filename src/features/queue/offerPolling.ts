// src/features/queue/offerPolling.ts
// D16 — the queue offer poll. `LicenceSource.getChanges` is flambeau's sync feed;
// this is the one thing that reads it today, watching for `HOLD_PROMOTED` and turning
// it into a live offer in `offerStore`.
//
// A PROMOTION IS A TRIGGER, NOT A HOLD. The change feed's `ChangeEntry` carries no
// `offerId` and no expiry — see the note on it in model/types.ts. So seeing
// `HOLD_PROMOTED` means "go read `getLibrary`", never "here is the offer".
//
// 60 SECONDS, PER THE TASK. `offerLapse.ts` notes the offer window is 15 minutes, so
// a minute between polls spends a fifteenth of it — a real cost, but the one the task
// asked for, and this file does not invent a shorter cadence on top.
//
// `useOfferPolling` READS `getLicenceSource()` ITSELF, matching how the screens in
// this tree reach the licence layer (`ItemDetailScreen` calls it inline rather than
// taking it as a prop) — a test swaps it out with `jest.mock('@config/licence', ...)`,
// same seam those screens' own tests already use. `pollOfferChanges` below stays a
// plain function taking a `LicenceSource`, so it needs none of that to be tested.
import { useEffect } from 'react';
import type { LicenceSource } from '@/licence';
import { getLicenceSource } from '@config/licence';
import { useOfferStore } from '@store/offerStore';

export const POLL_INTERVAL_MS = 60_000;

/**
 * One tick of the poll: reads changes since `since`, and if any of them is a
 * promotion, reads the library and hands every currently-offered hold to
 * `offerStore.receiveOffer`. Returns the cursor for the next tick.
 *
 * Exported on its own — this is the part worth testing directly; the interval
 * wrapper around it is not.
 */
export async function pollOfferChanges(
  source: LicenceSource,
  since: string | undefined,
): Promise<string> {
  const page = await source.getChanges(since);
  const promoted = page.changes.some((entry) => entry.reason === 'HOLD_PROMOTED');

  if (promoted) {
    const library = await source.getLibrary();
    for (const hold of library.holds) {
      if (hold.state === 'offered') useOfferStore.getState().receiveOffer(hold);
    }
  }

  return page.nextCursor;
}

/** Starts the 60-second poll for as long as the calling component is mounted. */
export function useOfferPolling(): void {
  useEffect(() => {
    const source = getLicenceSource();
    let since: string | undefined;
    let stopped = false;

    async function tick() {
      let nextCursor: string;
      try {
        nextCursor = await pollOfferChanges(source, since);
      } catch {
        // A network hiccup is ordinary on mobile — leave `since` where it was and
        // try again next tick rather than losing the reader's place in the feed.
        return;
      }
      if (!stopped) since = nextCursor;
    }

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, []);
}
