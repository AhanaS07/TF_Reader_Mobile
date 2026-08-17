// App.tsx — the Expo entry component.
//
// `package.json` main = index.js at the repo root, which does
// `import App from './App'` and hands it to registerRootComponent. That resolves
// to THIS file, so the name and root location are load-bearing.
//
// (It used to be `node_modules/expo/AppEntry.js`, the pre-SDK-50 convention.
// Expo SDK 57 serves /index.bundle literally and no longer falls back to the
// `main` field, so with no root index.js Metro answered 404 and the dev client
// showed "Failed to load app from http://<ip>:8081" with no other diagnostics.)
//
// Deliberately near-empty. RootNavigator (src/navigation/) is CAP work owned by
// the feature teams — this file only proves the toolchain boots and should grow
// to `<SafeAreaProvider><RootNavigator /></SafeAreaProvider>` and nothing more.
//
// The inline colours below are the ONE exception to the no-raw-values rule and
// exist only until src/theme/ lands (P0). Replace them with tokens then.
//
// ─── TEMP: REMOVE WHEN RootNavigator LANDS ──────────────────────────────────
// The reader baseline (CAP-7, Ahana) needs to be reachable on a device to be
// testable at all, and src/navigation/ is still a .gitkeep — there is no
// navigator to register a screen with. So ReaderScreen is mounted directly here.
//
// This is scaffolding, not the shape this file should keep. When RootNavigator
// lands, delete the reader import, the <ReaderScreen /> and the header/styles
// below, and restore this file to the two-line body its header describes.
//
// The "TF Reader" header is KEPT DELIBERATELY: App.test.tsx asserts
// getByText('TF Reader'), and temporary wiring must not force an edit to a test
// that is doing its job. The reader mounts underneath it.
// ────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  DEV_SAMPLE_BOOK_ID,
  DEV_SAMPLE_EPUB_BOOK_ID,
  DEV_SAMPLE_PDF_BOOK_ID,
} from '@/features/reader/devContentSeed';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import type { BookId } from '@/shared/contracts';

/**
 * TEMP, with everything else in this file.
 *
 * A format picker rather than a book picker, because these two fixtures exist only to
 * exercise the two renderers. When RootNavigator and a library screen land, this is
 * replaced by picking a real book — and NOTHING about the reader changes, because the
 * reader never took a format: it reads it back from the stored package via
 * getFormat(bookId). Switching these ids is the same code path a real library uses.
 */
const FIXTURES: readonly { label: string; bookId: BookId }[] = [
  { label: 'EPUB', bookId: DEV_SAMPLE_EPUB_BOOK_ID },
  { label: 'PDF', bookId: DEV_SAMPLE_PDF_BOOK_ID },
];

export default function App() {
  // TEMP, with the block above. Initialised from DEV_SAMPLE_BOOK_ID so
  // EXPO_PUBLIC_READER_FORMAT=PDF still launches straight into the PDF, and the
  // picker below is a convenience on top rather than the only way in.
  const [bookId, setBookId] = useState<BookId>(DEV_SAMPLE_BOOK_ID);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>TF Reader</Text>

          {/*
            TEMP: picks which stand-in fixture to open, because there is no library
            screen yet. Switching only changes the bookId handed to ReaderScreen —
            the reader resolves the format from the stored package itself, so no
            format ever travels as a prop and this needs no reader change at all.
          */}
          <View style={styles.picker}>
            {FIXTURES.map((fixture) => {
              const selected = fixture.bookId === bookId;
              return (
                <Pressable
                  key={fixture.bookId}
                  onPress={() => setBookId(fixture.bookId)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.pickerOption, selected && styles.pickerOptionSelected]}
                >
                  <Text style={[styles.pickerLabel, selected && styles.pickerLabelSelected]}>
                    {fixture.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/*
          KEYED ON bookId, which ReaderScreen's own prop doc requires: all of its state
          is per-book, so switching fixtures remounts rather than carrying the previous
          book's format, shell, TOC and sender across. A real navigator does this for
          free by giving each route its own instance.
        */}
        <ReaderScreen key={bookId} bookId={bookId} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // flex:1, NOT centred. The old centring layout gave children an intrinsic
  // height; ReaderScreen -> WebView needs a measured, non-zero height all the way
  // down or epub.js renders a blank page. Also TEMP — goes with the block above.
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e2e2',
  },
  title: { fontSize: 20, fontWeight: '600', color: '#111111' },

  // TEMP, with the picker above.
  picker: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c8c8c8',
    backgroundColor: '#ffffff',
  },
  pickerOptionSelected: { backgroundColor: '#111111', borderColor: '#111111' },
  pickerLabel: { fontSize: 13, fontWeight: '600', color: '#444444' },
  pickerLabelSelected: { color: '#ffffff' },
});
