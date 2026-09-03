// Owner: Accessibility (Hruthik).
//
// A modal list of installed TTS voices. Adapted from the day2_build spike's VoicePicker, minus
// the raw-id debug display and the "notInstalled" entries — useTtsSession already filters those
// out before they reach here (a voice Android reports but hasn't downloaded yet can't be
// selected successfully).

import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { focusOn } from '@/features/reader/a11yFocus';
import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';

import { FOCUS_RING_COLOR, FOCUS_RING_COLOR_HIGH_CONTRAST, FOCUS_RING_WIDTH, MIN_TOUCH_TARGET } from '../a11yConstants';
import type { Voice } from './ttsEngine';
import { useHighContrast } from './useHighContrast';

export interface VoicePickerProps {
  visible: boolean;
  voices: Voice[];
  selectedVoiceId: string | null;
  onSelect: (voiceId: string | null) => void;
  onClose: () => void;
}

// RN's Modal attaches its content on a native layer asynchronously, so a setAccessibilityFocus
// call fired the instant `visible` flips to true reliably no-ops on both platforms — the node
// isn't registered with the accessibility tree yet. This delay is empirical, not exact.
const FOCUS_ENTRY_DELAY_MS = 300;

export function VoicePicker({
  visible,
  voices,
  selectedVoiceId,
  onSelect,
  onClose,
}: VoicePickerProps): React.JSX.Element {
  const { osFontScale } = useAppearanceEnv();
  const highContrast = useHighContrast();
  const ringColor = highContrast ? FOCUS_RING_COLOR_HIGH_CONTRAST : FOCUS_RING_COLOR;
  const firstRowRef = useRef<View>(null);

  // One key covers the backdrop, the "Platform default" header row, and every voice row.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const focusRingHandlers = (id: string) => ({
    onFocus: () => setFocusedRowId(id),
    onBlur: () => setFocusedRowId((current) => (current === id ? null : current)),
  });

  useEffect(() => {
    if (!visible) {
      return;
    }
    // The DELAY is this file's own concern (Modal mount timing, see above); resolving the node and
    // guarding the null cases is not, and is shared with Reader's panels via `focusOn`.
    const timer = setTimeout(() => focusOn(firstRowRef), FOCUS_ENTRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose} visible={visible}>
      {/*
        accessibilityViewIsModal hides its SIBLINGS from VoiceOver, not just traps focus within
        itself (confirmed against @testing-library/react-native's own accessibility emulation,
        which mirrors real iOS behavior). It previously sat on the sheet View alone, which made
        the backdrop's "Close voice picker" Pressable — a sibling of that View — unreachable by
        VoiceOver. Moving it up to wrap both means nothing here is a sibling of the modal
        boundary, so the backdrop stays reachable.
      */}
      <View accessibilityViewIsModal style={styles.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close voice picker"
          onPress={onClose}
          style={[styles.backdrop, focusedRowId === 'backdrop' && { borderColor: ringColor }]}
          {...focusRingHandlers('backdrop')}
        />
        <View style={styles.sheet}>
          <Text style={[styles.title, { fontSize: 18 * osFontScale }]}>Voice</Text>
          <FlatList
            data={voices}
            keyExtractor={(voice) => voice.id}
            ListEmptyComponent={
              <Text style={[styles.empty, { fontSize: 14 * osFontScale }]}>
                No voices found. On Android this usually means the TTS engine isn&apos;t installed,
                or the app can&apos;t see it yet.
              </Text>
            }
            ListHeaderComponent={
              <Pressable
                ref={firstRowRef}
                accessibilityRole="button"
                accessibilityLabel="Platform default voice"
                accessibilityState={{ selected: selectedVoiceId === null }}
                onPress={() => onSelect(null)}
                style={[styles.row, focusedRowId === 'default' && { borderColor: ringColor }]}
                {...focusRingHandlers('default')}
              >
                <Text style={[styles.rowText, { fontSize: 15 * osFontScale }]}>
                  Platform default
                </Text>
                {selectedVoiceId === null && (
                  <Text style={[styles.check, { fontSize: 16 * osFontScale }]}>✓</Text>
                )}
              </Pressable>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.language}`}
                accessibilityState={{ selected: selectedVoiceId === item.id }}
                onPress={() => onSelect(item.id)}
                style={[styles.row, focusedRowId === item.id && { borderColor: ringColor }]}
                {...focusRingHandlers(item.id)}
              >
                <View>
                  <Text style={[styles.rowText, { fontSize: 15 * osFontScale }]}>{item.name}</Text>
                  <Text style={[styles.rowSubtext, { fontSize: 12 * osFontScale }]}>
                    {item.language}
                  </Text>
                </View>
                {selectedVoiceId === item.id && (
                  <Text style={[styles.check, { fontSize: 16 * osFontScale }]}>✓</Text>
                )}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: FOCUS_RING_WIDTH,
    borderColor: 'transparent',
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  title: { fontWeight: '600', color: '#111111', marginBottom: 8 },
  empty: { color: '#777777', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 12,
    borderWidth: FOCUS_RING_WIDTH,
    borderColor: 'transparent',
    // The list divider stays on the bottom edge, which RN resolves independently of the
    // all-sides `borderWidth`/`borderColor` reserved above for the focus ring.
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowText: { color: '#111111' },
  rowSubtext: { color: '#777777', marginTop: 2 },
  check: { color: '#111111', fontWeight: '700' },
});
