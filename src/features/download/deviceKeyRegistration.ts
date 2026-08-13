// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 4 item 2: "Generate device keypair (if not already done) and register
// public key with server." generateDeviceKeypair() (encryption/deviceKeypair.ts) already does
// the real keygen + keychain storage — this file adds the missing half: a stable deviceId and
// the actual POST to mock-backend's /device/register-key (see
// mock-backend/routes/deviceKey.js, src/shared/contracts/device-key.ts).
//
// STUB, deliberately: no retry on failure, no persisted "already registered" flag. Every call
// re-generates-or-reuses the keypair (cheap, idempotent — see deviceKeypair.ts's own
// generationInFlight guard) and re-POSTs. Robustness (retry/offline queue) is explicitly out of
// scope — see the design doc's "out of scope" section.
//
// getOrCreateDeviceId() below has a narrow, ACCEPTED race: two concurrent first-time callers
// could each mint a different UUID before either's setGenericPassword lands, and the keychain's
// last-write-wins would leave one of those UUIDs live. Unlike deviceKeypair.ts's equivalent race
// (which orphans wrapped BEKs — real data loss), the consequence here is momentary: the very
// next registration call reads back whichever UUID won and is consistent from then on. Not
// worth a generationInFlight-style guard for a function this file's own header calls a stub.
//
// publicKey is base64-encoded before sending, matching DeviceKeyRegistrationRequest's documented
// wire shape (device-key.ts: "publicKey: string; // base64-encoded"). generateDeviceKeypair()
// returns a PEM string, which is GUARANTEED ASCII (base64 alphabet + "-----BEGIN/END...-----"
// header/footer lines + newlines — no non-ASCII byte ever appears in a PEM), so a direct
// charCodeAt-per-character mapping to bytes is exact, not an approximation — no need for a full
// UTF-8 encoder (React Native's JS runtime has no Buffer and no guaranteed TextEncoder either).
// asciiToBytes() below ASSERTS that assumption rather than relying on it, so a future non-ASCII
// input fails loudly instead of silently sending a corrupted key (see its own comment).

import * as Crypto from 'expo-crypto';
import * as Keychain from 'react-native-keychain';
import type { DeviceKeyRegistrationRequest, DeviceKeyRegistrationResponse } from '@/shared/contracts';
import { generateDeviceKeypair } from '../encryption/deviceKeypair';
import { bytesToBase64 } from '../encryption/base64';
import { API_BASE_URL } from './config';
import { DownloadError, DownloadFailure } from './errors';

const DEVICE_ID_SERVICE = 'tf-reader-device-id';

// Exported for its own test only — nothing outside this module should be encoding strings here.
// Guards the ASCII assumption instead of trusting it: `bytes[i] = code` on a Uint8Array silently
// wraps a code point above 255 (and truncates the high byte of anything 0x80..0xFF's multi-byte
// UTF-8 form would need), so a non-ASCII input would base64-encode to CORRUPT bytes the server
// would accept as a valid-looking public key. Same guard, same reason, as
// encryption/mockSearchIndex.ts's asciiEncode.
export function asciiToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(`asciiToBytes: non-ASCII character at index ${i} (code ${code}) — a PEM public key must be ASCII`);
    }
    bytes[i] = code;
  }
  return bytes;
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: DEVICE_ID_SERVICE });
  if (existing !== false) {
    return existing.password;
  }

  const deviceId = Crypto.randomUUID();
  const result = await Keychain.setGenericPassword('device-id', deviceId, { service: DEVICE_ID_SERVICE });
  if (result === false) {
    throw new DownloadFailure(
      DownloadError.REGISTRATION_FAILED,
      null,
      new Error('getOrCreateDeviceId: keychain rejected storing the deviceId'),
    );
  }
  return deviceId;
}

export async function provisionDeviceKey(): Promise<DeviceKeyRegistrationResponse> {
  const { publicKey } = await generateDeviceKeypair();
  const deviceId = await getOrCreateDeviceId();
  // Typed against the shared contract rather than an inline object literal, so a change to
  // DeviceKeyRegistrationRequest is a compile error here instead of a 400 at runtime.
  const requestBody: DeviceKeyRegistrationRequest = {
    deviceId,
    publicKey: bytesToBase64(asciiToBytes(publicKey)),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/device/register-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (cause) {
    throw new DownloadFailure(DownloadError.REGISTRATION_FAILED, null, cause);
  }
  if (!response.ok) {
    throw new DownloadFailure(
      DownloadError.REGISTRATION_FAILED,
      null,
      new Error(`register-key responded ${response.status}`),
    );
  }
  return (await response.json()) as DeviceKeyRegistrationResponse;
}
