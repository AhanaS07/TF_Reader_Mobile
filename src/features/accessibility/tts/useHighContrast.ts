// Owner: Accessibility (Hruthik).
//
// Whether the user has switched high contrast on — `accessibility.display.highContrast`.
//
// Same seed-then-subscribe shape as useTtsEnabled.ts, for the same reason: readSharedPrefs() is
// the one-shot answer to "what was stored before this screen mounted", which no subscription can
// give, and prefsStore.subscribe() is the live answer to "the user just changed it". Kept as its
// own hook rather than importing AccessibilitySettingsPanel's useAccessibilityPrefs() (the whole
// AccessibilityPrefs slice) because TtsControls/VoicePicker only ever need this one boolean.
//
// Starts at the contract default (`false`) and stays there if the read fails — a failed read is
// indistinguishable from first run, and the honest answer without a stored record is no contrast
// override. Never throws — callers render on this.

import { useEffect, useState } from 'react';

import { prefsStore } from '@/features/personalization/prefsStore';
import { readSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

export function useHighContrast(): boolean {
  const [highContrast, setHighContrast] = useState(DEFAULT_ACCESSIBILITY_PREFS.display.highContrast);

  useEffect(() => {
    let torn = false;
    // A notification always carries a newer record than a read issued at mount, so once one has
    // arrived the seed has nothing left to say — see useTtsEnabled.ts's identical note.
    let superseded = false;

    void readSharedPrefs()
      .then((shared) => {
        if (torn || superseded) return;
        setHighContrast(shared.accessibility.display.highContrast);
      })
      .catch(() => {
        // Swallowed on purpose — see the fallback rationale above.
      });

    const unsubscribe = prefsStore.subscribe((fresh) => {
      superseded = true;
      setHighContrast(fresh.accessibility.display.highContrast);
    });

    return () => {
      torn = true;
      unsubscribe();
    };
  }, []);

  return highContrast;
}
