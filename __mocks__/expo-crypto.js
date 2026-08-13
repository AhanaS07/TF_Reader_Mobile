// Jest manual mock for `expo-crypto` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// randomUUID backed by Node's real crypto.randomUUID() — a genuine RFC 4122 v4 UUID, not a fake
// counter. digest backed by Node's real crypto.createHash — genuine SHA-256 (etc.), matching the
// real expo-crypto API's declared shape: digest(algorithm: CryptoDigestAlgorithm, data:
// BufferSource): Promise<ArrayBuffer> (confirmed against the installed package's own type defs,
// node_modules/expo-crypto/build/Crypto.d.ts).

const crypto = require('crypto');

const CryptoDigestAlgorithm = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA384: 'SHA-384',
  SHA512: 'SHA-512',
};

const NODE_ALGO_BY_NAME = {
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};

async function digest(algorithm, data) {
  const nodeAlgo = NODE_ALGO_BY_NAME[algorithm];
  if (!nodeAlgo) {
    throw new Error(`expo-crypto mock: unsupported algorithm "${algorithm}"`);
  }
  const hash = crypto.createHash(nodeAlgo).update(Buffer.from(data)).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
}

module.exports = {
  randomUUID: () => crypto.randomUUID(),
  digest,
  CryptoDigestAlgorithm,
};
