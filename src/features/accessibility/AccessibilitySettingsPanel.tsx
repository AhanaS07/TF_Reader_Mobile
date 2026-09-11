// src/features/accessibility/AccessibilitySettingsPanel.tsx
// Owner: Accessibility (Hruthik).
//
// Self-contained, exportable accessibility settings controls — dyslexia font, high contrast,
// reduced motion, the TTS on/off switch, and the two navigation-announcement gates. Not wired into
// any screen here: mounting it inside the in-reader panel stack (ReaderScreen) or a standalone
// Settings screen is the caller's job, since both surfaces need it — see the ownership note in
// day-5-accessibility-compressed-whistle.md. Modeled on TtsControls.tsx's chip-row pattern
// (accessibilityRole="button", accessibilityState={{ selected }}) for the same accessibility
// guarantees on the controls themselves.
//
// Writes go through prefsStore.savePrefs with a whole-group `accessibility` patch, spreading both
// `accessibility` and whichever sub-block (`text`/`display`/`tts`/`announce`) changed — the same
// "patches merge at the top level only" rule every other prefs writer in this app follows.
//
// THE TTS AND ANNOUNCE SECTIONS MOVED HERE FROM `DevPreferencesMenu.tsx` (repo root, temp
// scaffolding), not duplicated: that file's own header called its "Accessibility" section
// temporary, standing in only "until Personalization/Accessibility ships a real settings screen."
// This panel — already the permanent home for Dyslexia Font/High Contrast/Reduce Motion — is that
// screen for these two preferences too, so they get a permanent home instead of staying in
// scaffolding. The move is UI-only: `useTtsEnabled()`'s subscription, the
// `ttsProvider`/`useTtsSession` stop-on-disable chain (TTS_PROVIDER.md), and the "TTS must not be
// speaking" announcement gate (READER_ANNOUNCEMENTS.md) all react to `prefsStore`, not to which
// component renders the toggle — so relocating the buttons changes nothing about any of those.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import {
  guardTtsEnableForSleepTimer,
  resumeAudioIfPausedForSleepTimerTts,
} from '@/features/reader/audio/audioTtsCoordinator';
import type {
  AccessibilityPrefs,
  ContentFormat,
  ReduceMotion,
  TtsHighlightMode,
} from '@/shared/contracts';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

import { useReduceMotion } from './useReduceMotion';

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
 * Was previously unreachable from any UI — `accessibility.tts.highlightMode` had a persisted
 * column and full read-side support (`epub.entry.ts`'s `setSpokenWordRange`,
 * `selectionTheme.ts`'s `spokenWordOpacity`) but no control anywhere set it to `'word'`, which is
 * exactly what blocked the on-device contrast verification `selectionTheme.ts` names as
 * Accessibility's own pass. Same three-chip shape as Reduce Motion above.
 */
const HIGHLIGHT_MODE_OPTIONS: readonly { value: TtsHighlightMode; label: string }[] = [
  { value: 'sentence', label: 'Sentence' },
  { value: 'word', label: 'Word' },
  { value: 'none', label: 'Off' },
];

/** Labels kept short — these two sit side by side in one row, like every other chip pair here. */
const ANNOUNCE_OPTIONS: readonly {
  label: string;
  field: 'pageChanges' | 'chapterChanges';
}[] = [
  { label: 'Pages', field: 'pageChanges' },
  { label: 'Chapters', field: 'chapterChanges' },
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
  // 'system' is the only selection this panel can't already show the effect of from the stored
  // preference alone — it defers to a live OS signal the chip row itself never reads. `useReduceMotion`
  // is that resolve; see the caption below.
  const reduceMotionResolved = useReduceMotion();

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

  /**
   * `accessibility.tts.enabled` is `useTtsEnabled()`'s one source of truth (TTS_PROVIDER.md's "one
   * boolean that crosses the seam") — this is the only way to flip it. `PrefsPatch` already covers
   * `accessibility` as a top-level group (same "whole group, not deep-merged" contract as every
   * other toggle in this file), so this is a plain flip rather than a revert-to-default toggle —
   * there is no third state.
   */
  const toggleTts = (): void => {
    const nextEnabled = !prefs.tts.enabled;
    const apply = (): void => {
      void prefsStore
        .savePrefs({ accessibility: { ...prefs, tts: { ...prefs.tts, enabled: nextEnabled } } })
        .catch((error: unknown) => {
          console.warn('AccessibilitySettingsPanel: failed to save tts.enabled', error);
        });
    };
    if (nextEnabled) {
      guardTtsEnableForSleepTimer(apply);
    } else {
      resumeAudioIfPausedForSleepTimerTts();
      apply();
    }
  };

  const setHighlightMode = (value: TtsHighlightMode): void => {
    void prefsStore
      .savePrefs({ accessibility: { ...prefs, tts: { ...prefs.tts, highlightMode: value } } })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save tts.highlightMode', error);
      });
  };

  /**
   * The two `announce.*` gates, flipped the same way `toggleTts` flips its one.
   *
   * A PLAIN FLIP, not this file's usual revert-to-default toggle, and the difference is worth
   * stating because it looks like an inconsistency: both of these DEFAULT TO TRUE, so "press the
   * active option again to revert to the default" would mean the Off state could never stay
   * pressed.
   *
   * TWO CONTROLS BECAUSE THEY ARE TWO PREFERENCES. A page turn announces constantly and a chapter
   * change a handful of times a book; a reader who silenced pages has not asked to stop being told
   * which chapter they are in.
   */
  const toggleAnnounce = (field: 'pageChanges' | 'chapterChanges'): void => {
    void prefsStore
      .savePrefs({
        accessibility: {
          ...prefs,
          announce: { ...prefs.announce, [field]: !prefs.announce[field] },
        },
      })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save announce prefs', error);
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

      {/* No leading divider above whichever section renders FIRST — Dyslexia Font is the only
          conditional one, so this is the only divider that has to check for it; every later
          section is preceded by a fixed, always-rendered section and needs no such check. */}
      {showDyslexiaFont && <View style={styles.divider} />}
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

      <View style={styles.divider} />
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
      {prefs.display.reduceMotion === 'system' && (
        <Text style={styles.helperText} testID="reduce-motion-resolved">
          Currently: {reduceMotionResolved ? 'On' : 'Off'}
        </Text>
      )}

      <View style={styles.divider} />
      {/* NOT format-gated, unlike Dyslexia Font above: TTS is a device-wide accessibility
          preference, not a per-document one. ReaderScreen's own EPUB-only gate
          (`ttsEnabled && format === 'EPUB'`) is what actually restricts where the transport
          controls this switch unlocks can appear — this toggle itself applies to every format. */}
      <Text style={styles.sectionLabel}>Text-to-Speech</Text>
      <View style={styles.chipRow} testID="tts-row">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`TTS: ${prefs.tts.enabled ? 'On' : 'Off'}`}
          accessibilityState={{ selected: prefs.tts.enabled }}
          onPress={toggleTts}
          style={[styles.chip, prefs.tts.enabled && styles.chipSelected]}
        >
          <Text style={[styles.chipText, prefs.tts.enabled && styles.chipTextSelected]}>
            TTS: {prefs.tts.enabled ? 'On' : 'Off'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>TTS Highlight</Text>
      <View style={styles.chipRow} testID="tts-highlight-mode-row">
        {HIGHLIGHT_MODE_OPTIONS.map(({ value, label }) => {
          const selected = prefs.tts.highlightMode === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`TTS highlight: ${label}`}
              accessibilityState={{ selected }}
              key={value}
              onPress={() => setHighlightMode(value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />
      {/* THE TWO NAVIGATION-ANNOUNCEMENT GATES. Without a control they are unreachable on a
          device — nothing else in the app writes `accessibility.announce.*`. SEPARATE ROWS
          BECAUSE THEY ARE SEPARATE PREFERENCES — see `toggleAnnounce`'s own comment. No divider
          below this section: `AccessibilityInfoButton`, the next thing rendered after this panel
          (in ReaderScreen.tsx), already supplies its own leading hairline. */}
      <Text style={styles.sectionLabel}>Announcements</Text>
      <View style={styles.chipRow} testID="announce-row">
        {ANNOUNCE_OPTIONS.map(({ label, field }) => {
          const on = prefs.announce[field];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label} announcements: ${on ? 'On' : 'Off'}`}
              accessibilityState={{ selected: on }}
              key={field}
              onPress={() => toggleAnnounce(field)}
              style={[styles.chip, on && styles.chipSelected]}
            >
              <Text style={[styles.chipText, on && styles.chipTextSelected]}>
                {label}: {on ? 'On' : 'Off'}
              </Text>
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
  // Uppercase + tracked, like an iOS Settings section header — reads as a deliberate list
  // structure now that there are five of these plus the info row below, rather than three
  // floating labels. Style only: the accessible name is still the plain-case text content.
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#777777',
    marginTop: 10,
    marginBottom: 4,
    textAlign: 'center',
  },
  // A plain hairline between sections, same colour as AccessibilityInfoButton's own top border in
  // ReaderScreen.tsx so the whole panel — this component's sections plus that trailing row — reads
  // as one continuously-divided list rather than two different divider styles.
  divider: {
    height: 1,
    backgroundColor: '#e2e2e2',
    marginTop: 8,
  },
  // Same weight/colour as sectionLabel but not uppercase or bold — this is a live status readout,
  // not a section heading, and shouldn't compete with one visually.
  helperText: {
    fontSize: 12,
    color: '#777777',
    marginTop: 4,
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
