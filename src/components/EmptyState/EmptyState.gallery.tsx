// Gallery entry — every variant of EmptyState from hardcoded props.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import EmptyState from './EmptyState';

export default function EmptyStateGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>EmptyState</Text>

      <Text style={styles.label}>no_query_results</Text>
      <EmptyState variant="no_query_results" />

      <Text style={styles.label}>no_query_results — query echoed back</Text>
      <EmptyState variant="no_query_results" query="crispr" />

      <Text style={styles.label}>no_query_results — long query</Text>
      <EmptyState
        variant="no_query_results"
        query="renewable energy integration in smart grids across developing economies"
      />

      <Text style={styles.label}>no_filter_results — offers Clear filters</Text>
      <EmptyState variant="no_filter_results" onClearFilters={() => {}} />

      <Text style={styles.label}>no_content</Text>
      <EmptyState variant="no_content" />

      <Text style={styles.label}>browse_instead — offers Browse the catalogue</Text>
      <EmptyState variant="browse_instead" onBrowse={() => {}} />

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
  spacer: { height: space.xl },
});
