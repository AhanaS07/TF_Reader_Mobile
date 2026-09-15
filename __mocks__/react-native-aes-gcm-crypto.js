// Jest manual mock for `react-native-aes-gcm-crypto` (root-level __mocks__/, the standard Jest
// convention for mocking a node_modules package — auto-applied to every test, no jest.mock()
// call needed at each call site).
//
// Backed by Node's real `crypto` module (genuine AES-256-GCM, not fake), matching the real
// package's documented input/output shapes exactly: `key`/`content` are base64, `iv`/`tag` are
// hex (see src/features/encryption/aesGcm.ts's header for how those shapes were confirmed).
//
// What this proves: the ADAPTER code in aesGcm.ts (base64/hex conversion, nonce/ciphertext/tag
// assembly, error propagation) is correct, exercised through real AES-256-GCM math. What this
// does NOT prove: that the actual native module (compiled Kotlin/Swift, running on a real
// device) behaves identically — that's still unverified, no simulator/device in this
// environment. Both implement the same public AES-256-GCM spec, so they should agree, but
// "should" isn't "verified."

const crypto = require('crypto');

function encrypt(plainTextBase64, _inBinary, keyBase64) {
  return new Promise((resolve, reject) => {
    try {
      const key = Buffer.from(keyBase64, 'base64');
      const plaintext = Buffer.from(plainTextBase64, 'base64');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      resolve({
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        content: ciphertext.toString('base64'),
      });
    } catch (e) {
      reject(e);
    }
  });
}

function decrypt(ciphertextBase64, keyBase64, ivHex, tagHex, _isBinary) {
  return new Promise((resolve, reject) => {
    try {
      const key = Buffer.from(keyBase64, 'base64');
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      // decipher.final() throws synchronously if the auth tag doesn't verify — caught by the
      // try/catch here and turned into a rejection, same failure mode the real native module's
      // Promise would produce.
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      resolve(plaintext.toString('base64'));
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { encrypt, decrypt };
