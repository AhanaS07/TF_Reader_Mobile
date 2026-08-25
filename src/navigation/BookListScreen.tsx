// Owner: Reader (Ahana), same status as the App.tsx picker this replaces — TEMP, dev-only, and NOT
// the "Create book list page" this file's name might suggest to a real library screen. There is
// still no backend book catalogue to list (that is Download/Encryption's real download pass,
// devContentSeed.ts's own header), so this lists the same four seeded fixtures App.tsx used to,
// plus the TTS demo, as real navigable routes instead of a state-swapped picker. See CLAUDE.md's
// "Temporary scaffolding" section — this screen goes with devContentSeed.ts, not before it.
//
// FOUR BOOK FIXTURES, ALWAYS LISTED — same reasoning as the old DevFixture table in App.tsx: the
// two bundled stand-ins and the two large books pushed into the container via
// EXPO_PUBLIC_READER_FIXTURE_EPUB/_PDF. Tapping an unpopulated large-book row still works — it
// navigates to Reader, which raises devContentSeed's own "name the env var" error in its banner —
// so a missing fixture reads as "nothing was pushed for this", not as a row that silently does
// nothing.
//
// THE UNRECOGNISED-ACTIVE-BOOK FALLBACK ROW FROM App.tsx's `devFixtureOptions` DOES NOT CARRY OVER.
// It existed because that picker always had exactly one "active" bookId that had to be represented
// somewhere in the list. A list screen with real routes has no such concept — nothing is "active"
// here, and Reader always opens exactly the bookId it was navigated to.
//
// OPEN BUTTON FLOWS THROUGH openBook(): tapping a row first calls openBook() (the unified
// STREAM-intent licence gate — checkLicense → fetch/store → openSession → decryptBook), which
// stores an Elite (in-memory, canPersist:false) package that ReaderScreen's getBookBase64()
// picks up. For already-downloaded books, openBook() short-circuits to the disk copy. If
// openBook() fails (offline with no local copy, entitlement revoked, etc.), the error is shown
// as an alert and the user stays on the list.

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { DownloadProgressIndicator } from '@/features/download/DownloadProgressIndicator';
import { useDownloadProgress } from '@/features/download/useDownloadProgress';
import { openBook } from '@/features/download/openBook';
import { DownloadFailure } from '@/features/download/errors';
import {
  DEV_FIXTURE_EPUB_BOOK_ID,
  DEV_FIXTURE_PDF_BOOK_ID,
  DEV_SAMPLE_EPUB_BOOK_ID,
  DEV_SAMPLE_PDF_BOOK_ID,
} from '@/features/reader/devContentSeed';
import type { BookId, ContentFormat } from '@/shared/contracts';

import type { RootStackParamList } from './RootNavigator';

interface DevFixture {
  label: string;
  bookId: BookId;
  format: ContentFormat;
}

/**
 * The audiobook's id is a REAL BACKEND CATALOGUE ID, not a seeded one — which is why it is declared
 * here rather than imported from `devContentSeed.ts` like every other row.
 *
 * It matches `_id: "dev-sample-audio-encrypted"` in the backend's `demo-dataset.json` (SUBSCRIPTION
 * tier, publisher `pub_rtlg`, covered by entitlement `ent_imp2`), whose content grant resolves to
 * an encrypted `sample-small.wav.enc`. Nothing on the device seeds it: tapping the row acquires it
 * through `openBook()` (stream) or the row's own Download button (persist).
 *
 * If this id and the backend's ever drift apart, the symptom is a licence check that fails rather
 * than anything subtle — the catalogue simply has no such item.
 */
const BACKEND_AUDIO_BOOK_ID = 'dev-sample-audio-encrypted' as BookId;

const DEV_FIXTURES: readonly DevFixture[] = [
  { label: 'EPUB', bookId: DEV_SAMPLE_EPUB_BOOK_ID, format: 'EPUB' },
  { label: 'PDF', bookId: DEV_SAMPLE_PDF_BOOK_ID, format: 'PDF' },
  { label: 'Big EPUB', bookId: DEV_FIXTURE_EPUB_BOOK_ID, format: 'EPUB' },
  { label: 'Big PDF', bookId: DEV_FIXTURE_PDF_BOOK_ID, format: 'PDF' },
  // The one row backed by the REAL BACKEND rather than a local seed. Tapping it routes to the
  // AudioPlayer route (see onPress below); the row's Download button persists it for offline
  // playback through the same `useDownloadProgress` hook every other row uses.
  { label: 'Audiobook (Encrypted)', bookId: BACKEND_AUDIO_BOOK_ID, format: 'AUDIO' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'BookList'>;

function FixtureRow({
  fixture,
  onPress,
}: {
  fixture: DevFixture;
  onPress: () => void;
}): React.JSX.Element {
  // One instance per row — see the header note on why this isn't one shared hook.
  const downloadProgress = useDownloadProgress();

  return (
    // THE WHOLE CARD IS THE PRESSABLE, not just a band around the label. It used to be a plain
    // View with a small Pressable wrapped tightly around the label text only — visually the card
    // filled its border, but only that thin label-height strip actually navigated, so tapping
    // anywhere else in the (much taller, once the Download button and its indicator are counted)
    // rectangle did nothing. Nesting the Download button's own Pressable inside this one still
    // works correctly — RN awards the touch to the innermost Pressable actually hit, so tapping
    // Download fires only its own onPress, not this row's.
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      {/*
        NO SEPARATE FORMAT SUBTITLE, deliberately: for the two bundled fixtures the label already
        IS the format ("EPUB", "PDF"), so a second line repeating it would be redundant, and for
        the "Big EPUB"/"Big PDF" rows the label already says it too. `fixture.format` stays used
        for navigation and the download button below; nothing here needs to render it separately.
      */}
      <Text style={styles.rowLabel}>{fixture.label}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Download ${fixture.label}`}
        onPress={() => downloadProgress.start(fixture.bookId, fixture.format)}
        disabled={downloadProgress.status === 'downloading'}
        style={[
          styles.downloadButton,
          downloadProgress.status === 'downloading' && styles.downloadButtonDisabled,
        ]}
      >
        <Text style={styles.downloadButtonLabel}>Download</Text>
      </Pressable>

      <DownloadProgressIndicator {...downloadProgress} />
    </Pressable>
  );
}

export function BookListScreen({ navigation }: Props): React.JSX.Element {
  const handleOpen = async (bookId: BookId, format: ContentFormat) => {
    try {
      // openBook() is the unified STREAM-intent licence gate: checkLicense → fetch/store →
      // openSession → decryptBook. For already-downloaded books it short-circuits to the disk
      // copy; for online books it streams into RAM as an Elite (canPersist:false) package that
      // ReaderScreen's getBookBase64() picks up.
      await openBook(bookId, format);
      navigation.navigate('Reader', { bookId, format });
    } catch (error) {
      const message =
        error instanceof DownloadFailure ? `${error.code}: ${error.message}` : String(error);
      Alert.alert('Cannot open book', message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {DEV_FIXTURES.map((fixture) => (
        <FixtureRow
          key={fixture.bookId}
          fixture={fixture}
          onPress={() =>
            // AUDIO PHASE 3: the open-path diversion. Decided HERE, at tap time, rather than
            // inside ReaderScreen's own format switch — ReaderScreen has no navigation dependency
            // today and this keeps it that way, rather than teaching a WebView-only screen how to
            // redirect elsewhere. See BookId AudioPlayer route's own header for the rest of the
            // split. ReaderScreen's own `case 'AUDIO':` (its exhaustive switch, previously the
            // only thing standing between an audio book and a blank screen) is INTENTIONALLY left
            // in place as a backstop — see that file's updated comment.
            //
            // AUDIO DOES NOT CALL handleOpen() HERE, and — unlike when this comment first said so
            // — that is no longer a gap. `audioAssetResolver.resolveAudioAssetUri` now calls
            // `openBook()` itself, on every resolve, so audio runs the SAME licence gate every other
            // format does; it just runs it a moment later, inside the player screen.
            //
            // Deliberately not called twice. Doing it here as well would gate correctly and then
            // immediately be undone: the resolver's `closeBook()` is terminal for a streamed
            // (ephemeral) package, so a tap-time `openBook()` would be discarded before the player
            // ever saw it, and re-entry would need the resolver to re-acquire anyway. One call, in
            // the one place that can guarantee the bytes are still live when the file is written.
            //
            // The visible consequence: a licence failure for audio surfaces in the player screen's
            // own error state rather than as this screen's alert.
            //
            // KNOWN LIMITATION, not solved here: this assumes one bookId maps to exactly one
            // format, decided statically per DevFixture row. B12 (CONTRACT_ALIGNMENT.md) already
            // flags that a real catalogue book can carry more than one asset (e.g. an EPUB
            // alongside an AUDIO edition of the same title) — this tap-time branch has no way to
            // offer a choice between them. Not a regression (today's dev fixtures are 1:1 anyway),
            // but whoever builds the real library screen against a real catalogue will need a
            // different decision point than "the row's one static format field."
            fixture.format === 'AUDIO'
              ? navigation.navigate('AudioPlayer', { bookId: fixture.bookId, title: fixture.label })
              : handleOpen(fixture.bookId, fixture.format)
          }
        />
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('TtsDemo')}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>TTS Demo</Text>
      </Pressable>

      {/* TEMP, with src/features/sync/mock/ — remove this row when that whole folder goes. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('MockLibrary')}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Sync Mock (Downloaded / Bookmarked)</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  content: { padding: 16, gap: 12 },
  row: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 12,
    padding: 12,
  },
  rowLabel: { fontSize: 17, fontWeight: '600', color: '#111111' },
  downloadButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#111111',
  },
  downloadButtonDisabled: { backgroundColor: '#9a9a9a' },
  downloadButtonLabel: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
});
