// Jest manual mock for `expo-crypto` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by Node's real `crypto.randomUUID()` — a genuine RFC 4122 v4 UUID, not a fake counter.

const crypto = require('crypto');

module.exports = {
  randomUUID: () => crypto.randomUUID(),
};
