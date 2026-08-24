// Owner: Accessibility (Hruthik).
//
// TEMP: bound to the fake reader-text provider until Reader ships the real ReaderTextProvider
// (TTS_PROVIDER.md step 5/6 — "UNBLOCKED, not started" as of 2026-08-21). This is the "TTS Demo"
// route (`src/navigation/TtsDemoScreen.tsx`, a thin wrapper with no behaviour of its own): a
// standalone screen so the already-built TtsControls/useTtsSession can be exercised on a device,
// including the one thing TtsControls itself doesn't show — which fake sentence is currently
// speaking. Replace the provider (not this screen's layout) once the real one lands; see
// TTS_PROVIDER.md's deletion table, which this file is now the call site for instead of App.tsx's
// old inline TtsDemo (App.tsx mounted this directly before RootNavigator landed).

import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createFakeReaderTextProvider } from '@/features/reader/tts/fakeReaderTextProvider';
import { readSharedPrefs, writeSharedPrefs } from '@/features/sync/sharedPrefs';

import { TtsControls } from './TtsControls';
import { useTtsEnabled } from './useTtsEnabled';
import { useTtsSession } from './useTtsSession';

export function TtsReadingScreen(): React.JSX.Element | null {
  // Forces accessibility.tts.enabled = true once, purely so this screen has something to show
  // without a Settings screen to flip it from — moved here from App.tsx's old TtsDemo, so it now
  // only fires when this tab is opened rather than on every app launch.
  useEffect(() => {
    let cancelled = false;
    readSharedPrefs()
      .then((shared) => {
        if (cancelled || shared.accessibility.tts.enabled) return;
        return writeSharedPrefs({
          ...shared,
          accessibility: { ...shared.accessibility, tts: { ...shared.accessibility.tts, enabled: true } },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = useTtsEnabled();
  const provider = useMemo(() => createFakeReaderTextProvider(), []);
  const session = useTtsSession(provider);

  if (!enabled) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Now reading (fake content)</Text>
      <Text style={styles.sentence} accessibilityLiveRegion="polite">
        {session.currentSentence?.text ?? 'Press play to start.'}
      </Text>
      <TtsControls session={session} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#666666', marginBottom: 8 },
  sentence: { fontSize: 18, lineHeight: 26, color: '#111111', marginBottom: 16 },
});
