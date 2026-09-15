// Owner: Reader (Ahana).
//
// The screen-reader layout override, as pure functions. No React, no react-native, no DOM — so the
// rule below is tested by CALLING it, which is the split CLAUDE.md asks for.
//
// >>> WHY THE READER OVERRIDES A STORED PREFERENCE AT ALL <<<
// epub.js paginates by laying a whole chapter out as one very wide CSS multi-column strip and
// clipping it to the viewport. Android's WebView accessibility bridge cannot compute usable bounds
// for that: WEBVIEW_A11Y_SPIKE.md's F6 found the book's text present in the native accessibility
// node tree with correct content, but the large majority of nodes reporting `bounds=[0,0][0,0]`,
// and F4 recorded the consequence — TalkBack could not reach ANY book content by swipe, by touch
// exploration, or by a targeted touch on the one node that did have real bounds. Scrolled flow uses
// normal document flow with a native scroll, which is the layout Android handles every day.
//
// So this is not a nicety. Paginated flow plus a screen reader is a book that cannot be read at
// all, and the override is what makes the content reachable.
//
// >>> AND WHY IT IS ANNOUNCED RATHER THAN SILENT <<<
// The user set "Paginated". Taking that away without saying so is its own defect, so ReaderScreen
// shows a one-time notice with an opt-out whenever `flowOverrideApplied` reports true, and
// DevPreferencesMenu disables and annotates the Flow/Spread rows for as long as it is in effect.
// This module deliberately exposes that predicate rather than leaving each caller to re-derive
// "did anything actually change" from a before/after comparison.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type { LayoutPrefs } from '@/shared/contracts';

/**
 * Whether the override changes anything, given a stored flow and live screen-reader state.
 *
 * FALSE WHEN THE USER ALREADY CHOSE SCROLLED — nothing was overridden, so there is nothing to
 * explain and no notice to show. That is the distinction the callers need and the reason this is
 * its own function rather than `screenReaderEnabled` inlined at each site.
 */
export function flowOverrideApplied(
  flow: LayoutPrefs['flow'],
  screenReaderEnabled: boolean,
): boolean {
  return screenReaderEnabled && flow === 'paginated';
}

/**
 * The flow the Reader should actually use — for the RN half (the WebView's `scrollEnabled`, the
 * swipe affordances) so it cannot disagree with what the WebView was told.
 */
export function effectiveLayoutFlow(
  flow: LayoutPrefs['flow'],
  screenReaderEnabled: boolean,
): LayoutPrefs['flow'] {
  return flowOverrideApplied(flow, screenReaderEnabled) ? 'scrolled-doc' : flow;
}

/**
 * The same rule applied to a resolved appearance payload, just before it goes over the bridge.
 *
 * RETURNS THE INPUT BY REFERENCE when nothing changes, so a caller can use identity to mean "no
 * override happened" if it wants to — though `flowOverrideApplied` is the predicate to prefer,
 * because it says what it means.
 *
 * `spread` GOES WITH IT, and that coupling is not optional: scrolled flow plus a double-page spread
 * is a state neither renderer can honour, which DevPreferencesMenu.tsx already encodes by resetting
 * one whenever the user picks the other. Overriding `flow` without `spread` would recreate exactly
 * the combination that file exists to prevent.
 */
export function a11yFlowOverride(
  appearance: ReaderAppearance,
  screenReaderEnabled: boolean,
): ReaderAppearance {
  if (!flowOverrideApplied(appearance.flow, screenReaderEnabled)) return appearance;
  return { ...appearance, flow: 'scrolled-doc', spread: 'single' };
}
