// Gallery entry — every emphasis × state of PrimaryButton from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { color, space, type } from '@theme/tokens';

export default function PrimaryButtonGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>PrimaryButton</Text>

      <View style={styles.stack}>
        <Text style={styles.label}>filled — idle</Text>
        <PrimaryButton testID="gallery-filled" label="Sign in" onPress={() => {}} />

        <Text style={styles.label}>filled — with an icon</Text>
        <PrimaryButton
          testID="gallery-filled-icon"
          label="Sign in"
          icon="log-in-outline"
          onPress={() => {}}
        />

        {/* The label stays and a spinner joins it, so the button keeps its width
            and the form does not jump under the reader's thumb. */}
        <Text style={styles.label}>filled — loading (label stays, spinner joins)</Text>
        <PrimaryButton testID="gallery-filled-loading" label="Sign in" loading onPress={() => {}} />

        <Text style={styles.label}>filled — disabled</Text>
        <PrimaryButton testID="gallery-filled-disabled" label="Sign in" disabled onPress={() => {}} />

        <Text style={styles.label}>outlined — idle</Text>
        <PrimaryButton
          testID="gallery-outlined"
          label="Create an account"
          emphasis="outlined"
          icon="person-add-outline"
          onPress={() => {}}
        />

        <Text style={styles.label}>outlined — loading</Text>
        <PrimaryButton
          testID="gallery-outlined-loading"
          label="Create an account"
          emphasis="outlined"
          loading
          onPress={() => {}}
        />

        <Text style={styles.label}>outlined — disabled</Text>
        <PrimaryButton
          testID="gallery-outlined-disabled"
          label="Create an account"
          emphasis="outlined"
          disabled
          onPress={() => {}}
        />

        <Text style={styles.label}>quiet — no fill, no border</Text>
        <PrimaryButton
          testID="gallery-quiet"
          label="Sign in instead"
          emphasis="quiet"
          onPress={() => {}}
        />

        <Text style={styles.label}>quiet — disabled</Text>
        <PrimaryButton
          testID="gallery-quiet-disabled"
          label="Sign in instead"
          emphasis="quiet"
          disabled
          onPress={() => {}}
        />

        {/* `numberOfLines={1}` means a long label truncates rather than growing
            the button to two lines — worth seeing before it ships. */}
        <Text style={styles.label}>filled — a label longer than the button</Text>
        <PrimaryButton
          testID="gallery-long"
          label="Create a Taylor & Francis personal account"
          onPress={() => {}}
        />

        {/* 36 tall — FilterChip's own CHIP_HEIGHT, reused rather than a second
            invented "smaller" number. Right for a place a button stands in
            for a chip, e.g. a header prompt, not a page's main action. */}
        <Text style={styles.label}>compact — a pair spanning a row, ProfileScreen&apos;s own case</Text>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <PrimaryButton
              testID="gallery-compact-a"
              label="Sign in"
              emphasis="outlined"
              size="compact"
              onPress={() => {}}
            />
          </View>
          <View style={styles.rowItem}>
            <PrimaryButton
              testID="gallery-compact-b"
              label="Create account"
              emphasis="outlined"
              size="compact"
              onPress={() => {}}
            />
          </View>
        </View>

        <Text style={styles.label}>compact — disabled</Text>
        <PrimaryButton
          testID="gallery-compact-disabled"
          label="Sign in"
          emphasis="outlined"
          size="compact"
          disabled
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
  stack: { paddingHorizontal: space.md, gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  rowItem: { flex: 1 },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.md,
  },
  spacer: { height: space.xl },
});
