// Jest manual mock for `react-native-keychain` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// In-memory Map keyed by `service` (keyStorage.ts namespaces one service per book), matching the
// real setGenericPassword/getGenericPassword/resetGenericPassword shapes (confirmed against the
// installed package's own type defs, not assumed). What this proves: keyStorage.ts's real
// store/get/delete logic (service namespacing, base64 codec via ./base64.ts) is correct. What it
// does NOT prove: the real hardware-backed keychain's own behavior — that's the on-device
// confirmation already recorded in docs/build-status.md, not something Jest can exercise.

const store = new Map();

async function setGenericPassword(username, password, options) {
  const service = options && options.service;
  store.set(service, { username, password, service, storage: 'KeychainStorage' });
  return { service, storage: 'KeychainStorage' };
}

async function getGenericPassword(options) {
  const service = options && options.service;
  const entry = store.get(service);
  return entry || false;
}

async function resetGenericPassword(options) {
  const service = options && options.service;
  store.delete(service);
  return true;
}

module.exports = { setGenericPassword, getGenericPassword, resetGenericPassword };
