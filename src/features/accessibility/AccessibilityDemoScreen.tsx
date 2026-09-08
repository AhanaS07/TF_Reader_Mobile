// src/features/accessibility/AccessibilityDemoScreen.tsx
// Owner: Accessibility (Hruthik). TEMPORARY — same disposable status TtsDemoScreen.tsx had before
// it was deleted once TTS mounted for real (see CLAUDE.md's "Temporary scaffolding" section).
//
// A standalone demo of the three Day-5 features (Dyslexia Font, High Contrast, Reduce Motion)
// before Handoff B (mounting them into the real Reader) lands. Backed by the REAL prefsStore, so
// toggling here persists exactly as it will once ReaderScreen mounts AccessibilitySettingsPanel for
// real — this screen adds no mock state of its own.
//
// Wired up by temporarily rendering this in place of <RootNavigator/> in App.tsx — see that diff's
// own note. Revert App.tsx after the walkthrough; nothing about this screen is meant to ship.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { resolveReduceMotion } from '@/shared/contracts';

import { AccessibilitySettingsPanel, useAccessibilityPrefs } from './AccessibilitySettingsPanel';
import { loadDyslexiaFontFaceSrc } from './dyslexiaFontLoader';
import { getHighContrastPalette, getHighContrastReaderColors } from './highContrastColors';
import type { ColorScheme } from './highContrastColors';

const SAMPLE_SENTENCE = 'The quick brown fox jumps over the lazy dog.';

function dyslexiaPreviewHtml(fontFaceSrc: string | null, dyslexiaFont: boolean): string {
  const fontFace =
    fontFaceSrc === null
      ? ''
      : `@font-face { font-family: 'OpenDyslexic3'; src: url(${fontFaceSrc}); }`;
  const fontFamily = dyslexiaFont && fontFaceSrc !== null ? 'OpenDyslexic3' : 'sans-serif';
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  ${fontFace}
  body { margin: 0; padding: 12px; font-family: ${fontFamily}; font-size: 20px; color: #111; background: #fff; }
</style>
</head><body>${SAMPLE_SENTENCE}</body></html>`;
}

function ContrastSwatch({ colorScheme }: { colorScheme: ColorScheme }): React.JSX.Element {
  const { fg, bg, link } = getHighContrastReaderColors(colorScheme);
  return (
    <View style={[styles.swatch, { backgroundColor: bg }]}>
      <Text style={[styles.swatchLabel, { color: fg }]}>{colorScheme}</Text>
      <Text style={{ color: fg }}>{SAMPLE_SENTENCE}</Text>
      <Text style={{ color: link }}>A sample link</Text>
    </View>
  );
}

export function AccessibilityDemoScreen(): React.JSX.Element {
  const prefs = useAccessibilityPrefs();
  const [fontFaceSrc, setFontFaceSrc] = useState<string | null>(null);
  const [osReduceMotionEnabled, setOsReduceMotionEnabled] = useState(false);

  useEffect(() => {
    void loadDyslexiaFontFaceSrc().then(setFontFaceSrc);
  }, []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setOsReduceMotionEnabled);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOsReduceMotionEnabled);
    return () => sub.remove();
  }, []);

  const nativePalette = getHighContrastPalette(prefs.display.highContrast ? 'dark' : 'light');
  const effectiveReduceMotion = resolveReduceMotion(prefs.display.reduceMotion, osReduceMotionEnabled);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Accessibility Demo (temporary)</Text>

      <AccessibilitySettingsPanel format="EPUB" />

      <Text style={styles.sectionHeading}>1. Dyslexia font preview</Text>
      <Text style={styles.caption}>
        {prefs.text.dyslexiaFont ? 'OpenDyslexic3 (via dyslexiaFontLoader)' : 'System font'}
      </Text>
      <WebView
        style={styles.webview}
        source={{ html: dyslexiaPreviewHtml(fontFaceSrc, prefs.text.dyslexiaFont) }}
      />

      <Text style={styles.sectionHeading}>2. High contrast preview</Text>
      <Text style={styles.caption}>
        Reader colors (both schemes, always visible) — High Contrast toggle above:{' '}
        {prefs.display.highContrast ? 'On' : 'Off'}
      </Text>
      <View style={styles.swatchRow}>
        <ContrastSwatch colorScheme="light" />
        <ContrastSwatch colorScheme="dark" />
      </View>
      <Text style={styles.caption}>Native chrome palette (derived from the toggle above):</Text>
      <View
        style={[
          styles.nativeSwatch,
          { backgroundColor: nativePalette.bg, borderColor: nativePalette.border },
        ]}
      >
        <Text style={{ color: nativePalette.fg }}>Toolbar / panel chrome</Text>
        <Text style={{ color: nativePalette.accent }}>Focus ring / accent</Text>
      </View>

      <Text style={styles.sectionHeading}>3. Reduced motion preview</Text>
      <Text style={styles.caption}>
        There is no animation anywhere in the reader to visually suppress (confirmed by
        readerTemplate.test.ts) — this proves the tri-state resolution logic instead.
      </Text>
      <Text style={styles.mono}>Stored preference: {prefs.display.reduceMotion}</Text>
      <Text style={styles.mono}>OS Reduce Motion: {osReduceMotionEnabled ? 'On' : 'Off'}</Text>
      <Text style={styles.mono}>Effective (resolveReduceMotion): {String(effectiveReduceMotion)}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  sectionHeading: { fontSize: 15, fontWeight: '700', marginTop: 20 },
  caption: { fontSize: 12, color: '#666' },
  mono: { fontFamily: 'Courier', fontSize: 13 },
  webview: { height: 100, borderWidth: 1, borderColor: '#ddd' },
  swatchRow: { flexDirection: 'row', gap: 8 },
  swatch: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', gap: 4 },
  swatchLabel: { fontWeight: '700', textTransform: 'uppercase', fontSize: 11 },
  nativeSwatch: { padding: 12, borderRadius: 8, borderWidth: 2, gap: 4 },
});
