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
