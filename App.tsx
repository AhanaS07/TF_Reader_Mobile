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
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { DEV_SAMPLE_BOOK_ID } from '@/features/reader/devContentSeed';
import { ReaderScreen } from '@/features/reader/ReaderScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>TF Reader</Text>
        </View>
        {/*
          TEMP, with the block above: the bookId comes from devContentSeed's
          stand-in fixture because there is no library/navigation yet to select a
          real book. When RootNavigator lands, the route supplies this instead.
        */}
        <ReaderScreen bookId={DEV_SAMPLE_BOOK_ID} />
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
});
