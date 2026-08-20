// Owner: Encryption (Abhinav).
//
// REAL implementation — no longer stubbed. Library choice for the RSA-OAEP-256 wrap/unwrap this
// file's own header used to flag as an open decision: `react-native-quick-crypto` (Nitro/JSI,
// "loosely matches Node.js `crypto`" per its own docs). Confirmed by reading the INSTALLED
// package's own generated type defs (node_modules/react-native-quick-crypto/lib/typescript/),
// not assumed: `generateKeyPairSync('rsa', { modulusLength, publicKeyEncoding, privateKeyEncoding
// })`, `publicEncrypt`/`privateDecrypt` with `{ padding: constants.RSA_PKCS1_OAEP_PADDING,
// oaepHash }` are real, Node-crypto-shaped exports of this package — not invented.
//
// Why this library over the alternatives this file used to list: `react-native-keychain` (secure
// STORAGE only, confirmed no asymmetric API — still used below, just for storing the exported
// PEM) and a custom native module (unnecessary now that a maintained one exists) were the other
// two options; WebCrypto RSA-OAEP via `crypto.subtle` is also present in this package (`subtle.ts`)
// but the plain `generateKeyPairSync`/`publicEncrypt`/`privateDecrypt` surface below is a more
// direct match for this file's existing Node-crypto-flavored code style (see aesGcm.ts's original
// version, base64.ts) and needs no async key-import round trip.
//
// HONEST LIMITATION, not glossed over: this is a SOFTWARE (JSI/C++) RSA implementation, not a
// hardware-backed non-exportable key (iOS Secure Enclave / Android StrongBox). The private key
// PEM exists in JS-reachable memory during generation and every unwrapBek() call, then is stored
// as a string in the OS keychain (same trust model already confirmed on-device for BEKs in
// keyStorage.ts) — it is NOT provably impossible to exfiltrate the way a true hardware-backed key
// would be. This satisfies "RSA-OAEP-256 wrap/unwrap the BEK, private key never leaves the
// keychain in normal operation" (Phase 1's done-when); it does not satisfy a hardware-root-of-
// trust threat model, which nothing in this codebase has asked for so far.
//
// modulusLength: 2048. RSA-OAEP with SHA-256 over a 2048-bit key has ~190 bytes of usable
// plaintext headroom (256B key size - 2*32B hash - 2B), comfortably above the 32-byte AES-256 BEK
// this wraps. Not configurable via the frozen contract (EncryptionDescriptor has no modulus-size
// field), so this is a local implementation choice, not a wire-format one.

import { generateKeyPairSync, publicEncrypt, privateDecrypt, createPrivateKey, createPublicKey, createHash, constants } from 'react-native-quick-crypto';
import * as Keychain from 'react-native-keychain';
import { bytesToBase64, base64ToBytes } from './base64';

const MODULUS_LENGTH = 2048;
const OAEP_HASH = 'sha256'; // the "256" in EncryptionDescriptor.wrapAlgorithm 'RSA-OAEP-256'
const PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';
// Matches aesGcm.ts's own (unexported) KEY_BYTES — AES-256 key size. RSA-OAEP-256 itself has no
// opinion on plaintext length (anything up to ~190 bytes under a 2048-bit modulus "wraps" fine),
// so without this check wrapBek would silently accept a wrong-size "BEK" — e.g. 16 or 64 bytes —
// and only fail much later and more confusingly, inside aesGcm.ts's decrypt, or not at all if
// nothing ever tries to decrypt with it. Confirmed via deviceKeypair.edgecases.test.ts.
const BEK_BYTES = 32;

// generateKeyPairSync's TS overloads type the PEM-encoding-requested case as `CryptoKeyPair`
// (WebCrypto CryptoKey objects), but per Node's own documented behavior (which this package
// "loosely matches") — and confirmed by the shape of what it actually returns when
// publicKeyEncoding/privateKeyEncoding with format 'pem' are supplied — the real runtime result
// is a plain { publicKey: string, privateKey: string } PEM pair, not CryptoKey objects. Verified
// in deviceKeypair.test.ts (checks the PEM header), not just assumed from the mismatched types.
interface PemKeyPair {
  publicKey: string;
  privateKey: string;
}

function generateRsaPemKeyPair(): PemKeyPair {
  return generateKeyPairSync('rsa', {
    modulusLength: MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }) as unknown as PemKeyPair;
}

// Two concurrent FIRST-time callers would otherwise both see "nothing stored" (the
// getGenericPassword check below), both generate their own keypair, and both call
// setGenericPassword — last write wins in the keychain, but the LOSING caller's already-resolved
// promise would still hand back a publicKey that no longer matches the private key now stored
// (an orphaned public key: anything wrapped to it can never be unwrapped by this device again).
// Confirmed empirically in deviceKeypair.edgecases.test.ts before this guard existed. Same
// "share one in-flight operation" pattern contentStore.ts already uses for concurrent
// decryptBook() calls (see OpenSession.pending there) — scoped to this module's single process,
// which is all a single device's single keychain needs.
let generationInFlight: Promise<{ publicKey: string }> | null = null;

// TRIED AND REVERTED (2026-08-16): caching the derived public key in a module-level variable
// across calls (not just across CONCURRENT calls, which generationInFlight already covers) would
// save a keychain read + RSA PEM parse on every book open — real, but small next to the network
// timeouts this call sits in front of. Reverted because it broke 5 test suites/13 tests
// (deviceKeypair.test.ts, deviceKeypair.edgecases.test.ts, contentStore.test.ts,
// contentStore.edgecases.test.ts, downloadManager.test.ts): those tests deliberately drive this
// function through different keychain states ACROSS SEQUENTIAL CALLS within one test/module
// instance (simulating rotation, a missing key, a corrupted one) — a cache surviving past the
// in-flight window silently returns a stale key instead of re-reading. Worth revisiting with a
// test-only reset hook if the keychain-read cost ever shows up as a real, measured cost — not
// worth the test-isolation risk on a guess.

/**
 * Generates a device-local RSA-OAEP-256 keypair and persists the private key (PEM, PKCS8) in the
 * device's secure keychain/keystore, via the same react-native-keychain API keyStorage.ts uses
 * for BEKs. Returns the public key (PEM, SPKI) only.
 *
 * Idempotent: if a private key is already stored, this derives and returns its public key
 * instead of generating a fresh keypair. Generating a new keypair unconditionally would silently
 * orphan every BEK already wrapped to the OLD public key (the server has no way to know the
 * device rotated its key) — so a caller that actually wants rotation must explicitly delete the
 * stored key first (deviceKeypair has no exposed "reset" — that's a deliberate choice pushed up
 * to whoever owns the re-registration flow, not decided here).
 *
 * Safe under concurrent calls within this process: overlapping callers share one in-flight
 * generate-or-read operation rather than racing independently (see `generationInFlight` above).
 */
export async function generateDeviceKeypair(): Promise<{ publicKey: string }> {
  if (generationInFlight) return generationInFlight;

  generationInFlight = (async () => {
    try {
      const existing = await Keychain.getGenericPassword({ service: PRIVATE_KEY_SERVICE });
      if (existing !== false) {
        const publicKeyPem = createPublicKey(createPrivateKey(existing.password)).export({
          type: 'spki',
          format: 'pem',
        }) as string;
        return { publicKey: publicKeyPem };
      }

      const { publicKey, privateKey } = generateRsaPemKeyPair();

      // THIS_DEVICE_ONLY: without it, react-native-keychain's default (AFTER_FIRST_UNLOCK, no
      // device binding) lets this private key migrate through an encrypted backup/restore onto a
      // second device — silently defeating the whole point of a per-device keypair (flagged in
      // full-audit-report.md S2). Restoring a backup onto a new device must force a fresh keypair,
      // not carry the old one over.
      const result = await Keychain.setGenericPassword('device-private-key', privateKey, {
        service: PRIVATE_KEY_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (result === false) {
        throw new Error('generateDeviceKeypair: keychain rejected storing the private key');
      }

      return { publicKey };
    } finally {
      generationInFlight = null;
    }
  })();

  return generationInFlight;
}

/**
 * Converts a PEM (SPKI) public key into "base64 of raw key bytes" — the wire shape the real
 * flambeau backend's `ReadingSessionRequest.devicePublicKey` requires (reading-session.ts's own
 * header: "NOT a PEM, NOT a JWK"). A PEM body IS already base64 of the DER bytes, wrapped with a
 * header/footer and line breaks per RFC 7468 — so this is a string strip, not a re-encode: no
 * base64-decode/re-encode round trip, no DER parser dependency. Deliberately NOT what
 * deviceKeyRegistration.ts's (now-unused) `asciiToBytes`+`bytesToBase64` pair did — that
 * base64-encoded the PEM's own ASCII TEXT (headers, footers and newlines included) for the old
 * mock `POST /device/register-key` body, a completely different, non-interoperable wire value.
 *
 * @param publicKeyPem - PEM (SPKI) public key, as returned by generateDeviceKeypair().
 */
export function publicKeyToRawBase64(publicKeyPem: string): string {
  return publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
}

/**
 * SHA-256 fingerprint of the device's own public key, in the "sha256:<hex>" format the real
 * backend uses on EncryptionDescriptor.keyFingerprint/SignedLicence.keyFingerprint. Computed over
 * the RAW DER bytes (same bytes publicKeyToRawBase64 sends on the wire), not the PEM text —
 * hashing the wrong representation would make this "fingerprint of the raw key" claim false even
 * though it would still produce SOME string.
 *
 * This is the ONE PLACE this app decides what its own key's fingerprint is. downloadManager.ts
 * uses this value for SignedLicence.keyFingerprint — NOT the server's own reported
 * EncryptionDescriptor.keyFingerprint — specifically so contentStore.ts's existing
 * `licence.keyFingerprint !== encryption.keyFingerprint` check is comparing two INDEPENDENTLY
 * derived values (ours vs. the server's claim) instead of a value against itself.
 */
export async function publicKeyFingerprint(publicKeyPem: string): Promise<string> {
  const rawBytes = base64ToBytes(publicKeyToRawBase64(publicKeyPem));
  const digestHex = createHash('sha256').update(rawBytes).digest('hex');
  return `sha256:${digestHex}`;
}

/**
 * Returns a reference/handle to the device's stored private key — here, the keychain service
 * name it's namespaced under, NOT the key material itself. Throws if no keypair has been
 * generated yet (nothing to reference).
 */
export async function getStoredPrivateKeyRef(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: PRIVATE_KEY_SERVICE });
  if (existing === false) {
    throw new Error('getStoredPrivateKeyRef: no device keypair stored — call generateDeviceKeypair() first');
  }
  return PRIVATE_KEY_SERVICE;
}

/**
 * Wraps (encrypts) a raw book encryption key (BEK) under the given device public key using
 * RSA-OAEP-256, producing the base64 shape `EncryptionDescriptor.wrappedBek` expects.
 *
 * @param bek - raw book encryption key bytes (32 bytes, AES-256)
 * @param publicKey - device public key PEM, as returned by generateDeviceKeypair()
 */
export async function wrapBek(bek: Uint8Array, publicKey: string): Promise<string> {
  if (bek.length !== BEK_BYTES) {
    throw new Error(`wrapBek: bek must be ${BEK_BYTES} bytes (AES-256), got ${bek.length}`);
  }

  const wrapped = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: OAEP_HASH },
    bek
  );
  return bytesToBase64(Uint8Array.from(wrapped));
}

/**
 * Unwraps (decrypts) a previously-wrapped BEK using the device's stored private key. Rejects if
 * no keypair is stored, or if `wrapped` doesn't decrypt under this device's private key (wrong
 * device, corrupted value, or a key generated after this BEK was wrapped).
 *
 * @param wrapped - opaque base64 wrapped-key string produced by wrapBek (this device or the server)
 */
export async function unwrapBek(wrapped: string): Promise<Uint8Array> {
  const existing = await Keychain.getGenericPassword({ service: PRIVATE_KEY_SERVICE });
  if (existing === false) {
    throw new Error('unwrapBek: no device keypair stored — call generateDeviceKeypair() first');
  }

  const raw = privateDecrypt(
    { key: existing.password, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: OAEP_HASH },
    base64ToBytes(wrapped)
  );
  if (raw.length !== BEK_BYTES) {
    // Surface this HERE, at the unwrap boundary, rather than letting a wrong-size result get
    // cached via keyStorage.storeBek() and only fail later (and more confusingly) inside
    // aesGcm.ts's decrypt. RSA-OAEP's own integrity checks make this exceedingly unlikely for a
    // genuinely-corrupted ciphertext (it would almost always fail padding first) — this guards
    // the case where `wrapped` decrypts cleanly but was never a real 32-byte BEK to begin with.
    throw new Error(`unwrapBek: decrypted key must be ${BEK_BYTES} bytes (AES-256), got ${raw.length}`);
  }
  return Uint8Array.from(raw);
}
