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
