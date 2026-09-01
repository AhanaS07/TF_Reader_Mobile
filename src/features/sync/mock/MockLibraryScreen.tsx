// src/features/sync/mock/ — throwaway scaffolding, NOT part of the real app surface.
//
// Exists only to visually exercise the sync layer's local reads before any real library screen
// consumes them: tap "Downloaded" to read expo-sqlite's `downloads` table via downloadTable,
// tap "Bookmarked" to read straight from Mongo when online and fall back to expo-sqlite's
// `bookmarks` table (via bookmarkTable) when offline - see showBookmarked() below. DELETE THIS
// WHOLE FOLDER once a real library/bookmarks UI lands - it exists so "do the local AND live
// reads actually work" can be seen on a device today.
//
// Deliberately reads every book for the user, not just the prototype's single hard-coded
// BOOK_ID - this predates a real book picker, so showing everything the device/server has is the
// only way to prove the reads actually work.
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
import { bookmarkMapper } from '@/features/sync/localDb/mappers';
import { bookmarkTable } from '@/features/sync/stores/bookmarkStore';
import { downloadTable } from '@/features/sync/stores/downloadStore';
import { api } from '@/features/sync/syncApi';
import { USER_ID } from '@/features/sync/syncConfig';
import { useConnectivity } from '@/features/sync/useConnectivity';
import type { ContentFormat } from '@/shared/contracts';

import type { RootStackParamList } from '@/navigation/RootNavigator';

type Tab = 'downloaded' | 'bookmarked';
type BookmarkSource = 'mongo' | 'sqlite';

type Props = NativeStackScreenProps<RootStackParamList, 'MockLibrary'>;

export function MockLibraryScreen({ navigation }: Props): React.JSX.Element {
  const online = useConnectivity();
  const [tab, setTab] = useState<Tab | null>(null);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [bookmarkSource, setBookmarkSource] = useState<BookmarkSource>('sqlite');
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const showDownloaded = async () => {
    setTab('downloaded');
    setLoading(true);
    setDownloads(await downloadTable.listActive(USER_ID));
    setLoading(false);
  };

  /**
   * Online -> straight from Mongo (`api.list`), no local SQLite involved at all - proves the
   * "undownloaded book, read online" path this mock exists to exercise (see the discussion this
   * screen followed from: a bookmark that lives only on the server for a book never downloaded
   * here must still be visible while reading it online). Offline -> `bookmarkTable.listActive`,
   * the durable local copy, same as before. Falls back to SQLite on a Mongo error too (e.g. the
   * device THINKS it has a route but the backend itself is down) rather than showing nothing.
   *
   * Filtered to DOWNLOADED books only, regardless of source: a bookmark for a book this device
   * hasn't downloaded can't actually be opened from here (openDownloadedBook() only ever gets
   * called on a row from the Downloaded tab), so showing it would just be a dead entry. Same
   * downloadTable.listActive() this screen's own Downloaded tab already reads.
   */
  const showBookmarked = async () => {
    setTab('bookmarked');
    setLoading(true);
    const downloadedBookIds = new Set(
      (await downloadTable.listActive(USER_ID)).map((row) => row.book_id),
    );
    if (online) {
      try {
        const response = await api.list<Record<string, unknown>>('bookmarks', { userId: USER_ID });
        const rows = (response.data ?? []).map((record) => bookmarkMapper.toRow(record));
        setBookmarks(rows.filter((row) => downloadedBookIds.has(row.book_id)));
        setBookmarkSource('mongo');
        setLoading(false);
        return;
      } catch (error) {
        console.error('showBookmarked: Mongo read failed, falling back to local SQLite', error);
      }
    }
    const rows = await bookmarkTable.listActive(USER_ID);
    setBookmarks(rows.filter((row) => downloadedBookIds.has(row.book_id)));
    setBookmarkSource('sqlite');
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

      {loading && (
        <Text style={styles.status}>
          {tab === 'bookmarked' && online ? 'Loading from Mongo…' : 'Loading from local SQLite…'}
        </Text>
      )}

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
        <>
          <Text style={styles.sourceLabel}>
            Source: {bookmarkSource === 'mongo' ? 'Mongo (live)' : 'local SQLite'}
          </Text>
          <FlatList
            data={bookmarks}
            keyExtractor={(row) => row.id}
            contentContainerStyle={bookmarks.length === 0 && styles.emptyContainer}
            ListEmptyComponent={
              <Text style={styles.empty}>
                No bookmarks for a downloaded book found ({bookmarkSource === 'mongo' ? 'Mongo' : 'local SQLite'}).
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{item.name ?? item.chapter_id ?? item.id}</Text>
                <Text style={styles.rowSubtitle}>book: {item.book_id}</Text>
              </View>
            )}
          />
        </>
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
  sourceLabel: { fontSize: 11, color: '#666666', marginBottom: 8 },
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
