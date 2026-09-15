// Owner: Accessibility (Hruthik).
//
// Pure normalization for the native `tts-progress` event, kept out of ttsEngine.ts (same split as
// ttsRate.ts) so it can be imported and tested without pulling in @iternio/react-native-tts's
// untranspiled TS source — Jest's default transform config cannot parse that package, and
// ttsEngine.ts imports it unconditionally at module scope.

import { Platform } from 'react-native';

/** Character range within the utterance currently speaking, in one platform-independent shape. */
export interface TtsProgressRange {
  start: number;
  end: number;
}

/**
 * Normalizes the native `tts-progress` payload into `{ start, end }` character offsets.
 *
 * NOT REUSING @iternio/react-native-tts's OWN `ProgressEvent` TYPE. It models only
 * `location`/`length` — the iOS shape — and would silently type Android's actual `start`/`end`
 * fields as absent rather than flagging the mismatch. Confirmed against both native sources:
 * `TextToSpeech.m` emits `location`/`length`; `TextToSpeechModule.java` emits `start`/`end` (plus a
 * redundant computed `length` this normalizer ignores).
 */
export function normalizeTtsProgressEvent(event: {
  location?: number;
  length?: number;
  start?: number;
  end?: number;
}): TtsProgressRange {
  if (Platform.OS === 'ios') {
    const start = event.location ?? 0;
    return { start, end: start + (event.length ?? 0) };
  }
  return { start: event.start ?? 0, end: event.end ?? 0 };
}
