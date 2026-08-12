// Exercises deviceKeypair.ts's REAL implementation (no longer a stub) against real RSA-OAEP-256
// math via the Jest manual mock of react-native-quick-crypto (__mocks__/react-native-quick-crypto.js,
// backed by Node's real `crypto`) and the existing react-native-keychain mock
// (__mocks__/react-native-keychain.js, in-memory Map).

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { generateDeviceKeypair, getStoredPrivateKeyRef, wrapBek, unwrapBek } from './deviceKeypair';

// Matches the constant inside deviceKeypair.ts — duplicated here deliberately so tests can reset
// keychain state between cases; deviceKeypair.ts intentionally exposes no "reset" of its own
// (see its header: rotating without a real re-registration flow would orphan wrapped BEKs).
const PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

function randomBek(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

afterEach(async () => {
  await Keychain.resetGenericPassword({ service: PRIVATE_KEY_SERVICE });
});

describe('generateDeviceKeypair', () => {
  it('returns a real PEM-encoded public key, and stores a real PEM private key in the keychain', async () => {
    const { publicKey } = await generateDeviceKeypair();

    expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);

    const stored = await Keychain.getGenericPassword({ service: PRIVATE_KEY_SERVICE });
    expect(stored).not.toBe(false);
    if (stored !== false) {
      expect(stored.password).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    }
  });

  it('is idempotent: a second call returns the SAME public key rather than rotating', async () => {
    const first = await generateDeviceKeypair();
    const second = await generateDeviceKeypair();

    expect(second.publicKey).toBe(first.publicKey);
  });

  it('the returned public key is genuinely derived from the stored private key, not a mismatched pair', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const bek = randomBek();

    // If generateDeviceKeypair's idempotent path derived the WRONG public key (e.g. a stale or
    // freshly-regenerated one instead of the one matching the stored private key), wrapping
    // under it and unwrapping with the stored private key would fail. Round-tripping through
    // both proves they're a real, matching pair.
    const wrapped = await wrapBek(bek, publicKey);
    const unwrapped = await unwrapBek(wrapped);
    expect(Buffer.from(unwrapped).equals(Buffer.from(bek))).toBe(true);
  });
});

describe('getStoredPrivateKeyRef', () => {
  it('rejects when no keypair has been generated yet', async () => {
    await expect(getStoredPrivateKeyRef()).rejects.toThrow(/no device keypair stored/);
  });

  it('returns the keychain service reference once a keypair exists', async () => {
    await generateDeviceKeypair();
    await expect(getStoredPrivateKeyRef()).resolves.toBe(PRIVATE_KEY_SERVICE);
  });
});

describe('wrapBek / unwrapBek round trip (real RSA-OAEP-256)', () => {
  it('wraps and unwraps a 32-byte BEK byte-for-byte', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const bek = randomBek();

    const wrapped = await wrapBek(bek, publicKey);
    expect(typeof wrapped).toBe('string');
    expect(wrapped).not.toBe(''); // base64 of a 2048-bit RSA ciphertext is never empty

    const unwrapped = await unwrapBek(wrapped);
    expect(Buffer.from(unwrapped).equals(Buffer.from(bek))).toBe(true);
  });

  it('produces a different wrapped value each time (OAEP padding is randomized)', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const bek = randomBek();

    const wrappedA = await wrapBek(bek, publicKey);
    const wrappedB = await wrapBek(bek, publicKey);

    expect(wrappedA).not.toBe(wrappedB);
    expect(Buffer.from(await unwrapBek(wrappedA)).equals(Buffer.from(bek))).toBe(true);
    expect(Buffer.from(await unwrapBek(wrappedB)).equals(Buffer.from(bek))).toBe(true);
  });

  it('rejects unwrapBek when no keypair is stored', async () => {
    const bek = randomBek();
    // Wrap under some throwaway keypair the store never saw, so there's a well-formed wrapped
    // value to attempt — the point is unwrapBek's OWN "no keypair" check, not a garbled input.
    const { publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const wrapped = await wrapBek(bek, publicKey);

    await expect(unwrapBek(wrapped)).rejects.toThrow(/no device keypair stored/);
  });

  it('rejects unwrapBek when the wrapped value was wrapped under a DIFFERENT device keypair', async () => {
    await generateDeviceKeypair(); // this device's real stored keypair
    const bek = randomBek();

    const otherDevice = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const wrappedForOtherDevice = await wrapBek(bek, otherDevice.publicKey);

    await expect(unwrapBek(wrappedForOtherDevice)).rejects.toThrow();
  });

  it('rejects wrapBek when the BEK is too large for RSA-OAEP-256 under a 2048-bit key', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const tooLarge = new Uint8Array(300); // far past the ~190-byte OAEP/SHA-256/2048-bit headroom

    await expect(wrapBek(tooLarge, publicKey)).rejects.toThrow();
  });
});
