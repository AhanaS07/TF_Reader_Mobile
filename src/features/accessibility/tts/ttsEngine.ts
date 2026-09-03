// Owner: Accessibility (Hruthik).
//
// Single import point for the native TTS module, so a future library swap is a one-line change
// here rather than a search-and-replace. @iternio/react-native-tts is a fork of upstream
// react-native-tts, chosen because upstream does not build on Android against this repo's
// current Gradle toolchain.
//
// THIS IS A NATIVE MODULE. It is already in package.json, but wiring code that imports it for
// the first time still means every existing dev client needs `expo prebuild && expo run:ios` /
// `expo run:android` — importing this file with no dev client rebuilt throws "Cannot find
// native module 'TextToSpeech'" at runtime, not at typecheck time. Android additionally needs
// the `<queries>` manifest entry from `plugins/withAndroidTtsQueries.js` (see app.json), or
// `Tts.voices()` / engine discovery silently returns empty — Android 11+ hides other installed
// packages, including TTS engines, unless the app declares an intent to see them.

import Tts from '@iternio/react-native-tts';

export default Tts;
export type { Voice, TtsError } from '@iternio/react-native-tts';

/**
 * Native events this session subscribes to.
 *
 * `tts-progress` is deliberately excluded. Its payload diverges by platform (iOS:
 * `location`/`length` character offsets into the utterance; Android: `start`/`end`) and this
 * session only implements sentence-level highlighting via `ReaderTextProvider.setSpokenRange`,
 * not word-boundary highlighting — so nothing here would consume it. Add it back only alongside
 * real support for `accessibility.tts.highlightMode === 'word'`.
 *
 * `tts-pause`/`tts-resume` are real events both platforms emit, but are missing from the
 * library's own exported `TtsEvents` type — that's why these are plain string literals
 * subscribed via `addListener` (inherited, untyped) rather than the library's typed
 * `addEventListener` wrapper, which would reject them at compile time.
 *
 * `tts-error` IS NOT SYMMETRIC ACROSS PLATFORMS, unlike everything else listed here. iOS's
 * `supportedEvents` (ios/TextToSpeech/TextToSpeech.m) never declares or emits it —
 * AVSpeechSynthesizerDelegate has no error callback for this library to wire it from — while
 * Android's TextToSpeechModule emits it from UtteranceProgressListener.onError. Calling
 * `addListener('tts-error', ...)` on iOS throws synchronously (RCTEventEmitter validates against
 * `supportedEvents`), so `useTtsSession.ts` skips registering it on iOS rather than catching the
 * throw — see the guard there for the consequence (iOS engine failures never surface as `'error'`
 * status). Kept in this list regardless: it's still a real event Android emits, and the platform
 * gap is documented at the one call site that has to know about it, not by removing it here.
 */
export const TTS_EVENTS = [
  'tts-start',
  'tts-finish',
  'tts-cancel',
  'tts-pause',
  'tts-resume',
  'tts-error',
] as const;

export type TtsEventName = (typeof TTS_EVENTS)[number];
