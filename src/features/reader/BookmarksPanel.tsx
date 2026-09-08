// Owner: Reader (Ahana).
//
// The bookmarks panel: list, tap-to-navigate, tap-to-delete, tap-to-rename, and an
// add-current-position button. Presentational only, same split as SearchPanel — it does no storage
// and knows no bookId. Everything it does is a prop call, which is what lets ReaderScreen own the
// writes (via readerBookmarks.ts, Personalization's) and this file own layout.
//
// NO NEW BRIDGE COMMAND HERE. A bookmark does not paint — it is a place to jump to — and the jump is
// the existing `goTo` command every TOC entry and search hit already uses. See
// READER_BOOKMARKS_WIRING.md for the full writes/applies split.
//
// AN OVERLAY, matching Contents and Search, for the same reason those are: resizing the viewer
// re-paginates epub.js, and a CFI resolved under one pagination points at a different page under
// another. Overlaying keeps the viewer a fixed size for the whole time this panel is open.
//
// Colours are inline for the same reason the rest of the reader's are: src/theme/ has not landed yet.

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ReaderBookmark } from '@/features/personalization/readerBookmarks';

export interface BookmarksPanelProps {
  bookmarks: readonly ReaderBookmark[];
  /**
   * Whether the initial `loadBookmarks()` has resolved at least once. Distinguishes "still reading
   * from storage" from "read storage and there is nothing there" — the same distinction Search's
   * `status` makes, collapsed to one boolean because there is no failure state worth its own copy:
   * `loadBookmarks()` surfaces unparsable rows as `skippedBookmarkCount`, not as a rejection.
   */
  loaded: boolean;
  /** Rows `toReaderBookmarks` set aside as corrupt rather than dropping silently. */
  skippedBookmarkCount: number;
  onSelect: (bookmark: ReaderBookmark) => void;
  onDelete: (id: string) => void;
  /**
   * Edit an EXISTING bookmark's name. Takes the id, matching `onDelete` beside it — the rename is an
   * update in place, so nothing about the bookmark except its name is needed to perform it.
   *
   * `name: undefined` for a field cleared back to blank, same convention as `onAddCurrent`: the row
   * falls back to `labelFor`'s own default (chapter id, then "Bookmark"/"Page N") rather than
   * displaying an empty label. ReaderScreen forwards that as the empty string the store's `name`
   * column takes, which `labelFor` reads as absent — see `submitBookmarkRename` there.
   */
  onRename: (id: string, name?: string) => void;
  /**
   * `name` is exactly what `addCurrentEpubBookmark`/`addCurrentPdfBookmark` accept — `undefined` for
   * a blank field, so an untouched input falls through to `labelFor`'s own fallback (chapter id, or
   * "Bookmark"/"Page N") rather than this panel inventing a second empty-label convention.
   */
  onAddCurrent: (name?: string) => void;
  /**
   * Whether the current reading position can be bookmarked right now. False before the first
   * `relocated` (EPUB's `cfi` starts `null` until epub.js resolves a location) and while the WebView
   * has not reported `ready` yet — the same two guards `submitPageJump` already applies to its own
   * `send`.
   */
  canAddCurrent: boolean;
  onClose: () => void;
}

export function BookmarksPanel({
  bookmarks,
  loaded,
  skippedBookmarkCount,
  onSelect,
  onDelete,
  onRename,
  onAddCurrent,
  canAddCurrent,
  onClose,
}: BookmarksPanelProps): React.JSX.Element {
  // Local, not lifted to ReaderScreen: this text means nothing outside the moment of pressing "Add" —
  // unlike the search query or the page-jump field, nothing else in the reader reads it, and it is
  // cleared the instant it is used. `useBookSearch`'s query lives in a hook because Search needs it
  // across re-opens of its own panel; a bookmark's label does not outlive the add it names.
  const [label, setLabel] = useState('');

  const submitAdd = (): void => {
    const trimmed = label.trim();
    onAddCurrent(trimmed === '' ? undefined : trimmed);
    setLabel('');
  };

  /**
   * At most ONE row edits at a time — same reasoning as `pageJump`'s single field in ReaderScreen:
   * there is one keyboard, so there is never a real case for two rows editing together. `editingText`
   * is separate from `bookmarks[].label` so typing does not need a round trip through `onRename` on
   * every keystroke — only Save commits it.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const startEdit = (bookmark: ReaderBookmark): void => {
    setEditingId(bookmark.id);
    setEditingText(bookmark.label);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
  };

  const saveEdit = (bookmark: ReaderBookmark): void => {
    const trimmed = editingText.trim();
    onRename(bookmark.id, trimmed === '' ? undefined : trimmed);
    setEditingId(null);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Bookmarks</Text>
        {/* Named for the same reason SearchPanel's is — see the note there. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close bookmarks"
          onPress={onClose}
          style={styles.action}
        >
          <Text style={styles.actionText}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.addRow}>
        <TextInput
          testID="reader-bookmark-label-input"
          accessibilityLabel="Bookmark label"
          style={styles.addInput}
          value={label}
          onChangeText={setLabel}
          onSubmitEditing={submitAdd}
          placeholder="Name this bookmark (optional)"
          placeholderTextColor="#8a8a8a"
          returnKeyType="done"
          editable={canAddCurrent}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bookmark this page"
          disabled={!canAddCurrent}
          onPress={submitAdd}
          style={[styles.addButton, !canAddCurrent && styles.disabled]}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </Pressable>
      </View>

      {/*
        Same "wrapper carries flex: 1, ScrollView does not" split as SearchPanel and the Contents
        list — a plain View defaults to flexShrink: 0 and would otherwise grow to its content height,
        clipping everything past the first screenful rather than scrolling it.
      */}
      <View style={styles.listWrap}>
        {!loaded ? (
          <View style={styles.busyRow}>
            <ActivityIndicator />
            <Text style={styles.hint}>Loading bookmarks…</Text>
          </View>
        ) : bookmarks.length === 0 ? (
          <Text style={styles.hint}>No bookmarks yet. Add one from the button above.</Text>
        ) : (
          <ScrollView
            testID="reader-bookmarks-list"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator
          >
            {bookmarks.map((bookmark) =>
              editingId === bookmark.id ? (
                <View key={bookmark.id} style={styles.row}>
                  <TextInput
                    testID={`reader-bookmark-edit-input-${bookmark.id}`}
                    accessibilityLabel={`Edit bookmark name: ${bookmark.label}`}
                    style={styles.editInput}
                    value={editingText}
                    onChangeText={setEditingText}
                    onSubmitEditing={() => {
                      saveEdit(bookmark);
                    }}
                    returnKeyType="done"
                    autoFocus
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Save bookmark name: ${bookmark.label}`}
                    onPress={() => {
                      saveEdit(bookmark);
                    }}
                    style={styles.editAction}
                  >
                    <Text style={styles.editActionText}>Save</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={cancelEdit}
                    style={styles.editAction}
                  >
                    <Text style={styles.editActionText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <View key={bookmark.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onSelect(bookmark);
                    }}
                    style={styles.rowBody}
                  >
                    <Text style={styles.rowLabel}>{bookmark.label}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit bookmark: ${bookmark.label}`}
                    onPress={() => {
                      startEdit(bookmark);
                    }}
                    style={styles.editButton}
                  >
                    <Text style={styles.editButtonText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete bookmark: ${bookmark.label}`}
                    onPress={() => {
                      onDelete(bookmark.id);
                    }}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </Pressable>
                </View>
              ),
            )}
          </ScrollView>
        )}
      </View>

      {/* Set aside, not dropped — same reasoning as the TOC's own hardeners: a stored bookmark this
          panel could not resolve is worth surfacing rather than silently shrinking the list by one. */}
      {loaded && skippedBookmarkCount > 0 && (
        <Text style={styles.hint}>
          {skippedBookmarkCount === 1
            ? '1 bookmark could not be read and was left out.'
            : `${skippedBookmarkCount} bookmarks could not be read and were left out.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Matching SearchPanel/Contents: absolutely filled over `viewer`, opaque — book text showing
  // faintly through a bookmarks list is as unreadable here as it is there.
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

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '600', color: '#111111' },
  action: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  actionText: { fontSize: 14, fontWeight: '600', color: '#111111' },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111111',
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f2f2f2',
  },
  addButtonText: { fontSize: 14, fontWeight: '600', color: '#111111' },
  disabled: { opacity: 0.4 },

  listWrap: { flex: 1, marginTop: 12 },
  list: { borderTopWidth: 1, borderTopColor: '#e2e2e2' },
  listContent: { paddingBottom: 48 },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  hint: { marginTop: 6, fontSize: 13, color: '#777777' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowBody: { flex: 1, paddingVertical: 12 },
  rowLabel: { fontSize: 15, color: '#111111' },
  editButton: { paddingHorizontal: 10, paddingVertical: 8 },
  editButtonText: { fontSize: 13, fontWeight: '600', color: '#111111' },
  deleteButton: { paddingHorizontal: 10, paddingVertical: 8 },
  deleteButtonText: { fontSize: 13, fontWeight: '600', color: '#8a1c1c' },

  editInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginVertical: 8,
    fontSize: 15,
    color: '#111111',
  },
  editAction: { paddingHorizontal: 8, paddingVertical: 8 },
  editActionText: { fontSize: 13, fontWeight: '600', color: '#111111' },
});
