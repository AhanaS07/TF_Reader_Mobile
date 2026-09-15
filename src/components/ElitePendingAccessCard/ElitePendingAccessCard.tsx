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
// AN INFORMATIONAL SURFACE, NOT AN ALARM — a later visual pass (reference
// mockup, Sept 2026) deliberately moved this off a red-bordered warning
// treatment: an Elite grant is good news for the reader, not a fault
// condition, and `surface`'s own light tint plus a bell icon says "something
// arrived for you" rather than "something is wrong". `AccessTierBadge` draws
// the "Elite" pill rather than a bespoke tag — the same one-Elite-pill
// `LibraryScreen.tsx`'s `EliteLoanRow`/`EliteQueueRow` compose into
// `ContentCard`'s own badge slot for Elite's other two states.
//
// USES ActionButton RATHER THAN DRAWING ITS OWN BUTTONS, for the identical
// reason `QueueNotification`'s own header gives: `acceptOffer`/`rejectOffer`
// already have one label/icon/emphasis table, and a second pair of buttons
// here would be CONVENTIONS §7's "second implementation of the same thing".
//
// `expiryLabel` IS A STRING, NOT MINUTES. The caller (Library screen) already
// owns a clock-driven countdown for exactly this hold via
// `LibraryScreen.holdings.ts`'s `offerCountdownLabel` — reformatting it a
// second time here would be exactly the drift that function's own comment
// warns against. Absent renders no expiry line at all, never an invented one.
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AccessTierBadge } from '@components/AccessTierBadge';
import { ActionButton } from '@components/ActionButton';
import { color, radius, space, type } from '@theme/tokens';

export interface ElitePendingAccessCardProps {
  title: string;
  /** Already-formatted ("Expires in 23:41", "Expiring now"). Absent renders no line. */
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
      <View style={styles.header}>
        <View style={styles.bell}>
          <Ionicons name="notifications" size={type.body.size} color={color.navy} />
        </View>
        <Text style={styles.headerLabel}>Access available</Text>
        <View style={styles.headerSpacer} />
        <AccessTierBadge tier="ELITE" size="sm" />
      </View>

      <Text testID="elite-pending-access-title" style={styles.title} numberOfLines={2}>
        {title}
      </Text>

      <Text style={styles.message}>
        You can now access this title through your institutional allocation.
      </Text>

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
  // `surface`'s own light tint, no border — see the file header on why this
  // moved off a red-alert treatment.
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  bell: {
    width: space.lg,
    height: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.navy,
  },
  headerSpacer: {
    flex: 1,
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
  // Neutral, not red — an Elite offer counting down is worth noting, but this
  // card is no longer a warning surface. See the file header.
  expiry: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
});
