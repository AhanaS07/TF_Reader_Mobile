// Pure round-trip + tamper-detection tests for licenceSeal.ts, independent of contentStore.ts's
// storage/lifecycle plumbing (that integration is covered in contentStore.edgecases.test.ts's
// "licence seal" describe block instead).

import * as crypto from 'crypto';
import { sealLicence, openSealedLicence } from './licenceSeal';
import type { SignedLicence } from '@/shared/contracts';

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function licenceFor(overrides: Partial<SignedLicence> = {}): SignedLicence {
  return {
    licenceId: 'lic-1',
    itemId: 'book-1',
    keyFingerprint: 'sha256:test-fingerprint',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    canPersist: true,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
    ...overrides,
  };
}

describe('licenceSeal — round trip', () => {
  it('opens to exactly the licence that was sealed', async () => {
    const key = randomKey();
    const licence = licenceFor({ expiresAt: '2030-01-01T00:00:00.000Z' });

    const seal = await sealLicence(licence, key);
    const opened = await openSealedLicence(seal, key);

    expect(opened).toEqual(licence);
  });

  it('produces different ciphertext for two seals of the same licence (random nonce per call)', async () => {
    const key = randomKey();
    const licence = licenceFor();

    const sealA = await sealLicence(licence, key);
    const sealB = await sealLicence(licence, key);

    expect(sealA.content).not.toBe(sealB.content);
    // Both still open correctly — this is randomized-nonce noise, not divergent content.
    expect(await openSealedLicence(sealA, key)).toEqual(licence);
    expect(await openSealedLicence(sealB, key)).toEqual(licence);
  });
});

describe('licenceSeal — tamper detection (this is the whole point of the module)', () => {
  it('returns null when opened under the WRONG key', async () => {
    const licence = licenceFor();
    const seal = await sealLicence(licence, randomKey());

    const opened = await openSealedLicence(seal, randomKey());

    expect(opened).toBeNull();
  });

  it('returns null when the seal content is corrupted (bit-flip inside the ciphertext/tag)', async () => {
    const key = randomKey();
    const seal = await sealLicence(licenceFor(), key);

    const bytes = Buffer.from(seal.content, 'base64');
    bytes[bytes.length - 1] ^= 0xff; // flip a bit inside the GCM tag
    const corrupted = { ...seal, content: bytes.toString('base64') };

    expect(await openSealedLicence(corrupted, key)).toBeNull();
  });

  it('returns null for garbage content that is not a real seal at all', async () => {
    const key = randomKey();

    const opened = await openSealedLicence({ content: 'not-a-real-seal-at-all', originalLength: 999 }, key);

    expect(opened).toBeNull();
  });
});
