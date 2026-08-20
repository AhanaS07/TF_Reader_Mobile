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
