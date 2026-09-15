// Gallery entry — every state of VoiceOverlay from hardcoded props.
//
// The overlay is a full-screen Modal, so unlike every other entry it cannot be
// shown side by side. Each state gets a button that opens it; the local useState
// is the CALLER owning visibility, which is the contract being demonstrated.
// No microphone is involved in any of this, which is the point of the component
// not owning the recogniser.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import VoiceOverlay, { type VoiceOverlayState } from './VoiceOverlay';
import { color, radius, space, type } from '@theme/tokens';

interface Entry {
  label: string;
  state: VoiceOverlayState;
  transcript?: string;
  errorMessage?: string;
  withActions?: boolean;
}

const ENTRIES: Entry[] = [
  { label: 'listening — nothing heard yet, ring pulsing', state: 'listening' },
  {
    label: 'listening — transcript growing',
    state: 'listening',
    transcript: 'machine learning in healthcare',
    withActions: true,
  },
  {
    label: 'transcribing — ring still, mic closed',
    state: 'transcribing',
    transcript: 'machine learning in healthcare',
    withActions: true,
  },
  {
    label: 'success — ready to search',
    state: 'success',
    transcript: 'machine learning in healthcare',
    withActions: true,
  },
  {
    label: 'error — no permission',
    state: 'error',
    errorMessage: 'Microphone access is off. Turn it on in Settings to search by voice.',
    withActions: true,
  },
  { label: 'error — no message supplied, falls back to default copy', state: 'error' },
  {
    label: 'cancel only — no Search or Clear (the spec’s bare contract)',
    state: 'success',
    transcript: 'machine learning in healthcare',
  },
  {
    label: 'overflow — a long transcript wraps rather than truncating',
    state: 'success',
    transcript:
      'anthropogenic climate change adaptation strategies in coastal megacities of southeast asia',
    withActions: true,
  },
];

export default function VoiceOverlayGallery() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>VoiceOverlay</Text>
      <Text style={styles.note}>
        Full-screen modal — tap a state to open it, then × to come back.
      </Text>

      {ENTRIES.map((entry, index) => (
        <Pressable
          key={index}
          style={styles.row}
          onPress={() => setOpen(index)}
          accessibilityRole="button"
          accessibilityLabel={entry.label}
        >
          <Text style={styles.rowLabel}>{entry.label}</Text>
        </Pressable>
      ))}

      {open !== null && (
        <VoiceOverlay
          visible
          state={ENTRIES[open].state}
          transcript={ENTRIES[open].transcript}
          errorMessage={ENTRIES[open].errorMessage}
          onCancel={() => setOpen(null)}
          onSubmit={ENTRIES[open].withActions ? () => setOpen(null) : undefined}
          onClear={ENTRIES[open].withActions ? () => {} : undefined}
        />
      )}

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  note: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginBottom: space.md,
  },
  row: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.white,
  },
  rowLabel: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  spacer: { height: space.xl },
});
