// src/features/queue/QueueNotificationHost.tsx
// D16 — mounts the queue offer banner globally, once, at the app root. A reader who
// is not on the title's own detail screen still has to be able to answer an offer
// before it lapses, which is the whole reason `QueueNotification` and `offerStore`
// exist apart from `ItemDetailScreen`'s own accept/reject wiring.
//
// `QueueNotification` STAYS PURE — props in, callbacks out, same as every other
// component in `src/components/`. This file is where reading `offerStore` and calling
// the licence source actually happens, same split `ItemDetailScreen` already draws
// between itself and `ActionBar`.
//
// TOP PLACEMENT IS A CALL MADE HERE, NOT A DESIGN DECISION. `QueueNotification`'s own
// comment says design have not chosen top-vs-bottom. Anchoring under the safe area at
// the top means an offer is visible rather than invisible while that is unresolved —
// nothing about the component itself assumes where it sits, so moving it later is a
// one-line change to this file's style, not a rewrite.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOfferStore } from '@store/offerStore';
import { getLicenceSource } from '@config/licence';
import { getCatalogueSource } from '@config/catalogue';
import { space } from '@theme/tokens';
import QueueNotification, { type QueueNotificationPending } from '@components/QueueNotification';

import { useOfferPolling } from './offerPolling';

export default function QueueNotificationHost() {
  useOfferPolling();

  const offer = useOfferStore((state) => state.offer);
  const hasHydrated = useOfferStore((state) => state._hasHydrated);
  const minutesRemaining = useOfferStore((state) => state.minutesRemaining());
  const insets = useSafeAreaInsets();

  const itemId = offer?.itemId;
  // Keyed by the itemId it was resolved for, rather than reset in the effect below —
  // resetting there would be a synchronous `setState` in an effect body, which fires
  // a second render for no reason. Keeping the key alongside the title instead means
  // a stale title from the PREVIOUS offer is never shown for a new one: the render
  // below falls back to the raw id whenever `resolvedTitle.itemId` does not match.
  const [resolvedTitle, setResolvedTitle] = useState<{ itemId: string; title: string } | undefined>(
    undefined,
  );
  const [pending, setPending] = useState<QueueNotificationPending | undefined>(undefined);

  // Resolved separately from the offer itself: the store knows the hold, not the
  // title, and `getItemsBatch` (F9) is the one call away the contract promises.
  useEffect(() => {
    if (itemId === undefined) return;
    let cancelled = false;
    getCatalogueSource()
      .getItemsBatch([itemId])
      .then((result) => {
        if (!cancelled) setResolvedTitle({ itemId, title: result.items[0]?.title ?? itemId });
      })
      .catch(() => {
        // A title that failed to resolve is not a reason to hide the offer — fall
        // back to the id so the reader can still act on it.
        if (!cancelled) setResolvedTitle({ itemId, title: itemId });
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const title = itemId !== undefined && resolvedTitle?.itemId === itemId ? resolvedTitle.title : itemId;

  // `hasHydrated` and `minutesRemaining !== undefined` together are the same "is
  // there a live offer" question `offerStore.minutesRemaining` already answers for
  // rendering a countdown — checked again here rather than trusted, so `offer` narrows
  // to non-null below instead of relying on a boolean computed from it.
  if (!hasHydrated || offer === null || minutesRemaining === undefined) return null;

  const holdId = offer.holdId;
  // Present whenever `state` is 'offered', per `Hold`'s own contract — `minutesRemaining`
  // being defined already implies that state, so this is a defensive floor, not the
  // expected path.
  if (holdId === undefined) return null;

  // Arrow functions, not declarations — a declaration is hoisted, so TypeScript will
  // not carry the `holdId !== undefined` narrowing above into its body. A `const`
  // defined after the check keeps it.
  const handleAccept = () => {
    setPending('accept');
    getLicenceSource()
      .acceptOffer(holdId)
      .then(() => useOfferStore.getState().clear())
      .catch(() => {})
      .finally(() => setPending(undefined));
  };

  const handleReject = () => {
    setPending('reject');
    getLicenceSource()
      .cancelHold(holdId)
      .then(() => useOfferStore.getState().clear())
      .catch(() => {})
      .finally(() => setPending(undefined));
  };

  return (
    <View style={[styles.wrapper, { top: insets.top + space.sm }]} pointerEvents="box-none">
      <QueueNotification
        title={title ?? ''}
        expiresInMinutes={minutesRemaining}
        pending={pending}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: space.md,
    right: space.md,
  },
});
