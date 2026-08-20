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
  DEV_FIXTURE_EPUB_BOOK_ID,
  DEV_FIXTURE_PDF_BOOK_ID,
  DEV_SAMPLE_BOOK_ID,
  DEV_SAMPLE_EPUB_BOOK_ID,
  DEV_SAMPLE_PDF_BOOK_ID,
} from '@/features/reader/devContentSeed';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { useAutoSync } from '@/features/sync/useAutoSync';
import type { BookId } from '@/shared/contracts';

/**
 * TEMP, with everything else in this file.
 *
 * A fixture picker rather than a book picker, because these exist only to exercise the two
 * renderers at two sizes. When RootNavigator and a library screen land, this is replaced by
 * picking a real book — and NOTHING about the reader changes, because the reader never took a
 * format: it reads it back from the stored package via getFormat(bookId). Switching these ids is
 * the same code path a real library uses.
 *
 * FOUR TABS, ALWAYS — the two bundled stand-ins and the two large books pushed into the container.
 * The large pair is listed even when nothing has been pushed for them, deliberately: they are the
 * books real features have to be rolled out against, and a tab that appears only once an env var
 * is set is indistinguishable from a feature that was never built. Tapping an unpopulated one
 * raises an error naming the variable that would fix it (devContentSeed's sampleBookBytes).
 *
 * The bundled two go FIRST so the everyday case is the default reach, and the large two are the
 * deliberate second step. When the large pair has carried every feature, the bundled two are what
 * gets deleted — not this picker.
 */
const DEV_FIXTURES: readonly { label: string; bookId: BookId }[] = [
  { label: 'EPUB', bookId: DEV_SAMPLE_EPUB_BOOK_ID },
  { label: 'PDF', bookId: DEV_SAMPLE_PDF_BOOK_ID },
  { label: 'Big EPUB', bookId: DEV_FIXTURE_EPUB_BOOK_ID },
  { label: 'Big PDF', bookId: DEV_FIXTURE_PDF_BOOK_ID },
];

/**
 * The four fixtures, plus `active` when it is somehow none of them.
 *
 * THE EXTRA ROW IS NOT COSMETIC, and is kept even though all four ids are now listed: it exists so
 * the picker can never fail to offer the book actually on screen. If it did, nothing would render
 * as selected and one tap would land on a stand-in with no way back short of a relaunch — the
 * "measuring the 3.6 KB book and believing it was 20 MB" failure devContentSeed.ts's distinct-id
 * note warns about, reached through the UI instead of through a shared id. It is unreachable while
 * DEV_SAMPLE_BOOK_ID resolves to one of the four; it costs one line to keep it that way.
 *
 * EXPORTED, AND A PURE FUNCTION OF ITS ARGUMENT, only so it can be tested: the value it
 * is called with comes from an env var read at module load, and reaching that through a
 * re-required App would hand the renderer a second copy of React.
 */
export function devFixtureOptions(active: BookId): readonly { label: string; bookId: BookId }[] {
  return DEV_FIXTURES.some((fixture) => fixture.bookId === active)
    ? DEV_FIXTURES
    : [{ label: 'Fixture', bookId: active }, ...DEV_FIXTURES];
}

const FIXTURES = devFixtureOptions(DEV_SAMPLE_BOOK_ID);

export default function App() {
  useAutoSync();

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
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
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
