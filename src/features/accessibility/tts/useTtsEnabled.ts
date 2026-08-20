// Owner: Accessibility (Hruthik). Consumed by Reader (Ahana).
//
// The TTS master switch, as one boolean — `accessibility.tts.enabled`.
//
// WHY THIS EXISTS AS ITS OWN HOOK. Reader decides *whether and where* the TTS controls appear,
// but `TTS_PROVIDER.md`'s boundary says Reader does not read `AccessibilityPrefs`. Both hold
// only if the answer reaches Reader as a primitive: Reader owns the visibility decision,
// Accessibility keeps owning what the preference means and where it is read from. So this
// returns a boolean and exposes no prefs shape — importing `A11yTtsPrefs` into
// `src/features/reader/**` is the thing it exists to prevent.
//
// NOT A SECOND GATE ON SPEAKING. `useTtsSession` deliberately does not check `enabled` (see the
// note on `play()` there): mounting the controls *is* the decision. This hook is what makes that
// note true — it is the check, and there is exactly one.

import { useEffect, useState } from 'react';

import { readSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

/**
 * Whether the user has switched TTS on.
 *
 * READ ONCE, ON MOUNT — there is no live channel yet. `readSharedPrefs()` is a one-shot SQLite
 * read and nothing publishes prefs changes (`WEBVIEW_BRIDGE.md` schedules the store
 * subscription with the prefs-application stage). In practice that is not yet visible: there is
 * no settings screen to toggle this from mid-read, and `ReaderScreen` is keyed on `bookId`, so
 * opening a different book re-reads. When the subscription lands, this hook is the one place
 * that has to learn about it and no caller changes.
 *
 * Starts at the contract default (`false`) and stays there if the read fails, rather than
 * guessing `true`: a failed read is indistinguishable from first run, and the honest answer to
 * "has this user opted in?" without a stored record is no. Never throws — a caller renders on
 * this, so it cannot have an error path.
 */
export function useTtsEnabled(): boolean {
  const [enabled, setEnabled] = useState(DEFAULT_ACCESSIBILITY_PREFS.tts.enabled);

  useEffect(() => {
    let torn = false;

    void readSharedPrefs()
      .then((shared) => {
        // The read outlived the component. Setting state here is the classic post-unmount
        // update, and this promise cannot be cancelled.
        if (torn) return;
        setEnabled(shared.accessibility.tts.enabled);
      })
      .catch(() => {
        // Swallowed on purpose — see the fallback rationale above.
      });

    return () => {
      torn = true;
    };
  }, []);

  return enabled;
}
