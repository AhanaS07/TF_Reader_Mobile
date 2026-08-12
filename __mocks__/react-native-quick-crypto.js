// Jest manual mock for `react-native-quick-crypto` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by Node's real `crypto` module — genuine RSA key generation and RSA-OAEP encrypt/
// decrypt, not fakes. This works because react-native-quick-crypto's own docs describe it as
// "loosely matching Node.js `crypto`" — the functions deviceKeypair.ts actually calls
// (generateKeyPairSync, publicEncrypt, privateDecrypt, createPrivateKey, createPublicKey,
// constants.RSA_PKCS1_OAEP_PADDING) all exist on Node's real `crypto` with the same signatures,
// so this mock is a direct passthrough rather than a hand-rolled reimplementation.
//
// What this proves: deviceKeypair.ts's own logic (idempotent keypair reuse, base64 wrap/unwrap
// shape, error propagation) is correct, exercised through real RSA-OAEP math. What this does NOT
// prove: the native (C++/JSI) implementation behaves identically on-device — that's a separate,
// on-device confirmation, same caveat as every other native-module mock in this directory.

const crypto = require('crypto');

module.exports = {
  generateKeyPairSync: crypto.generateKeyPairSync,
  publicEncrypt: crypto.publicEncrypt,
  privateDecrypt: crypto.privateDecrypt,
  createPrivateKey: crypto.createPrivateKey,
  createPublicKey: crypto.createPublicKey,
  constants: crypto.constants,
};
