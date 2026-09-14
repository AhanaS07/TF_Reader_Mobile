// Owner: Reader (Ahana).
//
// SLEEP TIMER MODAL. Bottom-sheet modal, visually matching AudioQueueModal.tsx exactly
// (animationType="slide", transparent, the same modalOverlay/modalContainer pair, SafeAreaView,
// header row with title + ✕ close button) — copied rather than invented, per
// SLEEP_TIMER_PLAN.md §6: this app has no shared theme module to pull from.

import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    minHeight: '40%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 18,
    color: '#374151',
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
    color: '#777777',
    alignSelf: 'flex-start',
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  // Same rateButton/rateButtonActive shape as AudioPlayerScreen.tsx's PLAYBACK_RATES pill row.
  presetButton: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cccccc',
    alignItems: 'center',
  },
  presetButtonActive: { backgroundColor: '#111111', borderColor: '#111111' },
  presetButtonLabel: { fontSize: 14, fontWeight: '600', color: '#111111' },
  presetButtonLabelActive: { color: '#ffffff' },
  customPickerContainer: {
    alignSelf: 'stretch',
    gap: 10,
  },
  customPickerLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
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
    backgroundColor: '#e2e2e2',
  },
  dragTrackFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111111',
  },
  dragStopDot: {
    position: 'absolute',
    top: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#cccccc',
  },
  dragStopDotActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  startButton: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: '#111111',
    alignItems: 'center',
  },
  startButtonDisabled: {
    backgroundColor: '#f0f0f0',
  },
  startButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  startButtonLabelDisabled: {
    color: '#9ca3af',
  },
  countdownLabel: {
    fontSize: 40,
    fontWeight: '700',
    color: '#111111',
  },
  countdownSubLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  firedLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
    textAlign: 'center',
  },
  actionButton: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  actionButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#b91c1c',
  },
});
