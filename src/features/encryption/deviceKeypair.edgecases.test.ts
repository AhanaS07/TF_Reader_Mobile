// Adversarial edge-case coverage for deviceKeypair.ts, deliberately NOT duplicating what
// deviceKeypair.test.ts already covers (basic generate/PEM shape, idempotency, a genuine wrap/
// unwrap round trip, OAEP-randomized-output, unwrapBek rejecting with no keypair / wrong device,
// wrapBek rejecting an oversized BEK).
//
// Same mocking setup as deviceKeypair.test.ts: __mocks__/react-native-quick-crypto.js (real
// Node `crypto` underneath) and __mocks__/react-native-keychain.js (in-memory Map).

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { generateDeviceKeypair, getStoredPrivateKeyRef, wrapBek, unwrapBek } from './deviceKeypair';
import { bytesToBase64 } from './base64';

const PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

function randomBek(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

afterEach(async () => {
  await Keychain.resetGenericPassword({ service: PRIVATE_KEY_SERVICE });
});

describe('wrapBek: BEK length validation', () => {
  // BUG (confirmed, then fixed): unlike aesGcm.ts's encrypt/decrypt (`key.length !== KEY_BYTES`),
  // wrapBek originally had NO length check — RSA-OAEP just encrypts whatever bytes it's given,
  // so any "BEK" up to ~190 bytes wrapped "successfully" even though it wasn't a valid 32-byte
  // AES-256 key (confirmed empirically: 0/1/16/31/33/64/190-byte inputs all wrapped without
  // error). wrapBek now rejects any non-32-byte input up front, matching aesGcm.ts's own pattern.
  it.each([0, 1, 16, 31, 33, 64, 190])('rejects a %i-byte BEK (not the required 32 bytes)', async (len) => {
    const { publicKey } = await generateDeviceKeypair();
    const wrongSizeBek = new Uint8Array(len).fill(7);

    await expect(wrapBek(wrongSizeBek, publicKey)).rejects.toThrow(/must be 32 bytes/);
  });

  it('accepts exactly 32 bytes', async () => {
    const { publicKey } = await generateDeviceKeypair();
    await expect(wrapBek(new Uint8Array(32), publicKey)).resolves.toEqual(expect.any(String));
  });

  it('still rejects an oversized-for-RSA BEK before the length check would even matter (191 > 190-byte OAEP ceiling, and != 32 anyway)', async () => {
    const { publicKey } = await generateDeviceKeypair();
    await expect(wrapBek(new Uint8Array(191), publicKey)).rejects.toThrow();
  });
});

describe('unwrapBek: malformed / mis-sized input', () => {
  it('rejects a wrapped string that is not valid base64', async () => {
    await generateDeviceKeypair();
    await expect(unwrapBek('not-valid-base64!!!***')).rejects.toThrow();
  });

  it('rejects valid base64 that is far too short to be an RSA-2048 ciphertext', async () => {
    await generateDeviceKeypair();
    const tinyPayload = Buffer.from('hi').toString('base64');
    await expect(unwrapBek(tinyPayload)).rejects.toThrow();
  });

  it('rejects valid base64 that is far too long (way over the 256-byte modulus size)', async () => {
    await generateDeviceKeypair();
    const oversizedPayload = Buffer.alloc(1024, 1).toString('base64');
    await expect(unwrapBek(oversizedPayload)).rejects.toThrow();
  });

  it('rejects an empty string', async () => {
    await generateDeviceKeypair();
    await expect(unwrapBek('')).rejects.toThrow();
  });
});

describe('wrapBek / unwrapBek with a non-RSA key', () => {
  it('wrapBek rejects (rather than silently succeeding) when given an EC public key PEM', async () => {
    const ec = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    await expect(wrapBek(randomBek(), ec.publicKey)).rejects.toThrow();
  });
});

describe('generateDeviceKeypair: concurrent calls', () => {
  // BUG (confirmed, then fixed): before deviceKeypair.ts guarded this with an in-flight promise,
  // two concurrent first-time calls would both see "nothing stored" (neither had awaited past its
  // own getGenericPassword check when the other started), both generate their own keypair, and
  // both call setGenericPassword — last write wins in the keychain, but the LOSING call's
  // already-resolved promise still handed back a publicKey that didn't match what ended up
  // stored (empirically observed: aMatches=false, bMatches=true, sameKey=false, before the fix).
  // generateDeviceKeypair() now shares one in-flight operation across overlapping callers, so
  // both resolve to the SAME publicKey, which matches what's actually persisted.
  it('two concurrent first-time calls resolve to the SAME publicKey, matching what is actually stored', async () => {
    const [a, b] = await Promise.all([generateDeviceKeypair(), generateDeviceKeypair()]);

    expect(a.publicKey).toBe(b.publicKey);

    const stored = await Keychain.getGenericPassword({ service: PRIVATE_KEY_SERVICE });
    expect(stored).not.toBe(false);
    const storedPrivateKey = stored !== false ? stored.password : '';
    expect(matchesPrivateKey(a.publicKey, storedPrivateKey)).toBe(true);
  });

  it('N concurrent first-time calls (not just 2) all resolve to the same publicKey', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => generateDeviceKeypair()));
    const distinctKeys = new Set(results.map((r) => r.publicKey));
    expect(distinctKeys.size).toBe(1);
  });

  function matchesPrivateKey(publicKeyPem: string, privateKeyPem: string): boolean {
    const derivedPub = crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }) as string;
    return derivedPub === publicKeyPem;
  }
});

describe('getStoredPrivateKeyRef / generateDeviceKeypair after an out-of-band keychain wipe', () => {
  it('getStoredPrivateKeyRef throws after the private key entry is removed directly (simulating OS keychain wipe / uninstall)', async () => {
    await generateDeviceKeypair();
    await expect(getStoredPrivateKeyRef()).resolves.toBe(PRIVATE_KEY_SERVICE);

    await Keychain.resetGenericPassword({ service: PRIVATE_KEY_SERVICE }); // out-of-band wipe

    await expect(getStoredPrivateKeyRef()).rejects.toThrow(/no device keypair stored/);
  });

  it('generateDeviceKeypair after an out-of-band wipe generates a genuinely NEW keypair, not a confused stale one', async () => {
    const { publicKey: firstPublicKey } = await generateDeviceKeypair();

    await Keychain.resetGenericPassword({ service: PRIVATE_KEY_SERVICE }); // out-of-band wipe

    const { publicKey: secondPublicKey } = await generateDeviceKeypair();

    expect(secondPublicKey).not.toBe(firstPublicKey);

    // The new keypair must be internally consistent (wrap under new pub, unwrap with new priv).
    const bek = randomBek();
    const wrapped = await wrapBek(bek, secondPublicKey);
    const unwrapped = await unwrapBek(wrapped);
    expect(Buffer.from(unwrapped).equals(Buffer.from(bek))).toBe(true);

    // And a value wrapped under the OLD (now-orphaned) public key must NOT unwrap anymore.
    const wrappedUnderOld = await wrapBek(bek, firstPublicKey);
    await expect(unwrapBek(wrappedUnderOld)).rejects.toThrow();
  });
});

describe('wrapBek / unwrapBek: many wraps of the same BEK', () => {
  it('20 independent wraps of the same BEK all unwrap back to the identical bytes', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const bek = randomBek();

    const wrapped = await Promise.all(Array.from({ length: 20 }, () => wrapBek(bek, publicKey)));
    expect(new Set(wrapped).size).toBe(20); // OAEP randomization: no two ciphertexts identical

    const unwrapped = await Promise.all(wrapped.map((w) => unwrapBek(w)));
    for (const u of unwrapped) {
      expect(Buffer.from(u).equals(Buffer.from(bek))).toBe(true);
    }
  });

  it('unwrapping the SAME wrapped value twice (bypassing any cache) yields identical bytes both times', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const bek = randomBek();
    const wrapped = await wrapBek(bek, publicKey);

    const first = await unwrapBek(wrapped);
    const second = await unwrapBek(wrapped);

    expect(Buffer.from(first).equals(Buffer.from(bek))).toBe(true);
    expect(Buffer.from(second).equals(Buffer.from(bek))).toBe(true);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe('wrapBek: zero-length BEK boundary', () => {
  it('rejects a 0-byte "BEK" (RSA-OAEP itself has no minimum plaintext size, but this is never a valid AES-256 key)', async () => {
    const { publicKey } = await generateDeviceKeypair();
    await expect(wrapBek(new Uint8Array(0), publicKey)).rejects.toThrow(/must be 32 bytes/);
  });
});

describe('unwrapBek: rejects a wrapped value that decrypts cleanly but to the wrong length', () => {
  it('rejects when the RSA plaintext underneath is not 32 bytes, even though decryption itself succeeded', async () => {
    // Simulate a wrapped value that was produced by some OTHER wrapping path (e.g. a future
    // wrapBek before this check existed, or a non-BEK value wrapped for some other purpose)
    // that never went through THIS wrapBek's new length guard — bypass it by calling the
    // underlying crypto directly, matching exactly what wrapBek used to allow.
    const { publicKey } = await generateDeviceKeypair();
    const wrongSize = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.alloc(16, 7)
    );
    const wrapped = bytesToBase64(new Uint8Array(wrongSize));

    await expect(unwrapBek(wrapped)).rejects.toThrow(/decrypted key must be 32 bytes/);
  });
});
