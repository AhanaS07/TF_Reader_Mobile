// src/features/accessibility/AccessibilitySettingsPanel.tsx
// Owner: Accessibility (Hruthik).
//
// Self-contained, exportable accessibility settings controls — dyslexia font, high contrast, and
// reduced motion. Not wired into any screen here: mounting it inside the in-reader panel stack
// (ReaderScreen) or a standalone Settings screen is the caller's job, since both surfaces need it —
// see the ownership note in day-5-accessibility-compressed-whistle.md. Modeled on TtsControls.tsx's
// chip-row pattern (accessibilityRole="button", accessibilityState={{ selected }}) for the same
// accessibility guarantees on the controls themselves.
//
// Writes go through prefsStore.savePrefs with a whole-group `accessibility` patch, spreading both
// `accessibility` and whichever sub-block (`text`/`display`) changed — the same "patches merge at
// the top level only" rule every other prefs writer in this app follows.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import type { AccessibilityPrefs, ContentFormat, ReduceMotion } from '@/shared/contracts';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

export interface AccessibilitySettingsPanelProps {
  /**
   * The open book's format, so the Dyslexia Font control can hide itself for formats with no text
   * CSS layer to override (PDF rasterises pages; AUDIO has no text at all). Omit to always show it
   * — e.g. a standalone Settings screen not scoped to one open book.
   */
  format?: ContentFormat;
}

const REDUCE_MOTION_OPTIONS: readonly { value: ReduceMotion; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/**
 * Seed-then-subscribe dance for the accessibility slice of prefs, same shape as
 * `tts/useTtsEnabled.ts`: a one-shot read answers "what was stored before this panel mounted",
 * and `prefsStore.subscribe` answers "the user (or another control) just changed it". Dropping
 * either reintroduces the bug that hook's own comment documents.
 */
export function useAccessibilityPrefs(): AccessibilityPrefs {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(DEFAULT_ACCESSIBILITY_PREFS);

  useEffect(() => {
    let torn = false;
    let superseded = false;

    void prefsStore
      .getPrefs()
      .then((fresh) => {
        if (torn || superseded) return;
        setPrefs(fresh.accessibility);
      })
      .catch(() => {
        // Swallowed on purpose: a failed read is indistinguishable from first run, and the
        // honest default is DEFAULT_ACCESSIBILITY_PREFS, already the initial state.
      });

    const unsubscribe = prefsStore.subscribe((fresh) => {
      superseded = true;
      setPrefs(fresh.accessibility);
    });

    return () => {
      torn = true;
      unsubscribe();
    };
  }, []);

  return prefs;
}

export function AccessibilitySettingsPanel({
  format,
}: AccessibilitySettingsPanelProps): React.JSX.Element {
  const prefs = useAccessibilityPrefs();
  const showDyslexiaFont = format === undefined || format === 'EPUB';

  const toggleDyslexiaFont = (): void => {
    void prefsStore
      .savePrefs({
        accessibility: { ...prefs, text: { ...prefs.text, dyslexiaFont: !prefs.text.dyslexiaFont } },
      })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save dyslexiaFont', error);
      });
  };

  const toggleHighContrast = (): void => {
    void prefsStore
      .savePrefs({
        accessibility: {
          ...prefs,
          display: { ...prefs.display, highContrast: !prefs.display.highContrast },
        },
      })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save highContrast', error);
      });
  };

  const setReduceMotion = (value: ReduceMotion): void => {
    void prefsStore
      .savePrefs({
        accessibility: { ...prefs, display: { ...prefs.display, reduceMotion: value } },
      })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save reduceMotion', error);
      });
  };

  return (
    <View style={styles.container}>
      {showDyslexiaFont && (
        <>
          <Text style={styles.sectionLabel}>Dyslexia Font</Text>
          <View style={styles.chipRow} testID="dyslexia-font-row">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Dyslexia font: ${prefs.text.dyslexiaFont ? 'On' : 'Off'}`}
              accessibilityState={{ selected: prefs.text.dyslexiaFont }}
              onPress={toggleDyslexiaFont}
              style={[styles.chip, prefs.text.dyslexiaFont && styles.chipSelected]}
            >
              <Text style={[styles.chipText, prefs.text.dyslexiaFont && styles.chipTextSelected]}>
                Dyslexia Font: {prefs.text.dyslexiaFont ? 'On' : 'Off'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>High Contrast</Text>
      <View style={styles.chipRow} testID="high-contrast-row">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`High contrast: ${prefs.display.highContrast ? 'On' : 'Off'}`}
          accessibilityState={{ selected: prefs.display.highContrast }}
          onPress={toggleHighContrast}
          style={[styles.chip, prefs.display.highContrast && styles.chipSelected]}
        >
          <Text style={[styles.chipText, prefs.display.highContrast && styles.chipTextSelected]}>
            High Contrast: {prefs.display.highContrast ? 'On' : 'Off'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Reduce Motion</Text>
      <View style={styles.chipRow} testID="reduce-motion-row">
        {REDUCE_MOTION_OPTIONS.map(({ value, label }) => {
          const selected = prefs.display.reduceMotion === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reduce motion: ${label}`}
              accessibilityState={{ selected }}
              key={value}
              onPress={() => setReduceMotion(value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same centred, width-capped shape as TtsControls.tsx's container — see that file's comment for
  // why this isn't stretched full-width on a tablet. NO top border, unlike TtsControls: that border
  // reads as a docked-strip edge, which only makes sense when the panel replaces the bottom nav row.
  // Reader mounts this as a floating overlay instead (docking it would resize the WebView and
  // re-paginate epub.js mid-read, invalidating every resolved CFI), so a top border here would just
  // be a stray line inside a floating card.
  container: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#777777',
    marginTop: 10,
    marginBottom: 4,
    textAlign: 'center',
  },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f2f2f2',
  },
  chipSelected: { backgroundColor: '#111111' },
  chipText: { fontSize: 13, color: '#111111', fontWeight: '600' },
  chipTextSelected: { color: '#ffffff' },
});
