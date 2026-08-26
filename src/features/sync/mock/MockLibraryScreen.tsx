// src/features/sync/mock/ — throwaway scaffolding, NOT part of the real app surface.
//
// Exists only to visually exercise the sync layer's local reads before any real library screen
// consumes them: tap "Downloaded" to read expo-sqlite's `downloads` table via downloadTable, tap
// "Bookmarked" to read `bookmarks` via bookmarkTable - both straight from local SQLite, no network,
// exactly what a real screen would call. DELETE THIS WHOLE FOLDER once a real library/bookmarks UI
// lands - it exists so "does the local read side actually work" can be seen on a device today.
//
// Deliberately reads every book for the user (`listActive(USER_ID)`, no bookId), not just the
// prototype's single hard-coded BOOK_ID - this predates a real book picker, so showing everything
// the device has is the only way to prove downloadStore/bookmarkStore's local reads work at all.
//
// Tapping a downloaded row calls openBook() (Download, Abhinav) - the same unified licence gate
// BookListScreen.tsx uses (checkLicense → decrypt). For a book already on disk it short-circuits
// straight to the local ciphertext, so this is exactly how "open it offline" is exercised: no
// network call happens for a book this device already has. AUDIO is skipped here (its route needs
// a title this mock has no source for) - EPUB/PDF only, same as everything else in this file being
// intentionally minimal.

import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { DownloadFailure } from '@/features/download/errors';
import { openBook } from '@/features/download/openBook';
import type { BookmarkRow, DownloadRow } from '@/features/sync/localDb/types';
import { bookmarkTable } from '@/features/sync/stores/bookmarkStore';
import { downloadTable } from '@/features/sync/stores/downloadStore';
import { USER_ID } from '@/features/sync/syncConfig';
import type { ContentFormat } from '@/shared/contracts';

import type { RootStackParamList } from '@/navigation/RootNavigator';

type Tab = 'downloaded' | 'bookmarked';

type Props = NativeStackScreenProps<RootStackParamList, 'MockLibrary'>;

export function MockLibraryScreen({ navigation }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab | null>(null);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const showDownloaded = async () => {
    setTab('downloaded');
    setLoading(true);
    setDownloads(await downloadTable.listActive(USER_ID));
    setLoading(false);
  };

  const showBookmarked = async () => {
    setTab('bookmarked');
    setLoading(true);
    setBookmarks(await bookmarkTable.listActive(USER_ID));
    setLoading(false);
  };

  const openDownloadedBook = async (row: DownloadRow) => {
    if (row.format === 'AUDIO') {
      Alert.alert('Audiobook', 'Open audiobooks from the real BookList screen, not this mock.');
      return;
    }

    setOpening(row.id);
    try {
      // checkLicense → decrypt. For a book already on disk (true for anything already showing up
      // in this list) this never touches the network - exactly the "open it offline" path.
      await openBook(row.book_id, row.format as ContentFormat);
      navigation.navigate('Reader', {
        bookId: row.book_id,
        format: row.format as ContentFormat,
      });
    } catch (error) {
      const message =
        error instanceof DownloadFailure ? `${error.code}: ${error.message}` : String(error);
      console.error('openBook failed:', error instanceof DownloadFailure ? error.cause : error);
      Alert.alert('Cannot open book', message);
    } finally {
      setOpening(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.banner}>
        Sync mock - reads local SQLite directly. Delete src/features/sync/mock/ when a real screen
        replaces this.
      </Text>

      <View style={styles.tabs}>
        <Pressable
          onPress={showDownloaded}
          style={[styles.tabButton, tab === 'downloaded' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabLabel, tab === 'downloaded' && styles.tabLabelActive]}>
            Downloaded
          </Text>
        </Pressable>
        <Pressable
          onPress={showBookmarked}
          style={[styles.tabButton, tab === 'bookmarked' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabLabel, tab === 'bookmarked' && styles.tabLabelActive]}>
            Bookmarked
          </Text>
        </Pressable>
      </View>

      {loading && <Text style={styles.status}>Loading from local SQLite…</Text>}

      {tab === 'downloaded' && !loading && (
        <FlatList
          data={downloads}
          keyExtractor={(row) => row.id}
          contentContainerStyle={downloads.length === 0 && styles.emptyContainer}
          ListEmptyComponent={
            <Text style={styles.empty}>No rows in the local `downloads` table.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => openDownloadedBook(item)}
              disabled={opening === item.id}
              style={styles.row}
            >
              <Text style={styles.rowTitle}>{item.book_id}</Text>
              <Text style={styles.rowSubtitle}>
                {item.format} · {item.status ?? 'unknown status'} ·{' '}
                {item.is_valid ? 'valid' : 'locked'}
                {opening === item.id ? ' · opening…' : ''}
              </Text>
            </Pressable>
          )}
        />
      )}

      {tab === 'bookmarked' && !loading && (
        <FlatList
          data={bookmarks}
          keyExtractor={(row) => row.id}
          contentContainerStyle={bookmarks.length === 0 && styles.emptyContainer}
          ListEmptyComponent={
            <Text style={styles.empty}>No rows in the local `bookmarks` table.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.name ?? item.chapter_id ?? item.id}</Text>
              <Text style={styles.rowSubtitle}>book: {item.book_id}</Text>
            </View>
          )}
        />
      )}

      {tab === null && !loading && (
        <Text style={styles.status}>Tap a tab above to read from local SQLite.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', padding: 16 },
  banner: { fontSize: 11, color: '#a15c00', marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c8c8c8',
    alignItems: 'center',
  },
  tabButtonActive: { backgroundColor: '#111111', borderColor: '#111111' },
  tabLabel: { fontSize: 14, fontWeight: '600', color: '#444444' },
  tabLabelActive: { color: '#ffffff' },
  status: { color: '#666666', textAlign: 'center', marginTop: 24 },
  empty: { color: '#888888', textAlign: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#111111' },
  rowSubtitle: { fontSize: 12, color: '#666666', marginTop: 2 },
});
