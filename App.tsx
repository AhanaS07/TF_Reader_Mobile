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
// RootNavigator (src/navigation/) has now landed — see its own header note for what it hosts
// (BookList/Reader/AudioPlayer) and CLAUDE.md's "Temporary scaffolding" section for what is still
// dev-only underneath it. This file is back to what its own header always said it should be:
// proving the toolchain boots, plus `useAutoSync()`, which is app-wide and unrelated to routing.
//
// The "TF Reader" header text used to live in a hand-rolled title row here; it now comes from
// BookListScreen's own `options={{ title: 'TF Reader' }}` in RootNavigator — a native-stack header
// CONFIG prop, not a rendered Text, so App.test.tsx no longer asserts on it (see that file's own
// note).
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAudioPlayerSetup } from '@/features/reader/audio/useAudioPlayerSetup';
import { useAutoSync } from '@/features/sync/useAutoSync';
import { RootNavigator } from '@/navigation/RootNavigator';

export default function App() {
  useAutoSync();
  // AUDIO PHASE 2: bootstraps expo-audio's global audio session once, app-wide — see that hook's
  // own header for why this lives here (mirrors useAutoSync's placement) rather than in
  // ReaderScreen.
  useAudioPlayerSetup();

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
