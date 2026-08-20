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

// react-native-webview is a NATIVE module (CAP-7 reader, Ahana). Under Jest there
// is no native runtime, so importing it pulls in a TurboModule/requireNativeComponent
// registration that jest-expo does not shim — the suite fails at IMPORT time, which
// reads as a broken test rather than a missing mock. Anything in the App tree that
// reaches ReaderScreen hits this, including App.test.tsx.
//
// Unlike safe-area-context, react-native-webview ships no official jest mock, so
// this is a hand-rolled stand-in: a plain <View> carrying testID="reader-webview".
// It renders NOTHING and speaks no bridge — the RN<->WebView protocol is only
// exercisable on a device, and pretending otherwise in a unit test would assert
// against the mock instead of the reader. Registered globally rather than per-file
// so nobody has to rediscover the import-time failure.
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (props) => <View testID="reader-webview" {...props} /> };
});
