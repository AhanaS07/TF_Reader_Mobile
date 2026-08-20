import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '@theme/tokens';

export type EmptyStateVariant =
  | 'no_query_results'
  | 'no_filter_results'
  | 'no_content'
  | 'browse_instead'
  | 'offline_no_results';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Echoed back in the no_query_results copy. */
  query?: string;
  /** Rendered only for no_filter_results. */
  onClearFilters?: () => void;
  /** browse_instead only — the screen follows the feed's own navigation entry. */
  onBrowse?: () => void;
}

const MESSAGES: Record<EmptyStateVariant, string> = {
  no_query_results: 'No articles or books match your search.',
  no_filter_results: 'Try adjusting your filters.',
  no_content: 'Nothing to show here yet.',
  browse_instead: 'No results for this search.',
  offline_no_results: 'No matches in your offline list — connect to search the full directory.',
};

export default function EmptyState({
  variant,
  query,
  onClearFilters,
  onBrowse,
}: EmptyStateProps) {
  const message =
    variant === 'no_query_results' && query
      ? `No articles or books match “${query}”.`
      : MESSAGES[variant];

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>

      {variant === 'no_filter_results' && (
        <Pressable
          onPress={onClearFilters}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
        >
          <Text style={styles.actionLabel}>Clear filters</Text>
        </Pressable>
      )}

      {/* The screen owns the href the feed supplied; this only reports the press. */}
      {variant === 'browse_instead' && (
        <Pressable
          onPress={onBrowse}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Browse the catalogue"
        >
          <Text style={styles.actionLabel}>Browse the catalogue</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  message: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
  },
  actionLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
