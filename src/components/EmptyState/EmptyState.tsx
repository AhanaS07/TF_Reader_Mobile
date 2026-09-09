import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '@theme/tokens';

export type EmptyStateVariant =
  | 'no_query_results'
  | 'no_filter_results'
  | 'no_content'
  // NO CALLER, AND THAT IS A CONTRACT FACT RATHER THAN AN OVERSIGHT — recorded
  // here because CONVENTIONS §10 forbids a variant without one, so the absence
  // needs an answer.
  //
  // This is the generic "we have no suggestions, here is the catalogue" fallback
  // for a zero-result search. It cannot be reached: A8–A9 state that "zero
  // results is a navigation feed, not an empty array", and the feed schema makes
  // `navigation` `minItems: 1`, always carrying *All titles* — so a zero-result
  // response always arrives with real browse targets. SearchScreen renders those
  // targets as CategoryCards beside `no_query_results`/`no_filter_results`,
  // which is the richer answer and the one screen 17 actually shows.
  //
  // Left in place rather than deleted: the day a feed does arrive with no
  // navigation entries, this is the branch that catches it, and the docs' own
  // rule for that case is "do not build an empty state for it" — meaning the
  // fallback should exist but never be wired speculatively.
  | 'browse_instead'
  | 'offline_no_results';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Echoed back in the no_query_results copy. */
  query?: string;
  /** Rendered only for no_filter_results. */
  onClearFilters?: () => void;
  /**
   * Rendered only for no_query_results — screen 17's "Clear search".
   *
   * OPTIONAL, AND ABSENT MEANS NO AFFORDANCE. A surface with nothing to clear
   * back to should not draw a dead link, so the variant alone does not earn the
   * button: the caller has to supply somewhere for it to go. That is the same
   * both-or-neither rule SectionHeader already applies to its own action.
   */
  onClearSearch?: () => void;
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
  onClearSearch,
  onBrowse,
}: EmptyStateProps) {
  const message =
    variant === 'no_query_results' && query
      ? `No articles or books match “${query}”.`
      : MESSAGES[variant];

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>

      {/* Screen 17's left panel pairs the "no results" message with a way out of
          the query that produced it. Gated on the handler as well as the variant
          — see the prop's own note. */}
      {variant === 'no_query_results' && onClearSearch !== undefined && (
        <Pressable
          onPress={onClearSearch}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text style={styles.actionLabel}>Clear search</Text>
        </Pressable>
      )}

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
    fontFamily: type.body.fontFamily,
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
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
