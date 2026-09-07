// Jest manual mock for `expo-screen-capture` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// jest-expo's preset has no runtime stand-in for this module's native binding, and requiring the
// real package unmocked throws the moment the import graph reaches it (same category of gap as
// this directory's other expo-*/react-native-* native module mocks — expo-audio.js's own header
// has the fuller account of why). Required from the moment anything imports
// `src/features/reader/captureProtection.ts`'s callers: `App.test.tsx` pulls the whole
// `RootNavigator` import graph, so ANY reader/audio file reaching this package needs it mocked
// file-wide, not per-test.
//
// PLAIN STUBS, not backed by real dedupe logic — unlike expo-file-system.js/aesGcm's mocks, there
// is no server-side/Node analogue for "is the screen currently secured" to back this with genuine
// behavior. This proves the JS call sites (`useCaptureProtection.ts`) are reachable and resolve
// without throwing; it does NOT prove the real native module's `activeTags` dedupe or the iOS
// layer-reparenting trick behave correctly — that confirmation is manual, on a real device (see
// the Week-4 screenshot-restriction plan's device-spike section).
//
// Only the members this repo's code actually references. Widen this file in the same change that
// adds a new caller (e.g. `enableAppSwitcherProtectionAsync`/`addScreenshotListener` land with the
// iOS-extras phase, not before), following this directory's own convention of not mocking more of
// a package's surface than something here calls.
module.exports = {
  preventScreenCaptureAsync: () => Promise.resolve(),
  allowScreenCaptureAsync: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(true),
};
