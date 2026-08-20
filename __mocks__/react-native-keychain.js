// Jest manual mock for `react-native-keychain` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// In-memory Map keyed by `service` (keyStorage.ts namespaces one service per book), matching the
// real setGenericPassword/getGenericPassword/resetGenericPassword shapes (confirmed against the
// installed package's own type defs, not assumed). What this proves: keyStorage.ts's real
// store/get/delete logic (service namespacing, base64 codec via ./base64.ts) is correct. What it
// does NOT prove: the real hardware-backed keychain's own behavior — that's the on-device
// confirmation already recorded in docs/build-status.md, not something Jest can exercise.
//
// ACCESSIBLE values copied verbatim from the installed package's own enums.d.ts — callers pass
// `Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` etc. as a setGenericPassword option; this
// mock's setGenericPassword ignores the value (no real OS keychain to enforce it against), so it
// only needs to exist, not behave differently per value.
const ACCESSIBLE = {
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  ALWAYS: 'AccessibleAlways',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
};

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

module.exports = { setGenericPassword, getGenericPassword, resetGenericPassword, ACCESSIBLE };
