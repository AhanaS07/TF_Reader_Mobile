// Owner: Reader (Ahana).
//
// Sources AppearanceEnv's three OS inputs for prefs-application — the RN-facing half of
// applyAppearance. `toReaderAppearance` (readerAppearance.ts) is the resolve seam; this hook feeds
// its `env` argument and re-renders ReaderScreen whenever any of the three changes, which is what
// lets it re-resolve and re-send `applyAppearance` (trigger C in READER_PREFS_APPLICATION.md §5).
//
// KEPT OUT OF ReaderScreen.tsx, deliberately: this owns OS listener lifecycle, not reader state,
// matching the split ReaderWebView.tsx already draws for the WebView side of the same screen.
//
// `osFontScale` HAS NO DEDICATED CHANGE EVENT ON EITHER PLATFORM. It is re-read opportunistically
// whenever the other two listeners fire, which is a known lag rather than an oversight — nothing in
// RN exposes a font-scale-changed event, and polling for one would cost more than the lag is worth.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Appearance, PixelRatio } from 'react-native';

import type { AppearanceEnv } from '@/features/personalization/readerAppearance';

function readEnv(osReduceMotionEnabled: boolean): AppearanceEnv {
  // Appearance.getColorScheme() can report null (not yet known, e.g. very early startup) or
  // Android's 'unspecified' — coalesced to 'light' either way, per AppearanceEnv's own doc comment.
  const scheme = Appearance.getColorScheme();
  return {
    osColorScheme: scheme === 'dark' ? 'dark' : 'light',
    osFontScale: PixelRatio.getFontScale(),
    osReduceMotionEnabled,
  };
}

export function useAppearanceEnv(): AppearanceEnv {
  const [env, setEnv] = useState<AppearanceEnv>(() => readEnv(false));

  useEffect(() => {
    let cancelled = false;

    // The initial reduce-motion read is async; until it resolves, `env` assumes false rather than
    // blocking the first render on it — the same "paint now, correct shortly" trade the reader
    // already makes for prefs themselves (see readerMetrics.ts's pre-payload fallback).
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setEnv(readEnv(enabled));
    });

    const appearanceSubscription = Appearance.addChangeListener(() => {
      setEnv((prev) => readEnv(prev.osReduceMotionEnabled));
    });

    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        setEnv(readEnv(enabled));
      },
    );

    return () => {
      cancelled = true;
      appearanceSubscription.remove();
      reduceMotionSubscription.remove();
    };
  }, []);

  return env;
}
