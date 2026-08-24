// Gallery entry — every state of SubjectChip from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
//
// `selected` is a prop, not internal state, so nothing here toggles: each row
// shows one fixed combination.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import SubjectChip from './SubjectChip';
import { color, space, type } from '@theme/tokens';

export default function SubjectChipGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>SubjectChip</Text>

      <Text style={styles.label}>default — outlined teal, not filled</Text>
      <View style={styles.chips}>
        <SubjectChip label="Public Policy" onPress={() => {}} />
        <SubjectChip label="Anthropology" onPress={() => {}} />
      </View>

      <Text style={styles.label}>selected — filled teal, light label</Text>
      <View style={styles.chips}>
        <SubjectChip label="Public Policy" selected onPress={() => {}} />
      </View>

      <Text style={styles.label}>disabled — grey, not dimmed teal</Text>
      <View style={styles.chips}>
        <SubjectChip label="Public Policy" disabled onPress={() => {}} />
      </View>

      <Text style={styles.label}>disabled + selected — disabled wins, stays grey</Text>
      <View style={styles.chips}>
        <SubjectChip label="Public Policy" selected disabled onPress={() => {}} />
      </View>

      <Text style={styles.label}>a realistic row — one subject active, the rest not</Text>
      <View style={styles.chips}>
        <SubjectChip label="All" selected onPress={() => {}} />
        <SubjectChip label="Public Policy" onPress={() => {}} />
        <SubjectChip label="Anthropology" onPress={() => {}} />
        <SubjectChip label="Economics" onPress={() => {}} />
        <SubjectChip label="Law" onPress={() => {}} />
      </View>

      <Text style={styles.label}>short and long together — chips hug their labels</Text>
      <View style={styles.chips}>
        <SubjectChip label="Law" onPress={() => {}} />
        <SubjectChip label="Environmental Science" onPress={() => {}} />
        <SubjectChip label="Art" onPress={() => {}} />
      </View>

      <Text style={styles.label}>overflow — a long subject truncates, never wraps</Text>
      <View style={styles.narrow}>
        <SubjectChip
          label="Environmental Science and Sustainable Development"
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>overflow while selected</Text>
      <View style={styles.narrow}>
        <SubjectChip
          label="Environmental Science and Sustainable Development"
          selected
          onPress={() => {}}
        />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  // The row owns the gaps between chips — the chip sets no outer margin.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginHorizontal: space.md,
  },
  // Squeezes the chip so truncation actually happens.
  narrow: {
    width: space.xl * 5,
    marginHorizontal: space.md,
  },
  spacer: { height: space.xl },
});
