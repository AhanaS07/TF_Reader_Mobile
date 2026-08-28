// Owner: Reader (Ahana).
//
// Whether the user has declined the screen-reader layout override for this reading session.
//
// >>> WHY THIS IS A MODULE AND NOT `useState` IN ReaderScreen <<<
// Two components have to agree about it and neither can pass it to the other. `ReaderScreen` owns
// the decision (it shows the alert), but `DevPreferencesMenu` is what has to reflect it — and the
// menu is not `ReaderScreen`'s child: it arrives through the `toolbarExtra` SLOT, constructed in
// `src/navigation/ReaderRouteScreen.tsx`. A prop would have to be threaded through the navigator to
// reach it. Menu rows disabled for an override that is no longer in effect is exactly the
// "control with nothing to control" that file already refuses.
//
// SAME SHAPE AND SAME SCOPE AS sessionProgress.ts: module state, in memory, gone on relaunch. It is
// deliberately NOT persisted. Reader does not own `accessibility.*`, and "ignore the accessibility
// layout" is not a flag to write into someone's synced preferences on the strength of one alert.
//
// `ReaderScreen` RESETS this on mount, so the choice is scoped to one book-reading session rather
// than to the app process — reopening a book asks again, which is the right default for a decision
// whose whole purpose is to be reconsidered if the book renders badly.

import { useSyncExternalStore } from 'react';

let declined = false;
const listeners = new Set<() => void>();

/** Read outside React (the appearance funnel reads a ref instead; this is for tests and callers). */
export function isOverrideDeclined(): boolean {
  return declined;
}

/** Set the choice and notify every subscriber. A no-op when the value is unchanged. */
export function setOverrideDeclined(value: boolean): void {
  if (declined === value) return;
  declined = value;
  for (const listener of listeners) listener();
}

export function subscribeOverrideChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The choice, as a re-rendering value.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair: both consumers need the SAME
 * value in the same render, and a subscribe-into-local-state version lets one of them paint a frame
 * behind — which here means the menu's rows briefly disagreeing with what the WebView was told.
 */
export function useOverrideDeclined(): boolean {
  return useSyncExternalStore(subscribeOverrideChoice, isOverrideDeclined, isOverrideDeclined);
}
