// Every action at every state, from static props. CONVENTIONS §9.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ACTION_IDS } from '@model/types';
import { color, space, type } from '@theme/tokens';

import ActionButton, { type ActionButtonState } from './ActionButton';

// Iterates the contract rather than a list of eight, so a ninth action appears
// here automatically — the same trick as AccessTierBadge.gallery.tsx.
const STATES: ActionButtonState[] = ['idle', 'loading', 'done', 'skeleton'];

export default function ActionButtonGallery() {
  // Wired to local state, never to navigation or a store (CONVENTIONS §9).
  const [lastPressed, setLastPressed] = useState<string>('nothing yet');

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ActionButton</Text>
      <Text style={styles.readout}>Last pressed: {lastPressed}</Text>

      {STATES.map((state) => (
        <View key={state} style={styles.group}>
          <Text style={styles.caption}>
            state={state}
            {state === 'done' && ' — inert, and every label falls back; nothing has a spent form'}
            {state === 'skeleton' && ' — no labels, and the same height as a real button'}
          </Text>
          {ACTION_IDS.map((action) => (
            <ActionButton
              key={action}
              action={action}
              state={state}
              onPress={() => setLastPressed(`${action} (${state})`)}
            />
          ))}
        </View>
      ))}

      <View style={styles.group}>
        <Text style={styles.caption}>disabled — a separate axis from state</Text>
        {ACTION_IDS.map((action) => (
          <ActionButton
            key={action}
            action={action}
            disabled
            onPress={() => setLastPressed(`${action} — SHOULD NOT HAPPEN`)}
          />
        ))}
      </View>

      <View style={styles.group}>
        <Text style={styles.caption}>
          Awkward content — the longest label in the narrowest realistic slot
        </Text>
        <View style={styles.narrow}>
          <ActionButton action="grantAccess" onPress={() => setLastPressed('grantAccess (narrow)')} />
        </View>
        <View style={styles.narrow}>
          <ActionButton action="revokeLicence" onPress={() => setLastPressed('revoke (narrow)')} />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.caption}>
          Side by side, so the skeleton&apos;s height can be compared against the real thing
        </Text>
        <View style={styles.row}>
          <View style={styles.slot}>
            <ActionButton action="read" onPress={() => setLastPressed('read')} />
          </View>
          <View style={styles.slot}>
            <ActionButton action="read" state="skeleton" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: space.md, gap: space.lg, paddingBottom: space.xl },
  heading: {
    fontWeight: type.sectionHeader.weight,
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  readout: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.primary,
  },
  group: { gap: space.sm },
  caption: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // A bordered box at roughly half a phone's width, to prove a long label
  // truncates rather than growing the button.
  narrow: { width: 160, borderWidth: 1, borderColor: color.border, padding: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  slot: { flex: 1 },
});
