// Owner: Accessibility (Hruthik).
//
// Self-contained TTS transport + rate + voice controls. Takes a TtsSession (from
// useTtsSession) as a prop rather than a ReaderTextProvider, so this component has no idea a
// book or a WebView exists — it only knows how to drive the session it's handed.
//
// NOT MOUNTED ANYWHERE YET. Wiring this into ReaderScreen.tsx's toolbar/controls (the
// `showToc`/`showSearch` mutual-exclusion pattern at ReaderScreen.tsx:138-139 is the template a
// `showTts` toggle would follow) is Reader's (Ahana's) call, not this file's.

import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TtsSession } from './useTtsSession';
import { RATE_LADDER } from './ttsRate';
import { VoicePicker } from './VoicePicker';

export interface TtsControlsProps {
  session: TtsSession;
}

const PAUSE_RESUME_SUPPORTED = Platform.OS === 'ios';

export function TtsControls({ session }: TtsControlsProps): React.JSX.Element {
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);

  const isSpeaking = session.status === 'speaking';
  const isPaused = session.status === 'paused';

  const transportLabel = isSpeaking
    ? PAUSE_RESUME_SUPPORTED
      ? 'Pause'
      : 'Stop'
    : isPaused
      ? 'Resume'
      : 'Play';

  const handleTransportPress = (): void => {
    if (isSpeaking) {
      // Android has no working pause — see the platform note on TtsSessionStatus. Stopping is
      // the honest equivalent rather than a button that visibly does nothing.
      if (PAUSE_RESUME_SUPPORTED) {
        session.pause();
      } else {
        session.stop();
      }
      return;
    }
    session.play();
  };

  return (
    <View style={styles.container}>
      {session.status === 'error' && session.errorMessage !== null && (
        <Text style={styles.error}>{session.errorMessage}</Text>
      )}

      <View style={styles.transportRow}>
        <Pressable
          accessibilityRole="button"
          onPress={handleTransportPress}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{transportLabel}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={session.status === 'idle'}
          onPress={session.stop}
          style={[styles.button, session.status === 'idle' && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            session.reloadVoices();
            setVoicePickerOpen(true);
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Voice</Text>
        </Pressable>
      </View>

      <Text style={styles.rateLabel}>Speed</Text>
      <View style={styles.rateRow}>
        {RATE_LADDER.map((rate) => {
          const selected = session.prefs.rate === rate;
          return (
            <Pressable
              accessibilityRole="button"
              key={rate}
              onPress={() => session.setRate(rate)}
              style={[styles.rateChip, selected && styles.rateChipSelected]}
            >
              <Text style={[styles.rateChipText, selected && styles.rateChipTextSelected]}>
                {rate}x
              </Text>
            </Pressable>
          );
        })}
      </View>

      <VoicePicker
        onClose={() => setVoicePickerOpen(false)}
        onSelect={(voiceId) => {
          session.setVoice(voiceId);
          setVoicePickerOpen(false);
        }}
        selectedVoiceId={session.prefs.voiceId}
        visible={voicePickerOpen}
        voices={session.voices}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: '#e2e2e2',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { fontSize: 13, color: '#8a1c1c', marginBottom: 8 },
  transportRow: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111111' },
  rateLabel: { fontSize: 12, color: '#777777', marginTop: 10, marginBottom: 4 },
  rateRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  rateChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f2f2f2',
  },
  rateChipSelected: { backgroundColor: '#111111' },
  rateChipText: { fontSize: 13, color: '#111111', fontWeight: '600' },
  rateChipTextSelected: { color: '#ffffff' },
});
