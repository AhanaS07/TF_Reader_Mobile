// Gallery entry — every state of Slider from hardcoded props.
// No providers, no navigation, no stores.
//
// Slider holds no value state of its own between renders — the interactive row
// at the bottom uses a local useState purely so a reviewer can drag and confirm
// the readout only updates on release, never mid-drag.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Slider from './Slider';
import { color, space, type } from '@theme/tokens';

export default function SliderGallery() {
  const [lineHeight, setLineHeight] = useState(1.5);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Slider</Text>

      <Text style={styles.label}>line height — 1.0 to 2.0, step 0.1, at the default</Text>
      <View style={styles.row}>
        <Slider value={1.5} minimumValue={1.0} maximumValue={2.0} step={0.1} onSlidingComplete={() => {}} />
      </View>

      <Text style={styles.label}>letter spacing — 0 to 4px, step 0.5, at its minimum</Text>
      <View style={styles.row}>
        <Slider value={0} minimumValue={0} maximumValue={4} step={0.5} onSlidingComplete={() => {}} />
      </View>

      <Text style={styles.label}>page margins — 0 to 48px, step 4, at its maximum</Text>
      <View style={styles.row}>
        <Slider value={48} minimumValue={0} maximumValue={48} step={4} onSlidingComplete={() => {}} />
      </View>

      <Text style={styles.label}>
        interactive — drag and release. The readout below only updates on release, never mid-drag.
      </Text>
      <View style={styles.row}>
        <Slider
          value={lineHeight}
          minimumValue={1.0}
          maximumValue={2.0}
          step={0.1}
          onSlidingComplete={setLineHeight}
        />
      </View>
      <Text style={styles.readout}>value: {lineHeight}</Text>

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
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  // The screen owns where the control sits — Slider sets no outer margin.
  row: { marginHorizontal: space.md },
  readout: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textPrimary,
    marginHorizontal: space.md,
    marginTop: space.xs,
  },
  spacer: { height: space.xl },
});
