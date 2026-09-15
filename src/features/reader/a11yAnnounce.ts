// Owner: Reader (Ahana).
//
// Speaking one line through the screen reader. The one place in this repo that calls
// `announceForAccessibility`, and the one place that decides what an unspeakable message means.
//
// >>> SHARED WITH ACCESSIBILITY, NOT READER-PRIVATE. <<< Deliberate sibling of `a11yFocus.ts`, on
// the same reasoning: two announcement helpers with different empty-string and error handling is
// exactly the divergence that makes "the screen reader said something odd" impossible to trace.
// Accessibility's TTS state/error announcements are specified against this function — see
// READER_ANNOUNCEMENTS.md.
//
// WHAT DOES NOT LIVE HERE: whether to say anything at all. The gates (`announce.pageChanges`,
// `announce.chapterChanges`, and the suppression while TTS is speaking) and the wording are
// `readerAnnouncements.ts`'s, which is pure and testable by being called. This file is the
// transport, and it has no opinions.
//
// WHY A PLAIN FUNCTION AND NOT A HOOK — `a11yFocus.ts`'s argument, unchanged: every caller fires
// this from an event that already happened (a page relocated, prefs were saved), not as a
// consequence of rendering. A hook invites an effect keyed on state, which speaks again on any
// re-render that happens to flip that state, including ones the user did not cause.

import { AccessibilityInfo } from 'react-native';

/**
 * Ask the screen reader to speak `message`, if there is anything to speak.
 *
 * SILENT NO-OP ON A BLANK MESSAGE, which is a normal outcome rather than an error: every caller
 * gets its string from `readerAnnouncements.ts`, whose functions return `null` for "nothing worth
 * saying" — but a trimmed-to-empty string arriving from anywhere else would be spoken by some
 * Android builds as a bare notification tone, which is worse than silence.
 *
 * `queue: false` (iOS only; Android has no equivalent) is the behaviour a reading app wants for
 * navigation: a second page turn should REPLACE a stale "Page 11 of 340" rather than stack behind
 * it, or a fast reader ends up listening to a queue of pages they have already left.
 *
 * Fire-and-forget and NEVER THROWS — the same contract `focusOn` documents, for the same reason.
 * Every call site fires this alongside the real work (turning a page, applying prefs), so letting a
 * native speech failure escape would turn "the reader did not say anything" into "the page did not
 * turn".
 */
export function announce(message: string): void {
  const spoken = message.trim();
  if (spoken === '') return;

  try {
    AccessibilityInfo.announceForAccessibilityWithOptions(spoken, { queue: false });
  } catch {
    // Swallowed to keep the no-throw promise above literally true. See the note above.
  }
}
