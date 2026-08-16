// Owner: Reader (Ahana).
//
// The in-book search panel: query box and results list. Presentational only — it does
// no querying and knows no bookId. Everything it does is a prop call, which is what
// lets ReaderScreen own navigation and this file own layout.
//
// AN OVERLAY, exactly like the Contents panel, and picking a result DISMISSES it.
// A previous version sat in the layout flow so it would never cover text, which sounds
// strictly better and was not: changing the viewer's height resizes the WebView, epub.js
// re-paginates on resize, and a CFI resolved under one pagination points at a different
// page under another — so every jump landed slightly off. Overlaying keeps the viewer a
// fixed size for the whole search, which is what makes a hit's CFI mean the same thing
// when it is tapped as when it was indexed.
//
// Covering the book while searching is therefore fine, because you are not reading then.
// What you read against afterwards is SearchMatchBar, which floats and also does not
// reflow. The stepper lives there rather than here for the same reason: stepping is
// something you do while looking at the page.
//
// Colours are inline for the same reason the rest of the reader's are: src/theme/ has
// not landed yet.

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { cfiOf, locatorKey } from '@/features/reader/useBookSearch';
import type { SearchStatus } from '@/features/reader/useBookSearch';
// Search's own tokenizer, so the words named in the multi-word hint below are exactly
// the ones the query ran on. Re-splitting the term here would be a second, divergent
// implementation of a rule Search owns. text.ts is pure — no Node deps — and is
// already in the bundle via queryBookIndex → queryIndex.
import { termTokens } from '@/features/search/text';
import type { SearchHit } from '@/shared/contracts';

/**
 * How many result rows are actually rendered.
 *
 * Hits are one per WORD OCCURRENCE, not one per chapter, so a common word in a real
 * book returns hundreds — and a ScrollView renders every child it is given. Capping
 * the RENDER is not capping the RESULTS: `hits` stays whole, so the stepper below
 * still walks all of them. When the cap bites, the footer says so; a silently
 * truncated list would read as "that's all there is".
 *
 * FlatList would virtualize instead, and is the upgrade if 100 proves annoying in
 * use. It is not the choice today because under jest-expo it renders only its initial
 * window of 10, which quietly removes "the last result is present" from what a test
 * can assert.
 */
const MAX_RENDERED_HITS = 100;

export interface SearchPanelProps {
  query: string;
  onQueryChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  status: SearchStatus;
  hits: readonly SearchHit[];
  submittedTerm: string;
  failure: string | null;
  activeIndex: number;
  /** Index into `hits`. The screen decides what selecting one means. */
  onSelectHit: (index: number) => void;
}

export function SearchPanel({
  query,
  onQueryChange,
  onSubmit,
  onClose,
  status,
  hits,
  submittedTerm,
  failure,
  activeIndex,
  onSelectHit,
}: SearchPanelProps): React.JSX.Element {
  const rendered = hits.slice(0, MAX_RENDERED_HITS);
  const tokens = termTokens(submittedTerm);

  return (
    <View style={styles.panel}>
      <View style={styles.inputRow}>
        <TextInput
          testID="reader-search-input"
          // A placeholder is not a reliable accessible name on Android, so the label
          // is explicit even though the field looks self-evident.
          accessibilityLabel="Search in this book"
          style={styles.input}
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={onSubmit}
          placeholder="Search in this book"
          placeholderTextColor="#8a8a8a"
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {/* Both this and the return key call onSubmit: the return key is the faster
            path but is not discoverable on every keyboard. */}
        <Pressable accessibilityRole="button" onPress={onSubmit} style={styles.action}>
          <Text style={styles.actionText}>Search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}>
          <Text style={styles.actionText}>Close</Text>
        </Pressable>
      </View>

      {/*
        ONE live region, on the line whose MEANING changes. Putting a second on the
        match counter would re-announce on every arrow press, which is the
        over-announcing failure mode that matters most in a reading app.
      */}
      <Text style={styles.status} accessibilityLiveRegion="polite">
        {statusLine(status, hits.length, submittedTerm)}
      </Text>

      {status === 'searching' && (
        <View style={styles.busyRow}>
          <ActivityIndicator />
          <Text style={styles.hint}>Searching…</Text>
        </View>
      )}

      {status === 'idle' && (
        <Text style={styles.hint}>Type a word and press Search to find it in this book.</Text>
      )}

      {/*
        A MULTI-WORD SEARCH IS NOT A PHRASE SEARCH, and without saying so the count is
        actively misleading: "chapter 9" reports 91 matches, of which 88 are the word
        "chapter" on its own. Search ANDs the tokens at CHAPTER granularity and then
        returns every posting of EVERY query word in the chapters that qualify — so
        adding a word usually makes the list longer, which is the opposite of what
        anyone typing a second word expects.

        That is Search's documented prototype semantics (queryIndex.ts:12-14), not a
        defect, and not Reader's to change. Explaining it is Reader's job.
      */}
      {status === 'done' && hits.length > 0 && tokens.length > 1 && (
        <Text style={styles.hint}>
          {`Not a phrase search: this lists every occurrence of ` +
            `${tokens.map((token) => `“${token}”`).join(' and ')} ` +
            `in chapters that contain all of them.`}
        </Text>
      )}

      {status === 'done' && hits.length === 0 && (
        // The second line names an honest reason the answer is empty. It matters more
        // than it looks: queryBookIndex returns [] both for "no matches" and for "this
        // book shipped no index", and it does not say which — so copy that asserted
        // "this word is not in the book" would sometimes be a lie.
        <Text style={styles.hint}>
          {tokens.length > 1
            ? 'Whole words only, and every word has to appear in the same chapter.'
            : 'Whole words only — “bio” will not match “biology”.'}
        </Text>
      )}

      {status === 'failed' && (
        <View style={styles.failure}>
          <Text style={styles.failureTitle}>Search is unavailable for this book.</Text>
          <Text style={styles.failureMessage}>{failure}</Text>
        </View>
      )}

      <ScrollView
        testID="reader-search-results"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        // Without this the first tap on a result only dismisses the keyboard and the
        // user has to tap twice. It is the classic bug in exactly this UI.
        keyboardShouldPersistTaps="handled"
      >
        {rendered.map((hit, index) => {
          const navigable = cfiOf(hit) !== null;
          // A run header, not a section list: chapterId is an extractor-side id, and
          // resolving it to a human chapter title would mean guessing that it shares a
          // namespace with the TOC's hrefs. Nothing states that it does.
          const startsChapter = index === 0 || hit.chapterId !== rendered[index - 1].chapterId;

          return (
            <View key={`${index}-${locatorKey(hit)}`}>
              {startsChapter && <Text style={styles.chapterCaption}>{hit.chapterId}</Text>}
              <Pressable
                accessibilityRole="button"
                disabled={!navigable}
                onPress={() => {
                  onSelectHit(index);
                }}
                style={[
                  styles.row,
                  index === activeIndex && styles.rowActive,
                  !navigable && styles.disabled,
                ]}
              >
                <Text style={styles.rowOrdinal}>{index + 1}</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowSnippet}>{hit.snippet}</Text>
                  {/* Listed rather than filtered out. Dropping it would desynchronise
                      the ordinals from "Match n of m", and an all-PDF result set would
                      render as an empty list under a "no matches" message. */}
                  {!navigable && (
                    <Text style={styles.rowUnavailable}>Not available in this reader</Text>
                  )}
                </View>
              </Pressable>
            </View>
          );
        })}

        {hits.length > MAX_RENDERED_HITS && (
          <Text style={styles.hint}>
            {`Showing the first ${MAX_RENDERED_HITS} of ${hits.length} matches. ` +
              `Add another word to narrow it down.`}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function statusLine(status: SearchStatus, count: number, term: string): string {
  if (status === 'failed') return 'Search failed.';
  if (status === 'searching') return 'Searching…';
  if (status !== 'done') return '';
  if (count === 0) return `No matches for “${term}” in this book.`;
  return `${count} ${count === 1 ? 'match' : 'matches'} for “${term}”.`;
}

const styles = StyleSheet.create({
  // Absolutely filled over `viewer`, matching the Contents panel. Explicit inset
  // rather than StyleSheet.absoluteFillObject for the same reason ReaderScreen gives:
  // RN 0.86's types export only `absoluteFill`, so the *Object form fails typecheck.
  // OPAQUE, not translucent — book text showing faintly through a results list is
  // unreadable for both.
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e2e2',
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111111',
  },
  action: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f2f2f2' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#111111' },

  status: { marginTop: 10, fontSize: 13, fontWeight: '600', color: '#111111' },
  hint: { marginTop: 6, fontSize: 13, color: '#777777' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },

  failure: {
    marginTop: 8,
    backgroundColor: '#fdf2f2',
    borderWidth: 1,
    borderColor: '#f0c8c8',
    borderRadius: 8,
    padding: 10,
  },
  failureTitle: { fontSize: 13, fontWeight: '700', color: '#8a1c1c' },
  failureMessage: { marginTop: 4, fontSize: 12, color: '#8a1c1c' },

  disabled: { opacity: 0.4 },

  // No `flex: 1`, for the reason measured on the Contents list (see the long note in
  // ReaderScreen.tsx): ScrollView carries flexGrow/flexShrink: 1 in its own base
  // style, so inside an absolutely-filled panel it is already bounded. Adding it here
  // is a no-op that only looks like it is doing something.
  list: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e2e2' },
  listContent: { paddingBottom: 48 },

  chapterCaption: {
    marginTop: 10,
    marginBottom: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowActive: { backgroundColor: '#f2f2f2' },
  rowOrdinal: { fontSize: 12, color: '#8a8a8a', minWidth: 22 },
  rowBody: { flex: 1 },
  rowSnippet: { fontSize: 14, color: '#111111' },
  rowUnavailable: { marginTop: 2, fontSize: 11, color: '#8a8a8a' },
});
