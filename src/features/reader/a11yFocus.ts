// Owner: Reader (Ahana).
//
// Moving screen-reader focus to a specific element. The one place in this repo that calls
// `setAccessibilityFocus`, and the one place that decides what a missing node means.
//
// >>> SHARED WITH ACCESSIBILITY, NOT READER-PRIVATE. <<< Callers are Reader's panels
// (`ReaderScreen.tsx`) and Accessibility's `VoicePicker.tsx` / `TtsControls.tsx`. Those two arrived
// with their own inline copies of this logic and were folded in here; keep it that way. Two focus
// helpers with different null-handling is exactly the kind of divergence that makes "focus went
// somewhere odd" impossible to trace.
//
// WHAT STAYS AT THE CALL SITE: timing. Accessibility's two call sites wrap this in a `setTimeout`
// because a React Native `Modal` attaches its content on a native layer asynchronously, so focusing
// the instant `visible` flips reliably no-ops. That delay is a property of Modal, not of focusing,
// and Reader's inline panels need none of it — so it belongs to whoever has the Modal.
//
// WHY A PLAIN FUNCTION AND NOT A HOOK. Every caller fires it from an event handler that already
// exists — a panel closing, a row being chosen — not as a consequence of rendering. A hook would
// invite an effect keyed on "is the panel open", which moves focus on any re-render that happens to
// flip that flag, including ones the user did not cause.

import { findNodeHandle, AccessibilityInfo } from 'react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';

/**
 * Move screen-reader focus onto `ref`'s element, if there is one.
 *
 * SILENT NO-OP when the ref is empty or the node has no handle, which is the common case rather than
 * an edge case: a ref pointing at a conditionally-rendered control is null whenever that control is
 * unmounted, and `findNodeHandle` returns null for a node that is not currently in the native tree.
 * Neither is an error — the element the caller wanted to focus simply is not on screen — so this
 * never throws and never reports. A caller that could act on the failure would have to re-check the
 * same two conditions to find out what to do.
 *
 * Fire-and-forget: the platform decides when focus actually lands, and neither iOS nor Android
 * acknowledges it back to JS.
 */
export function focusOn(ref: RefObject<View | null>): void {
  const node = ref.current;
  if (node === null) return;

  const handle = findNodeHandle(node);
  if (handle === null) return;

  try {
    AccessibilityInfo.setAccessibilityFocus(handle);
  } catch {
    // Swallowed to keep the no-throw promise above literally true. Every caller fires this from a
    // press handler that goes on to do the real work — closing a panel, navigating to a chapter —
    // so letting a native failure escape would turn "focus did not move" into "the button did
    // nothing". A moved focus ring is a nicety; the navigation behind it is not.
  }
}
