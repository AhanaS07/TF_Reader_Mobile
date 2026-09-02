// jest.setup.js — runs before every test file (package.json → jest.setupFilesAfterEnv).
//
// SafeAreaProvider measures real layout before it renders its children. Under
// Jest there is no layout, so the real provider renders an EMPTY tree and every
// query fails with a confusing "unable to find an element" against a tree that
// shows only <RNCSafeAreaProvider />. Anything rendered inside a screen — which
// is everything, once RootNavigator lands — hits this.
//
// react-native-safe-area-context ships an official mock for exactly this: it
// swaps in a provider with fixed 320x640 metrics and zero insets. Registered
// globally rather than per-file so no one has to rediscover the failure.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// AsyncStorage is a NATIVE module, so under Jest it resolves to null and throws
// "[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null" at IMPORT time — the
// whole suite fails to load, not just the test that touches storage. Any file
// reaching `src/store/institutionStore.ts` (zustand + persist) hits this, which
// now includes CatalogueScreen and therefore App.
//
// The package ships an official in-memory mock for exactly this. Registered
// globally alongside the safe-area one, for the same reason: a module-load
// failure gives no clue that a per-file mock was the missing piece.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-speech-recognition is a NATIVE module too, and fails the same way: under
// Jest it resolves to nothing and throws at IMPORT time, so every suite that
// reaches SearchScreen — including App.test.tsx — fails to load rather than
// failing a test. Screen 11's recogniser lives behind `useVoiceSearch`, so the
// blast radius is anything that renders the Search tab.
//
// Unlike the two above, no official mock ships with the package, so we own one:
// src/search/MockSpeechRecognition.ts. It fakes the native BOUNDARY (the method
// surface and the event stream) and nothing else — a test states the permission
// answer and the events, because those are exactly what a real device decides.
jest.mock('expo-speech-recognition', () => require('./src/search/MockSpeechRecognition'));

// @react-native-community/slider is a native (Fabric) component with the same
// problem: no official jest mock ships with it, so it resolves to nothing under
// Jest and throws at import time. Anything that renders the shared Slider —
// starting with the Typography section — would take its whole suite down.
//
// The fake is a plain View carrying every prop straight through, so
// `fireEvent(slider, 'slidingComplete', value)` reaches `onSlidingComplete`
// exactly as a real thumb release would.
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});

// expo-secure-store is a NATIVE module too, and fails the same way: under
// Jest it resolves to nothing and throws at IMPORT time. secureStorage.ts
// wraps it directly with no injection seam, and App.tsx's boot-time
// bootstrapAuth() call now reaches it on every render of <App />, including
// App.test.tsx.
//
// No official jest mock ships with it, so this fakes the three methods
// secureStorage.ts actually calls, backed by a plain in-memory object — good
// enough for any test that doesn't care about a specific stored value. Tests
// that do (none yet) mock '@store/secureStorage' directly instead, same as
// tokenRefresh.test.ts does.
jest.mock('expo-secure-store', () => {
  const store = {};
  return {
    getItemAsync: async (key) => (key in store ? store[key] : null),
    setItemAsync: async (key, value) => {
      store[key] = value;
    },
    deleteItemAsync: async (key) => {
      delete store[key];
    },
  };
});
