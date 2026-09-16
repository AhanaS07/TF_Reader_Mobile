import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import Loader from './Loader';

export default function LoaderGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Loader</Text>

      <Text style={styles.label}>no title — phrase carries the message</Text>
      <View style={styles.frame}>
        <Loader />
      </View>

      <Text style={styles.label}>with title — e.g. a book opening</Text>
      <View style={styles.frame}>
        <Loader title="Loading The Origin of Species…" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    marginBottom: space.sm,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // Fixed-height frames rather than a full-flex Loader, so both entries are
  // visible at once instead of one eating the whole scroll area.
  frame: { height: 260, borderWidth: StyleSheet.hairlineWidth, borderColor: color.border },
});
