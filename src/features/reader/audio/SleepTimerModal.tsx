// Owner: Reader (Ahana).
//
// SLEEP TIMER MODAL. Bottom-sheet modal, visually matching AudioQueueModal.tsx exactly
// (animationType="slide", transparent, the same modalOverlay/modalContainer pair, SafeAreaView,
// header row with title + ✕ close button) — copied rather than invented, per
// SLEEP_TIMER_PLAN.md §6.

import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, radius, space } from '@theme/tokens';

import { cancelSleepTimer, startSleepTimer } from './sleepTimerEngine';
import { useSleepTimerStore } from './sleepTimerStore';

export interface SleepTimerModalProps {
  visible: boolean;
  onClose: () => void;
}

const PRESETS: readonly { label: string; seconds: number }[] = [
  { label: '30 sec', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '5 min', seconds: 300 },
];

/** Whole minutes only, 1–5 (SLEEP_TIMER_PLAN.md §1) — five discrete stops on the drag control. */
const CUSTOM_MINUTE_STOPS = [1, 2, 3, 4, 5] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A tap/drag control snapped to 5 discrete stops — the same onTouchStart/onTouchMove +
 * locationX/trackWidth pattern as AudioPlayerScreen.tsx's Scrubber (see that component's own
 * comment for why: PanResponder trips this repo's react-hooks/refs lint rule, and there is no
 * slider library dependency to reach for instead). Rounds to the NEAREST stop rather than
 * computing a continuous fraction, unlike Scrubber's continuous seek.
 */
function CustomMinutePicker({
  selectedMinutes,
  onSelect,
}: {
  selectedMinutes: number | null;
  onSelect: (minutes: number) => void;
}): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);

  const pickFromLocationX = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0) return;
      const fraction = clamp(locationX / trackWidth, 0, 1);
      const stopCount = CUSTOM_MINUTE_STOPS.length;
      const index = clamp(Math.round(fraction * (stopCount - 1)), 0, stopCount - 1);
      onSelect(CUSTOM_MINUTE_STOPS[index]);
    },
    [trackWidth, onSelect],
  );

  const activeIndex = selectedMinutes !== null ? CUSTOM_MINUTE_STOPS.indexOf(selectedMinutes as (typeof CUSTOM_MINUTE_STOPS)[number]) : -1;
  const fraction = activeIndex >= 0 ? activeIndex / (CUSTOM_MINUTE_STOPS.length - 1) : 0;

  return (
    <View style={styles.customPickerContainer}>
      <Text style={styles.customPickerLabel}>
        {selectedMinutes !== null ? `${selectedMinutes} min` : 'Drag to choose 1–5 min'}
      </Text>
      <View
        style={styles.dragTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onTouchStart={(event) => pickFromLocationX(event.nativeEvent.locationX)}
        onTouchMove={(event) => pickFromLocationX(event.nativeEvent.locationX)}
      >
        <View style={styles.dragTrackBackground} />
        <View style={[styles.dragTrackFill, { width: `${fraction * 100}%` }]} />
        {CUSTOM_MINUTE_STOPS.map((stop, index) => (
          <View
            key={stop}
            style={[
              styles.dragStopDot,
              { left: `${(index / (CUSTOM_MINUTE_STOPS.length - 1)) * 100}%` },
              selectedMinutes === stop && styles.dragStopDotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function SleepTimerModal({ visible, onClose }: SleepTimerModalProps): React.JSX.Element {
  const phase = useSleepTimerStore((s) => s.phase);
  const remainingSeconds = useSleepTimerStore((s) => s.remainingSeconds);
  const [selectedSeconds, setSelectedSeconds] = useState<number | null>(null);

  const selectedMinutes =
    selectedSeconds !== null && selectedSeconds % 60 === 0 ? selectedSeconds / 60 : null;

  const handleStart = useCallback(() => {
    if (selectedSeconds === null) return;
    startSleepTimer(selectedSeconds);
    setSelectedSeconds(null);
  }, [selectedSeconds]);

  // "Dismiss" on the fired state and "Cancel Timer" on the running state both route through the
  // same cancelSleepTimer() — a fired timer has no live setTimeout/setInterval left to clear, but
  // this is still the one function that resets the store to 'idle' and clears any leftover
  // notification, so there's no separate "dismiss" path to keep in sync with it.
  const handleReset = useCallback(() => {
    cancelSleepTimer();
  }, []);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Sleep Timer</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close sleep timer"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {phase === 'running' ? (
              <>
                <Text style={styles.countdownLabel}>{formatCountdown(remainingSeconds)}</Text>
                <Text style={styles.countdownSubLabel}>remaining</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel sleep timer"
                  onPress={handleReset}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonLabel}>Cancel Timer</Text>
                </Pressable>
              </>
            ) : phase === 'fired' ? (
              <>
                <Text style={styles.firedLabel}>Timer ended — audio paused</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                  onPress={handleReset}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonLabel}>Dismiss</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.presetRow}>
                  {PRESETS.map((preset) => (
                    <Pressable
                      key={preset.seconds}
                      accessibilityRole="button"
                      accessibilityLabel={`${preset.label} sleep timer`}
                      accessibilityState={{ selected: selectedSeconds === preset.seconds }}
                      onPress={() => setSelectedSeconds(preset.seconds)}
                      style={[
                        styles.presetButton,
                        selectedSeconds === preset.seconds && styles.presetButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetButtonLabel,
                          selectedSeconds === preset.seconds && styles.presetButtonLabelActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.sectionLabel}>Custom</Text>
                <CustomMinutePicker
                  selectedMinutes={selectedMinutes}
                  onSelect={(minutes) => setSelectedSeconds(minutes * 60)}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start sleep timer"
                  disabled={selectedSeconds === null}
                  onPress={handleStart}
                  style={[
                    styles.startButton,
                    selectedSeconds === null && styles.startButtonDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.startButtonLabel,
                      selectedSeconds === null && styles.startButtonLabelDisabled,
                    ]}
                  >
                    Start
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Copied from AudioQueueModal.tsx's own styles of the same names — see this file's header.
  modalOverlay: {
    flex: 1,
    // Indigo (`color.navy`), the brand's own "dark overlays" colour.
    backgroundColor: 'rgba(0, 34, 68, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '80%',
    minHeight: '40%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: color.textPrimary,
  },
  closeButton: {
    padding: space.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 18,
    color: color.textPrimary,
    fontWeight: '700',
  },
  body: {
    padding: 20,
    gap: 20,
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: color.textSecondary,
    alignSelf: 'flex-start',
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
  },
  // Same rateButton/rateButtonActive shape as AudioPlayerScreen.tsx's PLAYBACK_RATES pill row.
  presetButton: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
  },
  presetButtonActive: { backgroundColor: color.primary, borderColor: color.primary },
  presetButtonLabel: { fontSize: 14, fontWeight: '700', color: color.textPrimary },
  presetButtonLabelActive: { color: color.white },
  customPickerContainer: {
    alignSelf: 'stretch',
    gap: 10,
  },
  customPickerLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: color.textPrimary,
    textAlign: 'center',
  },
  dragTrack: {
    height: 32,
    justifyContent: 'center',
  },
  dragTrackBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
  },
  // The accent, not body text — same `color.primary` as AudioPlayerScreen's own scrubberFill.
  dragTrackFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: color.primary,
  },
  dragStopDot: {
    position: 'absolute',
    top: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  dragStopDotActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  startButton: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: color.primary,
    alignItems: 'center',
  },
  startButtonDisabled: {
    backgroundColor: color.surface,
  },
  startButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: color.white,
  },
  startButtonLabelDisabled: {
    color: color.textSecondary,
  },
  countdownLabel: {
    fontSize: 40,
    fontWeight: '700',
    color: color.textPrimary,
  },
  countdownSubLabel: {
    fontSize: 13,
    color: color.textSecondary,
  },
  firedLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: color.textPrimary,
    textAlign: 'center',
  },
  actionButton: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: radius.card,
    backgroundColor: color.errorTint,
  },
  actionButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: color.error,
  },
});
