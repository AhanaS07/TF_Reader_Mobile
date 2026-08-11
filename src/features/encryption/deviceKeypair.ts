// Owner: Encryption (Abhinav).
//
// STUB — interfaces only. Nothing in this file is implemented, and it must not fake success.
//
// Device keypair generation, secure private-key storage, and wrapping/unwrapping the per-book
// encryption key (BEK) to/from the device's public key genuinely cannot be built or verified
// without a real device/simulator to run against — there is none in this environment
// (BuildPlan.md Phase 0/1, blocked on P0-1 Expo bootstrap).
//
// CORRECTION (researched 2026-08-11): `react-native-keychain` is installed, but its entire API
// (setGenericPassword/getGenericPassword/setInternetCredentials/etc., checked directly against
// its type definitions) is secure secret STORAGE only — there is no keypair generation and no
// RSA/asymmetric operations anywhere in it. It cannot do RSA-OAEP-256 wrap/unwrap itself. It can
// only securely store the private key string once some OTHER library generates the keypair and
// performs the actual RSA-OAEP operations (candidates to evaluate: a WebCrypto `RSA-OAEP`
// implementation, `react-native-quick-crypto`, or native platform crypto via a small custom
// module) — that library choice is still an open decision, not yet made.
//
// Every function below throws rather than returning a plausible-looking fake value. Do not
// replace these throws with mock/fake data to "unblock" other work — callers need to fail loudly
// until this is genuinely implemented and verified on-device.

/**
 * Generates a device-local asymmetric keypair and persists the private key in secure hardware-
 * backed storage (Keychain/Keystore via react-native-keychain). Returns the public key only.
 *
 * NOT IMPLEMENTED — see file header.
 */
export async function generateDeviceKeypair(): Promise<{ publicKey: string }> {
  throw new Error(
    'Not implemented — requires react-native-keychain + on-device verification (BuildPlan.md Phase 0/1, blocked on P0-1 Expo bootstrap)'
  );
}

/**
 * Returns a reference/handle to the device's stored private key (e.g. a Keychain service/account
 * identifier), for use by the native layer when unwrapping a BEK. Does not return raw key
 * material.
 *
 * NOT IMPLEMENTED — see file header.
 */
export async function getStoredPrivateKeyRef(): Promise<string> {
  throw new Error(
    'Not implemented — requires react-native-keychain + on-device verification (BuildPlan.md Phase 0/1, blocked on P0-1 Expo bootstrap)'
  );
}

/**
 * Wraps (encrypts) a raw book encryption key (BEK) under the given device public key, producing
 * an opaque wrapped-key string suitable for storage/transport.
 *
 * Wrap algorithm: RSA-OAEP-256, per `EncryptionDescriptor.wrapAlgorithm` in
 * src/shared/contracts/content-provider.ts (Ahana, sourced from the wokay backend spec) —
 * previously unconfirmed here, now settled by that canonical contract. Real implementation
 * needs an RSA-OAEP-capable library (NOT react-native-keychain — confirmed to have no
 * asymmetric crypto API at all, see file header); keychain's role is limited to storing the
 * resulting private key. This stub should produce/consume the same base64 shape as
 * `EncryptionDescriptor.wrappedBek`.
 *
 * NOT IMPLEMENTED — see file header.
 *
 * @param bek - raw book encryption key bytes
 * @param publicKey - device public key (as returned by generateDeviceKeypair)
 */
export async function wrapBek(bek: Uint8Array, publicKey: string): Promise<string> {
  throw new Error(
    'Not implemented — requires react-native-keychain + on-device verification (BuildPlan.md Phase 0/1, blocked on P0-1 Expo bootstrap)'
  );
}

/**
 * Unwraps (decrypts) a previously-wrapped BEK using the device's stored private key.
 *
 * Wrap algorithm: RSA-OAEP-256 (see wrapBek above) — no longer an open question.
 *
 * NOT IMPLEMENTED — see file header.
 *
 * @param wrapped - opaque wrapped-key string produced by wrapBek
 */
export async function unwrapBek(wrapped: string): Promise<Uint8Array> {
  throw new Error(
    'Not implemented — requires react-native-keychain + on-device verification (BuildPlan.md Phase 0/1, blocked on P0-1 Expo bootstrap)'
  );
}
