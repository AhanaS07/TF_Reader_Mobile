// Owner: Reader (Ahana). Subject: Download (Abhinav).
//
// `verifyReadingAccess` (src/features/download/readingSessionClient.ts) is the first thing on
// Reader's open path, ahead of the seed and the decrypt. Its fail-open policy: never let a local
// (keychain) or network failure deny access to a book already on the device; fail closed only
// when the server was actually reached and explicitly said access is gone.
//
// These two cases pin that contract from the seam Reader actually depends on, independent of
// readingSessionClient.ts's own unit tests. (A third case — a keychain failure escaping the
// policy's try/catch and making an offline reopen fatal — used to be documented here as a defect
// pinned on purpose; fixed in readingSessionClient.ts, so the case was removed rather than kept
// as dead history — see readingSessionClient.test.ts's own `verifyReadingAccess` coverage for the
// regression test that replaced it.)
//
// Reader's own mitigation for the LATENCY half of the open path — the missing fetch timeout — is
// ReaderScreen's OPEN_TIMEOUT_MS, covered in ReaderScreen.test.tsx.

import { DownloadError } from '@/features/download/errors';
import { verifyReadingAccess } from '@/features/download/readingSessionClient';

// The keychain read that generateDeviceKeypair() performs before anything else. Replaced per-test
// so the failing case is a rejection from the keychain rather than a contrived throw inside
// Download's own code.
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const Keychain = require('react-native-keychain') as {
  getGenericPassword: jest.Mock;
  setGenericPassword: jest.Mock;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('the fail-open policy on Reader’s open path', () => {
  it('covers a keychain failure too — an offline reopen is not fatal', async () => {
    // No network at all, and the keychain itself fails (locked, corrupted stored key, "User
    // interaction is not allowed."). Nothing here is a server saying access is gone, so the only
    // correct verdict is "cannot confirm", which the policy says must allow the read.
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));
    Keychain.getGenericPassword.mockRejectedValue(new Error('User interaction is not allowed.'));

    await expect(verifyReadingAccess('book-on-this-device', 'EPUB')).resolves.toBeUndefined();
  });

  it('does cover a network failure — the read proceeds, as intended', async () => {
    // The contrast case, and the one the policy was written for. Same absent network, working
    // keychain: resolves, and the already-persisted ciphertext is read exactly as before this
    // check existed.
    Keychain.getGenericPassword.mockResolvedValue(false);
    Keychain.setGenericPassword.mockResolvedValue({ service: 'x', storage: 'KeychainStorage' });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    await expect(verifyReadingAccess('book-on-this-device', 'EPUB')).resolves.toBeUndefined();
  });

  it('still fails closed when the server explicitly revokes access', async () => {
    // The half of the policy that must NOT be weakened by any fix to the above: a server that was
    // reached and said no is the one case where refusing to open is correct.
    Keychain.getGenericPassword.mockResolvedValue(false);
    Keychain.setGenericPassword.mockResolvedValue({ service: 'x', storage: 'KeychainStorage' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: 'NO_ENTITLEMENT', message: 'no grant' }),
    });

    await expect(verifyReadingAccess('revoked-book', 'EPUB')).rejects.toMatchObject({
      code: DownloadError.NO_ENTITLEMENT,
    });
  });
});
