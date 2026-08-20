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
// Each patch replaces its whole top-level prefs group (typography/layout/etc.), matching
// PrefsPatch's own "merges at the top level" contract (PREFS_API_FOR_FRONTEND.md's "one rule that
// bites") — a flow toggle spreads the CURRENT layout group and overrides only `flow`, so it cannot
// clobber a `spread` the user already set, and vice versa.
//
// LAYOUT AND ZOOM ARE ALREADY APPLIED BY THE READER — this file adds no new reader-side behaviour.
// `flow`/`spread` (epub.entry.ts's `currentFlow`/`mapSpread`) and `zoom` (pdf.entry.ts's
// `currentZoom`) were part of `applyAppearance` from the first cut of this feature; what was missing
// was a way to CHANGE them without hand-editing SQLite, which is what the two new sections below are
// for. `PREFS_API_FOR_FRONTEND.md` (Personalization, 2026-08-20) is a field catalogue for a real
// settings screen — it documents these fields, it does not introduce them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import type { PrefsPatch } from '@/features/personalization/prefsStore';
import { DEFAULT_PREFS } from '@/shared/contracts';
import type { LayoutPrefs, SharedPrefs, Theme } from '@/shared/contracts';

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

const FLOW_OPTIONS: readonly { label: string; flow: LayoutPrefs['flow'] }[] = [
  { label: 'Paginated', flow: 'paginated' },
  { label: 'Scrolled', flow: 'scrolled-doc' },
];

const SPREAD_OPTIONS: readonly { label: string; spread: LayoutPrefs['spread'] }[] = [
  { label: 'Single', spread: 'single' },
  { label: 'Double', spread: 'double' },
];

/** Spreads the CURRENT layout group so changing `flow` can never silently reset `spread` (or the
 * reverse) — the exact mistake PREFS_API_FOR_FRONTEND.md's "one rule that bites" warns about. */
function toggleFlow(current: SharedPrefs, flow: LayoutPrefs['flow']): PrefsPatch {
  return {
    layout: {
      ...current.layout,
      flow: current.layout.flow === flow ? DEFAULT_PREFS.layout.flow : flow,
    },
  };
}

function toggleSpread(current: SharedPrefs, spread: LayoutPrefs['spread']): PrefsPatch {
  return {
    layout: {
      ...current.layout,
      spread: current.layout.spread === spread ? DEFAULT_PREFS.layout.spread : spread,
    },
  };
}

/**
 * Zoom bounds for the slider only — `ZoomPrefs.level` itself carries no documented range
 * (prefs.ts:70-72 just says "1.0 = 100%"). 50%–300% covers a PDF's useful reading range without
 * inviting a value so extreme `fit * dpr * zoom` (pdf.entry.ts) produces a degenerate canvas.
 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;
const ZOOM_THUMB_SIZE = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Rounds to the nearest step and away from float noise (e.g. 1.7000000000000002). */
function snapToZoomStep(value: number): number {
  return Math.round(clamp(value, ZOOM_MIN, ZOOM_MAX) / ZOOM_STEP) * ZOOM_STEP;
}

/**
 * A minimal drag slider, in RN core only (View/Pressable/PanResponder) — deliberately not a new
 * dependency for a TEMP dev widget. Visual position updates continuously while dragging (so the
 * marker tracks the finger and the number reads live); the actual `prefsStore.savePrefs` commit
 * fires only on release, so a drag does not flood the WebView with a re-render per pixel of finger
 * movement.
 */
function ZoomSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragValue, setDragValue] = useState<number | null>(null);

  // Closes over `trackWidth`/`value` directly (plain render-scope variables, not refs) rather than
  // the ref-sync-in-an-effect idiom used elsewhere in this codebase (e.g. ReaderScreen's
  // appearanceEnvRef) — the newer react-hooks/refs lint rule flags a ref read reachable from a
  // value constructed during render, which PanResponder.create's callbacks would be. Recreating
  // this per `[trackWidth, value]` change is cheap and, since neither changes mid-drag (trackWidth
  // only changes on layout/rotation, and `value` only changes when THIS component's own onCommit
  // below fires, i.e. after a drag ends), the PanResponder's identity is stable for the lifetime of
  // any single gesture — recreating it mid-touch is what would risk dropping the gesture, not this.
  const valueFromX = useCallback((x: number): number => {
    if (trackWidth <= 0) return value;
    const ratio = clamp(x / trackWidth, 0, 1);
    return snapToZoomStep(ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN));
  }, [trackWidth, value]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (evt) => {
          setDragValue(valueFromX(evt.nativeEvent.locationX));
        },
        onPanResponderRelease: (evt) => {
          const next = valueFromX(evt.nativeEvent.locationX);
          setDragValue(null);
          onCommit(next);
        },
        onPanResponderTerminate: () => {
          setDragValue(null);
        },
      }),
    [valueFromX, onCommit],
  );

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const displayValue = dragValue ?? value;
  const ratio = (clamp(displayValue, ZOOM_MIN, ZOOM_MAX) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const thumbLeft = ratio * trackWidth - ZOOM_THUMB_SIZE / 2;

  return (
    <View>
      <Text style={styles.zoomValue}>{Math.round(displayValue * 100)}%</Text>
      <View
        style={styles.zoomTrack}
        onLayout={handleTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.zoomTrackBase} />
        <View style={[styles.zoomTrackFill, { width: `${ratio * 100}%` }]} />
        <View
          style={[styles.zoomThumb, { left: clamp(thumbLeft, -ZOOM_THUMB_SIZE / 2, trackWidth - ZOOM_THUMB_SIZE / 2) }]}
        />
      </View>
    </View>
  );
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

  // Stable across every render of THIS component (empty deps — `zoom.level` is a single-field
  // group, so there is nothing to spread from current prefs), which is what lets ZoomSlider's own
  // PanResponder stay identical for the lifetime of a drag even if a prefs notification lands and
  // re-renders this menu mid-gesture.
  const commitZoom = useCallback((level: number) => {
    void prefsStore.savePrefs({ zoom: { level } });
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

          <Text style={styles.sectionLabel}>Layout</Text>
          <View style={styles.row}>
            {FLOW_OPTIONS.map(({ label, flow }) => {
              const active = prefs.layout.flow === flow;
              return (
                <Pressable
                  key={flow}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Flow: ${label}${active ? ', selected' : ''}`}
                  onPress={() => {
                    void prefsStore.savePrefs(toggleFlow(prefs, flow));
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
          <View style={styles.row}>
            {SPREAD_OPTIONS.map(({ label, spread }) => {
              const active = prefs.layout.spread === spread;
              return (
                <Pressable
                  key={spread}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Spread: ${label}${active ? ', selected' : ''}`}
                  onPress={() => {
                    void prefsStore.savePrefs(toggleSpread(prefs, spread));
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

          <Text style={styles.sectionLabel}>Zoom</Text>
          <ZoomSlider value={prefs.zoom.level} onCommit={commitZoom} />
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
    minWidth: 220,
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

  // The slider. A plain 6px track with a filled portion behind a round thumb — deliberately not
  // trying to look like either platform's native slider, since this is a dev tool, not UI the app
  // ships with.
  zoomValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  zoomTrack: {
    height: 28,
    justifyContent: 'center',
    // Padding, not margin, on the touch target — panHandlers are on THIS view, so the full 28px
    // height (not just the 6px visual track) is draggable, which is what makes the thumb catchable.
  },
  zoomTrackBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e2e2e2',
  },
  zoomTrackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#111111',
  },
  zoomThumb: {
    position: 'absolute',
    width: ZOOM_THUMB_SIZE,
    height: ZOOM_THUMB_SIZE,
    borderRadius: ZOOM_THUMB_SIZE / 2,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#111111',
  },
});
