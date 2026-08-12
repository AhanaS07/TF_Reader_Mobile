import { assertCipherLayout, CipherPayload, NONCE_BYTES, GCM_TAG_BYTES } from './cipherLayout';

function makePayload(originalLength: number, { corruptContent = false } = {}): CipherPayload {
  const cipherLength = NONCE_BYTES + originalLength + GCM_TAG_BYTES;
  const content = new Uint8Array(corruptContent ? cipherLength - 1 : cipherLength);
  return { content, cipherLength, originalLength };
}

describe('assertCipherLayout', () => {
  it('passes when content.length, cipherLength, and 12 + originalLength + 16 all agree', () => {
    expect(() => assertCipherLayout(makePayload(1024))).not.toThrow();
  });

  it('passes for a zero-length plaintext (nonce + tag only)', () => {
    expect(() => assertCipherLayout(makePayload(0))).not.toThrow();
  });

  it('passes for a large whole-book/whole-audio payload (tens of MB)', () => {
    expect(() => assertCipherLayout(makePayload(50 * 1024 * 1024))).not.toThrow();
  });

  it('throws when content.length does not match the recorded cipherLength', () => {
    expect(() => assertCipherLayout(makePayload(1024, { corruptContent: true }))).toThrow(
      /Cipher layout mismatch/
    );
  });

  it('throws when cipherLength matches content but not 12 + originalLength + 16', () => {
    const payload = makePayload(1024);
    payload.originalLength = 999; // cipherLength/content still reflect the old, correct 1024
    expect(() => assertCipherLayout(payload)).toThrow(/Cipher layout mismatch/);
  });
});
