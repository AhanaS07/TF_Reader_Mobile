// /shared/deviceKey.ts
// Device key registration — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Encryption (Abhinav). BuildPlan.md Phase 0.2/4.2: the device generates a keypair,
// keeps the private key in the keychain, and registers only the public key with the server.
// This is the response shape for `POST /device/register-key`.
//
// DRAFT — written against a mock backend, not a confirmed backend contract yet (BuildPlan.md
// Phase 0: "even if backend isn't ready"). Revisit once the real endpoint is published.

export interface DeviceKeyRegistrationRequest {
  deviceId: string;
  publicKey: string; // base64-encoded
}

export interface DeviceKeyRegistrationResponse {
  deviceId: string;
  publicKeyFingerprint: string;
  registeredAt: string; // ISO date string
}
