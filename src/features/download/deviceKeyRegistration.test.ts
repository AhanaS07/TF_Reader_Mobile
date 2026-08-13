// Exercises provisionDeviceKey's REAL keygen (via deviceKeypair.ts's real RSA-OAEP-256 math,
// same react-native-quick-crypto manual mock deviceKeypair.test.ts uses) and REAL Keychain
// storage (in-memory Map mock), against a mocked global.fetch for the actual network call — same
// split as contentLicenceClient.test.ts: the wiring and request shape are proven here, the live
// mock-backend integration is proven separately (see the design doc).

import * as Keychain from 'react-native-keychain';
import { provisionDeviceKey } from './deviceKeyRegistration';
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
