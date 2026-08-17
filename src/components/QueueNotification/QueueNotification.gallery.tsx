// Gallery entry — every state of QueueNotification from hardcoded props, plus a
// fake trigger at the top so the banner can be seen appearing the way a real
// offer would. flambeau deliver offers by polling `GET /api/v1/loans/changes`,
// which is Akriti's D16 in Week 3, so nothing real can fire one yet.
//
// Callbacks are wired to local state only: never a store, never navigation.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import QueueNotification, { type QueueNotificationPending } from './QueueNotification';

function TriggerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.trigger} onPress={onPress} accessibilityRole="button">
      <Text style={styles.triggerLabel}>{label}</Text>
    </Pressable>
  );
}

export default function QueueNotificationGallery() {
  // The fake trigger. `offerShown` stands in for the store slot holding an offer,
  // and `pending` for the tap Akriti's store has in flight.
  const [offerShown, setOfferShown] = useState(false);
  const [pending, setPending] = useState<QueueNotificationPending | undefined>(undefined);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>QueueNotification</Text>

      <Text style={styles.label}>fake trigger — press to fire an offer</Text>
      <View style={styles.demo}>
        {offerShown ? (
          <QueueNotification
            title="Ethnographies of Waiting"
            expiresInMinutes={10}
            pending={pending}
            onAccept={() => setPending('accept')}
            onReject={() => setPending('reject')}
          />
        ) : (
          <Text style={styles.demoLine}>No offer waiting.</Text>
        )}
        <View style={styles.triggerRow}>
          <TriggerButton
            label="Fire an offer"
            onPress={() => {
              setPending(undefined);
              setOfferShown(true);
            }}
          />
          <TriggerButton
            label="Clear"
            onPress={() => {
              setPending(undefined);
              setOfferShown(false);
            }}
          />
        </View>
      </View>

      <Text style={styles.label}>idle — with an expiry</Text>
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={12}
        onAccept={() => {}}
        onReject={() => {}}
      />

      <Text style={styles.label}>idle — no expiry sent</Text>
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={() => {}} />

      <Text style={styles.label}>accepting — Reject goes inert while Accept is in flight</Text>
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={12}
        pending="accept"
        onAccept={() => {}}
        onReject={() => {}}
      />

      <Text style={styles.label}>rejecting — Accept goes inert while Reject is in flight</Text>
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={12}
        pending="reject"
        onAccept={() => {}}
        onReject={() => {}}
      />

      <Text style={styles.label}>one minute left — singular, not &quot;1 minutes&quot;</Text>
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={1}
        onAccept={() => {}}
        onReject={() => {}}
      />

      <Text style={styles.label}>out of time — the offer is about to lapse</Text>
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={0}
        onAccept={() => {}}
        onReject={() => {}}
      />

      <Text style={styles.label}>long title — clamps at two lines, buttons stay put</Text>
      <QueueNotification
        title="The Routledge Handbook of Southeast Asian and Caribbean Ethnographic Practice, Second Edition"
        expiresInMinutes={7}
        onAccept={() => {}}
        onReject={() => {}}
      />

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.surface },
  content: { paddingHorizontal: space.md, paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    marginVertical: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  demo: {
    gap: space.sm,
    padding: space.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  demoLine: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  triggerRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  trigger: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: color.primary,
  },
  triggerLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
  spacer: { height: space.xl },
});
