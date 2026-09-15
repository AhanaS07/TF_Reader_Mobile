// Jest manual mock for `expo-notifications` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// SLEEP TIMER (src/features/reader/audio/sleepTimerNotifications.ts, the ONLY consumer). Native
// module — requiring it unmocked under Jest throws at import time, and because
// sleepTimerNotifications.ts is wired into useAudioPlayerSetup.ts (called app-wide, at App.tsx's
// root), that failure would take down any test that transitively imports it, not just this
// feature's own tests. Same category of gap as this directory's other expo-*/react-native-* native
// module mocks.
//
// A plain stub, not a working scheduler — there is no server-side or Node analogue for "an OS
// delivered a local notification while backgrounded/locked" to fall back on, unlike expo-crypto.js
// in this same directory. Proves the JS call sites are reachable and don't throw; local-notification
// delivery itself (including lock-screen delivery) is confirmed manually, on a real device — see
// SLEEP_TIMER_PLAN.md §10.
//
// Only the members this repo's code actually references (sleepTimerNotifications.ts).

const AndroidImportance = {
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
};

const SchedulableTriggerInputTypes = {
  DATE: 'date',
};

module.exports = {
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: () => Promise.resolve(null),
  requestPermissionsAsync: () => Promise.resolve({ status: 'granted', granted: true }),
  scheduleNotificationAsync: () => Promise.resolve('mock-notification-id'),
  cancelScheduledNotificationAsync: () => Promise.resolve(undefined),
  AndroidImportance,
  SchedulableTriggerInputTypes,
};
