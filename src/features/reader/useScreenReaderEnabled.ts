// Owner: Reader (Ahana).
//
// Whether a screen reader (VoiceOver / TalkBack) is running right now. The one place in this repo
// that asks, and the one place that owns the listener lifecycle for it.
//
// SIBLING OF useAppearanceEnv.ts, and deliberately not a fourth field on `AppearanceEnv`.
// `AppearanceEnv` is Personalization's type — it is the input to `toReaderAppearance`, which
// RESOLVES stored preferences into a payload. Screen-reader state resolves nothing: it changes what
// the Reader does with an already-resolved payload, at apply time. Putting it in `AppearanceEnv`
// would put an apply-time decision inside a resolver owned by another capability. See
// readerA11yLayout.ts for what is actually done with this.
//
// WHY THIS IS OBSERVED AT ALL, given the standing rule that Reader does not read `AccessibilityPrefs`:
// this is not a preference. It is live OS device state, the same class of thing
// `useAppearanceEnv` already reads for reduce-motion and colour scheme, and there is no stored pref
// that can stand in for it — a user with TalkBack on has not told us anything through prefs.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Live screen-reader state, `false` until the initial async read resolves.
 *
 * THE OPTIMISTIC FALSE IS THE SAME TRADE `useAppearanceEnv` MAKES for reduce-motion: the first
 * render paints with the plain behaviour and corrects a tick later, rather than blocking the reader
 * on an OS round trip. The correction is cheap here — a screen reader that turns out to be on
 * re-sends `applyAppearance`, which the WebView already handles as a live change.
 */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // `.catch` AND NOT JUST `void`: `void` satisfies no-floating-promises, which is a lint rule about
    // intent, not a runtime handler — a rejection here would still surface as an unhandled promise
    // rejection (a redbox in dev). This is a native call and it can fail on a host where the
    // accessibility manager is unavailable. Staying at `false` is the right answer to "could not
    // find out": the plain paginated reader, which is what shipped before any of this existed.
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (!cancelled) setEnabled(on);
      })
      .catch(() => {
        // Swallowed deliberately — see above.
      });

    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (on: boolean) => {
      setEnabled(on);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return enabled;
}
