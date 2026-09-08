// Owner: Accessibility (Hruthik). Consumed by Reader (Ahana).
//
// Whether motion should currently be suppressed — the resolved boolean, not the raw tri-state
// preference. `accessibility.display.reduceMotion` alone cannot answer this: 'system' means "ask
// the OS", so a consumer reading the stored value directly would not know whether to suppress a
// page-turn animation. `resolveReduceMotion` (shared/contracts/accessibility.ts) is the frozen
// resolver; this hook is the one place that feeds it both real inputs and hands Reader the answer.
//
// TWO SOURCES ON TOP OF THE USUAL TWO. Same seed (`prefsStore.getPrefs`) + live
// (`prefsStore.subscribe`) pair every hook in this file uses for the stored preference, PLUS the
// OS signal (`AccessibilityInfo.isReduceMotionEnabled()` / `reduceMotionChanged`) — the same RN
// API `useAppearanceEnv.ts` already reads for its own, separate purpose. Both are tracked
// independently and re-resolved together on every change to either.
//
// Goes through `prefsStore` for BOTH the seed and the live channel, never `sharedPrefs.ts`
// directly — see `accessibility-db-functions-for-hrithik.md`'s import rule. `getPrefs()` is a
// thin delegate to `readSharedPrefs()`, so this is the same read, just through the sanctioned seam.
//
// Starts resolved against `false` OS state and the contract default ('system' -> false) — the
// least-surprising initial guess (motion allowed) until both real reads land. Never throws — a
// caller renders on this.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_ACCESSIBILITY_PREFS, resolveReduceMotion } from '@/shared/contracts';
import type { ReduceMotion } from '@/shared/contracts';

export function useReduceMotion(): boolean {
  const [preference, setPreference] = useState<ReduceMotion>(
    DEFAULT_ACCESSIBILITY_PREFS.display.reduceMotion,
  );
  const [osReduceMotionEnabled, setOsReduceMotionEnabled] = useState(false);

  useEffect(() => {
    let torn = false;
    // A notification always carries a newer record than a read issued at mount, so once one has
    // arrived the seed has nothing left to say — see useTtsEnabled.ts's identical note.
    let superseded = false;

    void prefsStore
      .getPrefs()
      .then((shared) => {
        if (torn || superseded) return;
        setPreference(shared.accessibility.display.reduceMotion);
      })
      .catch(() => {
        // Swallowed on purpose — a failed read is indistinguishable from first run, and the
        // honest default is the contract default, already the initial state.
      });

    const unsubscribe = prefsStore.subscribe((fresh) => {
      superseded = true;
      setPreference(fresh.accessibility.display.reduceMotion);
    });

    return () => {
      torn = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setOsReduceMotionEnabled(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setOsReduceMotionEnabled(enabled),
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return resolveReduceMotion(preference, osReduceMotionEnabled);
}
