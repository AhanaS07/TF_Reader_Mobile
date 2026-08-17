// src/components/VoiceOverlay/VoiceOverlay.tsx
// The dark immersive voice-search surface (screen 11).
//
// IT DOES NOT LISTEN. No microphone, no permission prompt, no recogniser — the
// Foundation Spec is explicit that voice is "simply a second way to produce a
// query string", so the recogniser lives in the catalogue search pipeline and
// this file stays a pure view over `state` and `transcript`. That is also what
// makes it renderable in the gallery, where there is no microphone at all.
//
// TWO PROPS BEYOND THE SPEC'S CONTRACT, both driven by the design: `onSubmit`
// and `onClear` back the Search and Clear buttons in the mockup. The spec's §6.5
// prop list predates that screen and gives only `onCancel`, which would leave a
// finished transcript with nowhere to go but discard. Both are optional, so a
// caller that only wants cancel still gets exactly the spec's contract.
//
// The two buttons are local Pressables, not a shared component, and the reason
// has expired: `ActionButton` has landed (`src/components/ActionButton`). They
// are a part used by one component, which CONVENTIONS §1 puts beside it — but
// the note below was always "when ActionButton lands, these should become it
// rather than a second button vocabulary", and it has. Search and Clear are not
// in `ACTION_IDS` and should not be added to it — that union is access actions
// only — so this is a swap to `ActionButton`'s presentation, not a new action.
import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, radius, space, type } from '@theme/tokens';

// The mic disc and the ring that pulses around it. Named because CONVENTIONS §5
// bans bare numbers in a StyleSheet.
const MIC_DIAMETER = 132;
const RING_DIAMETER = 188;
const MIC_ICON_SIZE = 56;
const CLOSE_ICON_SIZE = 28;

// One breath in, one breath out. Slow enough to read as "listening" rather than
// "loading", which §2.3's spinner ban is really about.
const PULSE_MS = 1100;
const PULSE_MIN_OPACITY = 0.25;
const PULSE_MAX_SCALE = 1.18;

// ─── Props ───────────────────────────────────────────────────────────────────

export type VoiceOverlayState = 'listening' | 'transcribing' | 'error' | 'success';

// Copy per state. A map rather than a switch so adding a state is one entry and
// the compiler names every place that has to change.
const TITLE_BY_STATE: Record<VoiceOverlayState, string> = {
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  error: 'Voice search failed',
  success: 'Got it',
};

export interface VoiceOverlayProps {
  /** Whether the overlay is on screen. */
  visible: boolean;
  /** Where the recogniser has got to. */
  state: VoiceOverlayState;
  /** What has been heard so far. Grows while listening. */
  transcript?: string;
  /**
   * Why it failed — no permission, no speech heard. A plain string, never an
   * `Error`, so a stack trace cannot reach a reader (Design Spec §4.2).
   */
  errorMessage?: string;
  /** Dismissed — the × or the hardware back button. */
  onCancel: () => void;
  /** Run the transcript as a query. Absent hides the Search button. */
  onSubmit?: () => void;
  /** Discard the transcript and listen again. Absent hides the Clear button. */
  onClear?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VoiceOverlay({
  visible,
  state,
  transcript,
  errorMessage,
  onCancel,
  onSubmit,
  onClear,
}: VoiceOverlayProps) {
  // A lazy useState initialiser, not useRef: the value is READ during render (the
  // interpolations below), and `react-hooks/refs` rightly rejects that for a ref.
  // useState gives the same construct-once stability without the lint violation.
  const [pulse] = useState(() => new Animated.Value(0));
  const listening = state === 'listening';

  // The ring breathes only while actually listening. Leaving it running through
  // `transcribing` would say the mic is still open when it is not.
  useEffect(() => {
    if (!visible || !listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [visible, listening, pulse]);

  const hasTranscript = transcript !== undefined && transcript.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onCancel}
      // Android's hardware back must dismiss, not fall through to the screen
      // underneath, which is still mounted behind this.
      accessibilityViewIsModal
    >
      <View testID="voice-overlay" style={styles.backdrop}>
        <Pressable
          testID="voice-overlay-cancel"
          onPress={onCancel}
          hitSlop={space.sm}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Cancel voice search"
        >
          <Ionicons name="close" size={CLOSE_ICON_SIZE} color={color.surface} />
        </Pressable>

        <Text testID="voice-overlay-title" style={styles.title}>
          {TITLE_BY_STATE[state]}
        </Text>

        <View style={styles.micArea}>
          {/* The pulse sits BEHIND the disc and is decorative, so it is hidden
              from assistive tech — the title already says "Listening". */}
          {listening && (
            <Animated.View
              testID="voice-overlay-pulse"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.ring,
                {
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [PULSE_MIN_OPACITY, 0],
                  }),
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, PULSE_MAX_SCALE],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}

          <View style={[styles.mic, state === 'error' && styles.micError]}>
            <Ionicons name="mic" size={MIC_ICON_SIZE} color={color.surface} />
          </View>
        </View>

        {/* Transcript region. Reserved whether or not there is text yet, so the
            buttons do not jump up the screen the moment the first word lands. */}
        <View style={styles.transcriptArea}>
          {state === 'error' ? (
            <Text testID="voice-overlay-error" style={styles.error}>
              {errorMessage ?? 'No speech was heard. Try again.'}
            </Text>
          ) : (
            hasTranscript && (
              <Text testID="voice-overlay-transcript" style={styles.transcript}>
                {transcript}
              </Text>
            )
          )}
        </View>

        <View style={styles.actions}>
          {onSubmit && (
            <Pressable
              testID="voice-overlay-submit"
              onPress={onSubmit}
              // Nothing heard yet means nothing to search for. Disabled rather
              // than hidden, so the button does not appear mid-sentence.
              disabled={!hasTranscript}
              style={[styles.button, styles.primaryButton, !hasTranscript && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Search"
              accessibilityState={{ disabled: !hasTranscript }}
            >
              <Text style={styles.primaryLabel}>Search</Text>
            </Pressable>
          )}

          {onClear && (
            <Pressable
              testID="voice-overlay-clear"
              onPress={onClear}
              style={[styles.button, styles.secondaryButton]}
              accessibilityRole="button"
              accessibilityLabel="Clear"
            >
              <Text style={styles.secondaryLabel}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  close: {
    position: 'absolute',
    top: space.xl,
    right: space.lg,
    padding: space.xs,
  },
  title: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.surface,
    textAlign: 'center',
  },
  micArea: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.xl,
  },
  ring: {
    position: 'absolute',
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
    backgroundColor: color.primary,
  },
  mic: {
    width: MIC_DIAMETER,
    height: MIC_DIAMETER,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micError: {
    borderColor: color.error,
  },
  transcriptArea: {
    minHeight: space.xl * 2,
    justifyContent: 'center',
  },
  transcript: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.surface,
    textAlign: 'center',
  },
  error: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.error,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  button: {
    flex: 1,
    height: space.xl + space.md,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primaryButton: {
    backgroundColor: color.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.surface,
  },
  primaryLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.surface,
  },
  secondaryLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.surface,
  },
});
