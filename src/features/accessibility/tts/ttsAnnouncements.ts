// Owner: Accessibility (Hruthik).
//
// WHAT to say when the TTS session's status changes, or whether to say anything at all. Pure — no
// React, no react-native — mirroring the split `readerAnnouncements.ts` draws for navigation
// announcements: `a11yAnnounce.ts`'s `announce()` is the transport and has no opinions, this file
// has all of them. See READER_ANNOUNCEMENTS.md §5, item 8.
//
// NOT GATED ON "TTS IS SPEAKING" — unlike the navigation announcements in `readerAnnouncements.ts`.
// These announcements are ABOUT the speech; suppressing them while speaking would silence exactly
// the transitions they exist to report.
//
// ONE PLATFORM ASYMMETRY, DOCUMENTED RATHER THAN PAPERED OVER (see useTtsSession.ts's own note on
// the iOS `tts-error` gap) — IT NEEDS NO Platform.OS CHECK HERE, because the runtime already makes
// it structurally impossible rather than merely discouraged:
//   - iOS never reaches 'error' from the engine. `'tts-error'` is absent from
//     `@iternio/react-native-tts`'s iOS `supportedEvents`, so `handleTtsError` never fires there —
//     `next === 'error'` cannot happen on iOS. Returning `null` for it below is for Android's
//     benefit; item 9 (`TtsControls.tsx`) announces the error MESSAGE, not this bare state word.

import type { TtsSessionStatus } from './useTtsSession';

/**
 * What to say when the session's status changed, or null for nothing worth saying.
 *
 * COMPARED AGAINST `previous`, NOT JUST `next`. `updateStatus('speaking')` fires on every
 * sentence's `tts-start`, not only the first — `liveStatus` stays `'speaking'` across an entire
 * run of sentences, so only the FIRST one actually differs from whatever it was before (`'idle'`
 * or `'paused'`). Announcing off the destination status alone would speak "Speaking" before every
 * sentence in the book, which is the over-announcement failure mode this file exists to avoid.
 */
export function ttsStatusAnnouncement(
  previous: TtsSessionStatus,
  next: TtsSessionStatus,
): string | null {
  if (previous === next) return null;

  switch (next) {
    case 'speaking':
      // Distinguishes an iOS resume from a fresh start — same destination status, different fact.
      return previous === 'paused' ? 'Resumed' : 'Speaking';
    case 'paused':
      return 'Paused';
    case 'idle':
      return 'Stopped';
    case 'error':
      return null;
  }
}
