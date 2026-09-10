// src/components/ElitePendingAccessCard/ElitePendingAccessCard.tsx
// The highest-priority thing the Library screen can show: an Elite copy that
// is the reader's to take right now, and will stop being theirs if they wait
// too long. Product spec (Sept 2026), Library redesign — "ACCESS AVAILABLE…
// This is an ACTION ITEM and therefore takes priority over ordinary library
// content."
//
// SHARED BY `All` AND `Premium` (spec §11: "Do NOT implement completely
// separate versions of the same Elite access logic"). Both screens hand this
// the same hold, resolved the same way, so there is exactly one place that
// draws an Elite offer.
//
// USES ActionButton RATHER THAN DRAWING ITS OWN BUTTONS, for the identical
// reason `QueueNotification`'s own header gives: `acceptOffer`/`rejectOffer`
// already have one label/icon/emphasis table, and a second pair of buttons
// here would be CONVENTIONS §7's "second implementation of the same thing".
//
// NO COVER ART. The reference mockup for this state shows none — an offer is
// a decision to make, not a book to browse — and `ContentCard`'s own image
// well would imply a "row" this card is not: no chevron, no navigation, two
// buttons that answer the offer instead.
//
// `expiryLabel` IS A STRING, NOT MINUTES. The caller (Library screen) already
// owns a clock-driven countdown for exactly this hold via
// `LibraryScreen.holdings.ts`'s `offerExpiryLabel` — reformatting it a THIRD
// time here (after `offerExpiryLabel` and `QueueNotification`'s own private
// copy) would be the drift `offerExpiryLabel`'s own comment already flags.
// Absent renders no expiry line at all, never an invented one.
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@components/ActionButton';
import { color, radius, space, type } from '@theme/tokens';

export interface ElitePendingAccessCardProps {
  title: string;
  /** Already-formatted ("Expires in 12 minutes", "Expiring now"). Absent renders no line. */
  expiryLabel?: string;
  /** Which button is waiting on flambeau. Omitted when nothing is in flight. */
  pending?: 'accept' | 'reject';
  onAccept: () => void;
  onReject: () => void;
}

export default function ElitePendingAccessCard({
  title,
  expiryLabel,
  pending,
  onAccept,
  onReject,
}: ElitePendingAccessCardProps) {
  return (
    <View testID="elite-pending-access-card" style={styles.card}>
      <View style={styles.tag}>
        <Text style={styles.tagLabel}>Access available</Text>
      </View>

      <Text testID="elite-pending-access-title" style={styles.title} numberOfLines={2}>
        {title}
      </Text>

      <Text style={styles.message}>You have been granted Elite access to this title.</Text>

      <View style={styles.actions}>
        <View style={styles.actionSlot}>
          <ActionButton
            action="acceptOffer"
            state={pending === 'accept' ? 'loading' : 'idle'}
            disabled={pending === 'reject'}
            onPress={onAccept}
          />
        </View>
        <View style={styles.actionSlot}>
          <ActionButton
            action="rejectOffer"
            state={pending === 'reject' ? 'loading' : 'idle'}
            disabled={pending === 'accept'}
            onPress={onReject}
          />
        </View>
      </View>

      {expiryLabel !== undefined && (
        <Text testID="elite-pending-access-expiry" style={styles.expiry}>
          {expiryLabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Same surface language as ContentCard's own row — white, a hairline
  // border, `radius.card` — but no `elevation.card`: this is an alert, not a
  // lifted object, and stacking Library's own shadow language on top of an
  // already-loud "act now" card would be one emphasis device too many.
  card: {
    backgroundColor: color.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.error,
    padding: space.md,
    gap: space.sm,
  },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.error,
  },
  tagLabel: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
    color: color.white,
  },
  // Aleo — this is the title of a book, the same reason ContentCard's own
  // title takes `cardTitle` rather than the screen's UI chrome font.
  title: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: type.cardTitle.size,
    lineHeight: type.cardTitle.lineHeight,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  message: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  actionSlot: {
    flex: 1,
  },
  expiry: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.error,
  },
});
