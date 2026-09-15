// Jest manual mock for `react-native-quick-base64` (root-level __mocks__/, auto-applied — see
// react-native-quick-crypto.js in this same directory for the convention).
//
// WHY THIS IS REQUIRED AND NOT OPTIONAL: the real module's entry point is
// `TurboModuleRegistry.getEnforcing('QuickBase64')`, which THROWS AT IMPORT TIME when the native
// module is not registered. There is no JS fallback. So without this file, merely importing
// readerAssets.ts fails under Jest — which takes App.test.tsx down with it, since it renders <App />
// and that reaches ReaderScreen -> readerAssets.
//
// Backed by Node's real Buffer base64, which is the same implementation base64.ts was originally
// cross-checked against byte-for-byte (see its header). So this is a direct passthrough, not a
// hand-rolled reimplementation.
//
// What this proves: the CALL SHAPE is right — that Reader passes a Uint8Array and gets correctly
// encoded base64 back. What it does NOT prove: that the native C++ implementation agrees on-device.
// Same caveat as every other native-module mock here, and the reason the swap was confirmed with an
// on-device run rather than a green suite.

function fromByteArray(uint8, urlSafe = false) {
  const b64 = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength).toString('base64');
  // The real module's urlSafe mode swaps the two non-alphanumeric characters and strips padding.
  // Mirrored so a caller that starts passing urlSafe does not silently get standard base64 in tests.
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

function toByteArray(b64, removeLinebreaks = false) {
  const cleaned = removeLinebreaks ? b64.replace(/[\r\n]/g, '') : b64;
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

function byteLength(b64) {
  return Buffer.from(b64, 'base64').length;
}

const trimBase64Padding = (str) => str.replace(/=+$/, '');

module.exports = { fromByteArray, toByteArray, byteLength, trimBase64Padding };
