// The Search tab. Today it mounts the search field and nothing else — matching,
// tokenising and ranking (B1) are Days 4–5, and the results list arrives with
// them. The empty region below the field is deliberate: it is where results will
// render, not a layout still waiting to be designed.
//
// THE SCREEN OWNS THE QUERY, NOT THE FIELD. CONVENTIONS §3 — a component is
// handed data and reports events; the screen holds the state and passes it down.
// When the search pipeline lands it takes this `useState` over and SearchInput
// does not change at all. That is what being controlled buys.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SearchInput } from '@components/SearchInput';
import { color, space, type } from '@theme/tokens';

export default function SearchScreen() {
  const [query, setQuery] = useState('');

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <SearchInput
          value={query}
          placeholder="Search books, journals and articles"
          onChangeText={setQuery}
          onSubmit={() => {}}
          onClear={() => {}}
          // This is screen 09 — CATALOGUE search — so the mic belongs here.
          // Screen 06, institution search, passes nothing and gets no mic; that
          // absence is the whole mechanism (Foundation Spec §6.5).
          // The press opens VoiceOverlay, which is B11 and does not exist until
          // Day 3, so it is inert for now rather than absent: the icon is part
          // of the field's layout and finding out on Day 3 that it does not fit
          // is worse than a button that waits.
          onVoicePress={() => {}}
        />
      </View>

      {/* Placeholder for the results region, replaced by the pipeline's list in
          B1. Not an EmptyState — nothing has been searched yet, and "no results"
          and "no search" are different things (CONVENTIONS §6). */}
      <View style={styles.results}>
        <Text style={styles.hint}>
          {query.length > 0
            ? `Searching is not wired up yet — "${query}"`
            : 'Results will appear here'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surface,
  },
  // SearchInput sets no outer margin of its own (CONVENTIONS §8), so the screen
  // laying it out provides the gutter.
  field: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  results: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  hint: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
});
