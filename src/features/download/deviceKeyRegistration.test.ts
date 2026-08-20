// Exercises provisionDeviceKey's REAL keygen (via deviceKeypair.ts's real RSA-OAEP-256 math,
// same react-native-quick-crypto manual mock deviceKeypair.test.ts uses) and REAL Keychain
// storage (in-memory Map mock), against a mocked global.fetch for the actual network call — same
// split as contentLicenceClient.test.ts: the wiring and request shape are proven here, and the
// live mock-backend integration was manually verified against a live server during development,
// outside this test suite.

import * as Keychain from 'react-native-keychain';
import { asciiToBytes, provisionDeviceKey } from './deviceKeyRegistration';
import { base64ToBytes } from '../encryption/base64';
import { generateDeviceKeypair } from '../encryption/deviceKeypair';
import { DownloadFailure, DownloadError } from './errors';

const PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key'; // matches deviceKeypair.ts's own constant
const DEVICE_ID_SERVICE = 'tf-reader-device-id'; // matches deviceKeyRegistration.ts's own constant

afterEach(async () => {
  await Keychain.resetGenericPassword({ service: PRIVATE_KEY_SERVICE });
  await Keychain.resetGenericPassword({ service: DEVICE_ID_SERVICE });
});

describe('provisionDeviceKey', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs a real generated public key and a freshly minted UUID deviceId', async () => {
    let capturedBody: { deviceId: string; publicKey: string } | null = null;
    global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          deviceId: capturedBody!.deviceId,
          publicKeyFingerprint: 'sha256:test-fingerprint',
          registeredAt: new Date().toISOString(),
        }),
        { status: 200 },
      );
    });

    const result = await provisionDeviceKey();

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(typeof capturedBody!.publicKey).toBe('string');
    expect(capturedBody!.publicKey.length).toBeGreaterThan(0);
    expect(result.deviceId).toBe(capturedBody!.deviceId);

    // Round-trip the wire value all the way back to a string and compare it to the PEM
    // generateDeviceKeypair actually hands out. This pins the asciiToBytes -> bytesToBase64
    // composition end-to-end; "some non-empty string was sent" would pass even if the encoding
    // silently mangled every byte. generateDeviceKeypair is idempotent, so this second call
    // returns the same public key provisionDeviceKey just sent, not a fresh keypair.
    const { publicKey } = await generateDeviceKeypair();
    const decoded = String.fromCharCode(...base64ToBytes(capturedBody!.publicKey));
    expect(decoded).toBe(publicKey);
    expect(decoded).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('rejects a non-ASCII public key rather than silently truncating it to corrupt bytes', () => {
    // asciiToBytes is the composition's first half. A real PEM is always ASCII (base64 alphabet +
    // the BEGIN/END lines), so this guard can only be exercised by calling it directly — but
    // without it `bytes[i] = code` wraps modulo 256 and the server would happily accept a
    // valid-looking, permanently-wrong public key.
    expect(() => asciiToBytes('-----BEGIN PUBLIC KEY-----\nMIIBIjAN\u00e9\n')).toThrow(
      /non-ASCII character at index 35 \(code 233\)/,
    );
    // A code point that would wrap to a plausible-looking byte is caught too, not just accented
    // Latin-1: U+0141 & 0xff === 0x41 === 'A', a perfectly legal base64 character.
    expect(() => asciiToBytes('\u0141')).toThrow(/non-ASCII/);
    // The boundary is 0x7f itself: 0x7f encodes fine, 0x80 does not.
    expect(Array.from(asciiToBytes('\u007f'))).toEqual([0x7f]);
    expect(() => asciiToBytes('\u0080')).toThrow(/non-ASCII/);
  });

  it('reuses the SAME deviceId across two calls — persisted, not a fresh UUID every time', async () => {
    global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ deviceId: body.deviceId, publicKeyFingerprint: 'x', registeredAt: new Date().toISOString() }),
        { status: 200 },
      );
    });

    const first = await provisionDeviceKey();
    const second = await provisionDeviceKey();

    expect(second.deviceId).toBe(first.deviceId);
  });

  it('throws DownloadFailure(REGISTRATION_FAILED) when the server errors', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }));

    await expect(provisionDeviceKey()).rejects.toMatchObject({
      code: DownloadError.REGISTRATION_FAILED,
    });
  });

  it('throws DownloadFailure(REGISTRATION_FAILED) when fetch itself rejects (offline)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(provisionDeviceKey()).rejects.toBeInstanceOf(DownloadFailure);
  });
});
