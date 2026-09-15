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

import { prefsStore } from '@/features/personalization/prefsStore';
import { readSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

/**
 * Whether the user has switched TTS on.
 *
 * TWO SOURCES, AND BOTH ARE NEEDED. `readSharedPrefs()` is the one-shot seed — it answers "what
 * was stored before this screen mounted", which no subscription can, because `prefsStore` only
 * notifies on a SUBSEQUENT write. `prefsStore.subscribe()` is the live channel — it answers "the
 * user just changed it", which the seed cannot. Dropping either one reintroduces a bug: without
 * the seed the hook reports `false` for a user who enabled TTS in an earlier session, and without
 * the subscription a mid-read toggle does nothing until the book is reopened. `ReaderScreen`'s
 * layout-prefs pair does the same two-part dance for the same reason.
 *
 * WHY THIS MATTERS BEYOND THE TOGGLE'S OWN UI: this boolean is what collapses `ReaderScreen`'s
 * `ttsProvider` memo to `null`, which changes `useTtsSession`'s only dependency, which runs its
 * cleanup — and that cleanup calls `Tts.stop()`. So switching TTS off is what STOPS SPEECH in an
 * open book. It is a kill switch, not just a visibility flag, and the chain runs through here.
 *
 * Only local writes through `prefsStore` notify. A prefs row arriving from Sync does not, BY
 * DESIGN (`prefsStore.subscribe`'s own doc, decided 2026-09-07) — so TTS switched off on another
 * device does not silence this one until the book is reopened. That is deliberate, not a gap:
 * unlike a bookmark or a progress update, silencing speech mid-sentence because of an edit made
 * on a different device is its own surprise, worse than the one it would prevent. The field-level
 * merge still resolves the setting correctly regardless of when anyone re-reads it, so nothing is
 * lost — the reopen just happens to be when this hook re-reads it.
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
    // The seed is a SQLite read racing a user who can toggle before it resolves. If it lands
    // last it would write the pre-toggle value back over the fresh one and silently re-enable
    // TTS the user just switched off. A notification always carries a newer record than a read
    // issued at mount, so once one has arrived the seed has nothing left to say.
    let superseded = false;

    void readSharedPrefs()
      .then((shared) => {
        // The read outlived the component. Setting state here is the classic post-unmount
        // update, and this promise cannot be cancelled.
        if (torn || superseded) return;
        setEnabled(shared.accessibility.tts.enabled);
      })
      .catch(() => {
        // Swallowed on purpose — see the fallback rationale above.
      });

    const unsubscribe = prefsStore.subscribe((fresh) => {
      superseded = true;
      setEnabled(fresh.accessibility.tts.enabled);
    });

    return () => {
      torn = true;
      unsubscribe();
    };
  }, []);

  return enabled;
}
