// DevPreferencesMenu.tsx — TEMP, same status as App.tsx's fixture picker (see its own header note).
//
// Replaces the earlier inline row of one-shot buttons in App.tsx with a hamburger ("☰") dropdown of
// TOGGLES, so Reader's live `applyAppearance` re-apply path (READER_PREFS_APPLICATION.md §5,
// triggers A/B) can be exercised without a real settings screen. Delete this file and its use in
// App.tsx the moment Personalization (Vaishnavi) ships one — this is not that screen, and does not
// preempt her ownership of src/features/personalization/.
//
// LIVE, NOT "ON RETURN": there is no navigation here — the menu is an overlay drawn on top of the
// still-mounted ReaderScreen, so a toggle's effect is visible immediately through the SAME
// prefsStore.subscribe() path ReaderScreen already wires up. "Apply when the user goes back to the
// reader" falls out for free because the reader was never left.
//
// TOGGLE SEMANTICS: re-pressing the ALREADY-ACTIVE option reverts that field to DEFAULT_PREFS,
// rather than leaving it stuck once set — exactly the "click again to undo" behaviour asked for.
// Each patch replaces its whole top-level prefs group (typography, etc.), matching PrefsPatch's own
// "merges at the top level" contract (prefsStore.ts) — so turning "Big text" off restores the WHOLE
// default typography group, not just its size field, in case a future toggle here ever touches a
// sibling field.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import type { PrefsPatch } from '@/features/personalization/prefsStore';
import { DEFAULT_PREFS } from '@/shared/contracts';
import type { SharedPrefs, Theme } from '@/shared/contracts';

const BIG_TEXT_SIZE = 28;

const THEME_OPTIONS: readonly { label: string; theme: Theme }[] = [
  { label: 'Light', theme: 'light' },
  { label: 'Dark', theme: 'dark' },
  { label: 'Sepia', theme: 'sepia' },
];

/** Pressing the currently-active theme reverts to `'system'` (DEFAULT_PREFS.theme); pressing a
 * different one switches to it. Never leaves the segmented control able to select nothing. */
function toggleTheme(current: SharedPrefs, theme: Theme): PrefsPatch {
  return { theme: current.theme === theme ? DEFAULT_PREFS.theme : theme };
}

function isBigText(prefs: SharedPrefs): boolean {
  return prefs.typography.size === BIG_TEXT_SIZE;
}

function toggleBigText(prefs: SharedPrefs): PrefsPatch {
  return {
    typography: isBigText(prefs)
      ? { ...DEFAULT_PREFS.typography }
      : { ...DEFAULT_PREFS.typography, size: BIG_TEXT_SIZE },
  };
}

export function DevPreferencesMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  // Local, live copy of prefs — needed to know which toggle is currently "on" (so pressing it again
  // can revert rather than re-apply), same live channel ReaderScreen itself subscribes to.
  const [prefs, setPrefs] = useState<SharedPrefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    void prefsStore.getPrefs().then((fresh) => {
      if (!cancelled) setPrefs(fresh);
    });

    const unsubscribe = prefsStore.subscribe((fresh) => {
      setPrefs(fresh);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close preferences menu' : 'Open preferences menu'}
        onPress={() => setOpen((wasOpen) => !wasOpen)}
        style={styles.menuButton}
      >
        <Text style={styles.menuIcon}>☰</Text>
      </Pressable>

      {open && prefs && (
        <View style={styles.dropdown}>
          <Text style={styles.sectionLabel}>Theme</Text>
          <View style={styles.row}>
            {THEME_OPTIONS.map(({ label, theme }) => {
              const active = prefs.theme === theme;
              return (
                <Pressable
                  key={theme}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Theme: ${label}${active ? ', selected' : ''}`}
                  onPress={() => {
                    void prefsStore.savePrefs(toggleTheme(prefs, theme));
                  }}
                  style={[styles.toggle, active && styles.toggleActive]}
                >
                  <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Typography</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isBigText(prefs) }}
              accessibilityLabel={`Big text${isBigText(prefs) ? ', selected' : ''}`}
              onPress={() => {
                void prefsStore.savePrefs(toggleBigText(prefs));
              }}
              style={[styles.toggle, isBigText(prefs) && styles.toggleActive]}
            >
              <Text style={[styles.toggleLabel, isBigText(prefs) && styles.toggleLabelActive]}>
                Big text
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Anchors the dropdown to this button rather than the header, so it overlays the reader below
  // instead of pushing it down.
  container: { position: 'relative' },

  menuButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  menuIcon: { fontSize: 22, color: '#111111' },

  // Floats over the reader — z-indexed above it and NOT part of the header's own layout flow, so
  // opening it never resizes the WebView underneath (which would re-paginate for no reason).
  dropdown: {
    position: 'absolute',
    top: 48,
    right: 0,
    minWidth: 200,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    padding: 12,
    // RN's boxShadow is iOS/Android-agnostic as of RN 0.76+; elevation is the Android fallback for
    // engines that ignore it.
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.12)',
    elevation: 6,
    zIndex: 10,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },

  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c8c8c8',
    backgroundColor: '#ffffff',
  },
  toggleActive: { backgroundColor: '#111111', borderColor: '#111111' },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: '#444444' },
  toggleLabelActive: { color: '#ffffff' },
});
