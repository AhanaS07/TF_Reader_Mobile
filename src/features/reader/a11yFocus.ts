// Owner: Reader (Ahana).
//
// Moving screen-reader focus to a specific element. This is the FIRST focus management in the repo —
// `setAccessibilityFocus` and `findNodeHandle` appear nowhere else — so it is deliberately a shared
// module rather than a local helper inside ReaderScreen.
//
// >>> INTENDED AS THE REFERENCE IMPLEMENTATION, NOT A READER-PRIVATE ONE. <<< Accessibility's focus
// work (VoicePicker's entry focus, and the TOC/search focus-ENTRY items still blocked on the
// on-device VoiceOver/TalkBack spike) should call this rather than grow a second copy in
// `src/features/accessibility/`. Two focus helpers with different null-handling is exactly the kind
// of divergence that makes "focus went somewhere odd" impossible to trace.
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
