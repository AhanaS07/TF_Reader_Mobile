import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import Spinner from './Spinner';

export default function SpinnerGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Spinner</Text>

      <Text style={styles.label}>small — default (brand primary)</Text>
      <Spinner size="small" />

      <Text style={styles.label}>large — default (brand primary)</Text>
      <Spinner size="large" />

      <Text style={styles.label}>small — textSecondary (list/section spinners)</Text>
      <Spinner size="small" color={color.textSecondary} />

      <Text style={styles.label}>large — textSecondary (list/section spinners)</Text>
      <Spinner size="large" color={color.textSecondary} />

      <Text style={styles.label}>small — white (spinner on a filled button)</Text>
      <View style={styles.darkSwatch}>
        <Spinner size="small" color={color.white} />
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
  darkSwatch: {
    backgroundColor: color.primary,
    padding: space.md,
    alignSelf: 'flex-start',
    borderRadius: space.xs,
  },
});
