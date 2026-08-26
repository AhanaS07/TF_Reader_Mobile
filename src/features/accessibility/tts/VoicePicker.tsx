// Owner: Accessibility (Hruthik).
//
// A modal list of installed TTS voices. Adapted from the day2_build spike's VoicePicker, minus
// the raw-id debug display and the "notInstalled" entries — useTtsSession already filters those
// out before they reach here (a voice Android reports but hasn't downloaded yet can't be
// selected successfully).

import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Voice } from './ttsEngine';

export interface VoicePickerProps {
  visible: boolean;
  voices: Voice[];
  selectedVoiceId: string | null;
  onSelect: (voiceId: string | null) => void;
  onClose: () => void;
}

export function VoicePicker({
  visible,
  voices,
  selectedVoiceId,
  onSelect,
  onClose,
}: VoicePickerProps): React.JSX.Element {
  return (
    <Modal animationType="slide" transparent onRequestClose={onClose} visible={visible}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close voice picker"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View accessibilityViewIsModal style={styles.sheet}>
        <Text style={styles.title}>Voice</Text>
        <FlatList
          data={voices}
          keyExtractor={(voice) => voice.id}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No voices found. On Android this usually means the TTS engine isn&apos;t installed,
              or the app can&apos;t see it yet.
            </Text>
          }
          ListHeaderComponent={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Platform default voice"
              accessibilityState={{ selected: selectedVoiceId === null }}
              onPress={() => onSelect(null)}
              style={styles.row}
            >
              <Text style={styles.rowText}>Platform default</Text>
              {selectedVoiceId === null && <Text style={styles.check}>✓</Text>}
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.language}`}
              accessibilityState={{ selected: selectedVoiceId === item.id }}
              onPress={() => onSelect(item.id)}
              style={styles.row}
            >
              <View>
                <Text style={styles.rowText}>{item.name}</Text>
                <Text style={styles.rowSubtext}>{item.language}</Text>
              </View>
              {selectedVoiceId === item.id && <Text style={styles.check}>✓</Text>}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.3)' },
  sheet: {
    maxHeight: '70%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  title: { fontSize: 18, fontWeight: '600', color: '#111111', marginBottom: 8 },
  empty: { fontSize: 14, color: '#777777', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowText: { fontSize: 15, color: '#111111' },
  rowSubtext: { fontSize: 12, color: '#777777', marginTop: 2 },
  check: { fontSize: 16, color: '#111111', fontWeight: '700' },
});
