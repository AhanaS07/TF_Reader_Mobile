// Owner: Accessibility (Hruthik).
//
// Self-contained TTS transport + rate + voice controls. Takes a TtsSession (from
// useTtsSession) as a prop rather than a ReaderTextProvider, so this component has no idea a
// book or a WebView exists — it only knows how to drive the session it's handed.
//
// MOUNTED BY ReaderScreen, in place of the page-navigation row, whenever TTS is enabled for an
// EPUB. There is no toggle in front of it: the `accessibility.tts.enabled` preference is what puts
// it on screen and what takes it away. Nothing here needs to know that — it drives the session it
// is handed and is unmounted when there is no session to drive.

import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { TtsSession } from './useTtsSession';
import { PITCH_LADDER } from './ttsPitch';
import { RATE_LADDER } from './ttsRate';
import { VoicePicker } from './VoicePicker';

export interface TtsControlsProps {
  session: TtsSession;
}

const PAUSE_RESUME_SUPPORTED = Platform.OS === 'ios';

// Matches VoicePicker's own FOCUS_ENTRY_DELAY_MS rationale: the Modal's dismiss animation is
// still running for a moment after `visible` flips to false, so an immediate focus call can be
// swallowed by the outgoing native layer.
const FOCUS_RESTORE_DELAY_MS = 300;

export function TtsControls({ session }: TtsControlsProps): React.JSX.Element {
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const voiceButtonRef = useRef<View>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const closeVoicePicker = (): void => {
    setVoicePickerOpen(false);
    closeTimerRef.current = setTimeout(() => {
      const node = findNodeHandle(voiceButtonRef.current);
      if (node !== null) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }, FOCUS_RESTORE_DELAY_MS);
  };

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
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
        >
          {session.errorMessage}
        </Text>
      )}

      <View style={styles.transportRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={transportLabel}
          onPress={handleTransportPress}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{transportLabel}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          accessibilityState={{ disabled: session.status === 'idle' }}
          disabled={session.status === 'idle'}
          onPress={session.stop}
          style={[styles.button, session.status === 'idle' && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>

        <Pressable
          ref={voiceButtonRef}
          accessibilityRole="button"
          accessibilityLabel="Choose voice"
          onPress={() => {
            session.reloadVoices();
            setVoicePickerOpen(true);
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Voice</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Speed</Text>
      <View style={styles.chipRow} testID="tts-speed-row">
        {RATE_LADDER.map((rate) => {
          const selected = session.prefs.rate === rate;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${rate}x speed`}
              accessibilityState={{ selected }}
              key={rate}
              onPress={() => session.setRate(rate)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{rate}x</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Pitch</Text>
      <View style={styles.chipRow} testID="tts-pitch-row">
        {PITCH_LADDER.map((pitch) => {
          const selected = session.prefs.pitch === pitch;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pitch}x pitch`}
              accessibilityState={{ selected }}
              key={pitch}
              onPress={() => session.setPitch(pitch)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{pitch}x</Text>
            </Pressable>
          );
        })}
      </View>

      <VoicePicker
        onClose={closeVoicePicker}
        onSelect={(voiceId) => {
          session.setVoice(voiceId);
          closeVoicePicker();
        }}
        selectedVoiceId={session.prefs.voiceId}
        visible={voicePickerOpen}
        voices={session.voices}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // CENTRED AND WIDTH-CAPPED, not stretched. This panel replaces the page-navigation row rather
  // than sitting beside it (see ReaderScreen's `ttsControlsVisible`), so it owns the full width of
  // the screen — and a row of transport buttons stretched across a tablet puts Play and Voice a
  // hand's width apart. `maxWidth` holds the cluster at a reachable size, `alignSelf` centres what
  // is left over, and `width: '100%'` keeps it edge to edge on a phone, where there is no excess.
  container: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e2e2',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { fontSize: 13, color: '#8a1c1c', marginBottom: 8, textAlign: 'center' },
  // `flex: 1` children already divide the row, so `justifyContent` only matters if one ever stops
  // flexing — cheap insurance against a future fourth button that sizes to its content.
  transportRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  button: {
    flex: 1,
    // A floor, not a width: three buttons at `flex: 1` divide a 320pt screen into ~93pt each,
    // which fits "Resume". This stops a narrower window (split view, a small Android phone) from
    // shrinking them past a tappable target instead of wrapping the text.
    minWidth: 72,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111111' },
  sectionLabel: {
    fontSize: 12,
    color: '#777777',
    marginTop: 10,
    marginBottom: 4,
    textAlign: 'center',
  },
  // Seven rate chips and six pitch ones. They WRAP rather than shrink — a chip is sized by its
  // label, so the alternative to wrapping is clipping "0.75x". Centred so a wrapped final row
  // sits under the middle of the one above it rather than hanging off the left edge.
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f2f2f2',
  },
  chipSelected: { backgroundColor: '#111111' },
  chipText: { fontSize: 13, color: '#111111', fontWeight: '600' },
  chipTextSelected: { color: '#ffffff' },
});
