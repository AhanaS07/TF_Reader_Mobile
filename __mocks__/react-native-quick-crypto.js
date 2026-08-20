// Jest manual mock for `react-native-quick-crypto` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by Node's real `crypto` module — genuine RSA key generation, RSA-OAEP encrypt/decrypt,
// and (added 2026-08-18 for aesGcm.ts's swap off react-native-aes-gcm-crypto) genuine AES-256-GCM
// cipher/decipher — not fakes. This works because react-native-quick-crypto's own docs describe it
// as "loosely matching Node.js `crypto`" — every function used here (generateKeyPairSync,
// publicEncrypt, privateDecrypt, createPrivateKey, createPublicKey, createHash, createCipheriv,
// createDecipheriv and constants.RSA_PKCS1_OAEP_PADDING from deviceKeypair.ts and aesGcm.ts, plus
// randomBytes from devContentSeed.ts) exists on Node's real `crypto` with the same signature, so
// this mock is a direct passthrough rather than a hand-rolled reimplementation.
//
// What this proves: deviceKeypair.ts's and aesGcm.ts's own logic (idempotent keypair reuse,
// wrap/unwrap shape, nonce/tag assembly, error propagation) is correct, exercised through real
// RSA-OAEP and AES-256-GCM math. What this does NOT prove: the native (C++/JSI) implementation
// behaves identically on-device — that's a separate, on-device confirmation, same caveat as every
// other native-module mock in this directory.

const crypto = require('crypto');

module.exports = {
  generateKeyPairSync: crypto.generateKeyPairSync,
  publicEncrypt: crypto.publicEncrypt,
  privateDecrypt: crypto.privateDecrypt,
  createPrivateKey: crypto.createPrivateKey,
  createPublicKey: crypto.createPublicKey,
  createHash: crypto.createHash,
  createCipheriv: crypto.createCipheriv,
  createDecipheriv: crypto.createDecipheriv,
  // devContentSeed.ts's BEK. Returns a Buffer, which is a Uint8Array — the shape the caller's
  // Uint8Array.from() expects, so no adaptation is needed for this one either.
  randomBytes: crypto.randomBytes,
  constants: crypto.constants,
};
