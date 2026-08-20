// Owner: Reader (Ahana).
//
// The find bar that stays on screen after the search panel closes: which match you
// are on, arrows to step, and a way back into the results.
//
// IT FLOATS OVER THE BOOK, and that is the whole point of the file. An earlier version
// put the results panel in the layout flow so it would not cover any text; the cost was
// that opening or closing it changed the viewer's height, which resizes the WebView,
// which makes epub.js re-paginate. A CFI resolved under one pagination is a different
// page under another, so every jump landed slightly wrong. Overlaying instead means the
// viewer NEVER changes size, epub.js never re-paginates, and a CFI means the same thing
// before and after the panel is dismissed.
//
// So the rule for anything search adds to the screen: it overlays, it does not reflow.
// A find bar floating above the page is also what every other reader does.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hasNavigableFrom } from '@/features/reader/useBookSearch';
import type { SearchHit } from '@/shared/contracts';

export interface SearchMatchBarProps {
  hits: readonly SearchHit[];
  activeIndex: number;
  submittedTerm: string;
  onStep: (delta: 1 | -1) => void;
  /** Reopen the results panel — the bar is the way back to the full list. */
  onOpenResults: () => void;
  onDismiss: () => void;
}

export function SearchMatchBar({
  hits,
  activeIndex,
  submittedTerm,
  onStep,
  onOpenResults,
  onDismiss,
}: SearchMatchBarProps): React.JSX.Element {
  const canStepBack = hasNavigableFrom(hits, activeIndex, -1);
  const canStepForward = hasNavigableFrom(hits, activeIndex, 1);

  const position =
    activeIndex >= 0
      ? `Match ${activeIndex + 1} of ${hits.length}`
      : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`;

  return (
    <View style={styles.bar} testID="reader-search-match-bar">
      {/*
        The counter IS the way back to the list, rather than a separate "Results"
        button: it is the widest target in the bar and it already names what tapping
        it shows. The accessibilityLabel spells that out because "Match 3 of 17" alone
        does not tell a screen-reader user it is actionable.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${position} for ${submittedTerm}. Show all results.`}
        onPress={onOpenResults}
        style={styles.counterButton}
      >
        <Text style={styles.counterText}>{position}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous match"
        disabled={!canStepBack}
        onPress={() => {
          onStep(-1);
        }}
        style={[styles.step, !canStepBack && styles.disabled]}
      >
        <Text style={styles.stepText}>‹</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next match"
        disabled={!canStepForward}
        onPress={() => {
          onStep(1);
        }}
        style={[styles.step, !canStepForward && styles.disabled]}
      >
        <Text style={styles.stepText}>›</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss search"
        onPress={onDismiss}
        style={styles.step}
      >
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute, anchored to the bottom of `viewer` — floating, so the book's layout is
  // untouched. Inset on all three sides so it reads as a pill over the page rather
  // than a second controls row glued to the edge, which is also what keeps it from
  // being mistaken for the Prev/Next page buttons directly below it.
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    backgroundColor: '#f7f7f7',
  },
  counterButton: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
  // Carries the word "Match" deliberately: it is what distinguishes this row's arrows
  // from the page Prev/Next buttons sitting just below it.
  counterText: { fontSize: 13, fontWeight: '600', color: '#111111' },
  step: {
    minWidth: 40,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e2e2',
  },
  stepText: { fontSize: 18, fontWeight: '600', color: '#111111' },
  dismissText: { fontSize: 15, fontWeight: '600', color: '#555555' },
  disabled: { opacity: 0.4 },
});
