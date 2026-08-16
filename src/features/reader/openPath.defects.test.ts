// Owner: Reader (Ahana). Subject: Download (Abhinav).
//
// >>> THIS FILE ASSERTS BEHAVIOUR THAT IS WRONG ON PURPOSE. <<<
//
// `verifyReadingAccess` (src/features/download/readingSessionClient.ts) is the first thing on
// Reader's open path, ahead of the seed and the decrypt, and it carries an explicit fail-open
// policy in its own comments: "A reader must not lose access to a book already sitting on their
// device just because they're offline right now." Fail CLOSED only for the codes that mean the
// server successfully told us this reader's access is gone.
//
// It does not fully hold. `generateDeviceKeypair()` is awaited OUTSIDE the try/catch that
// implements the policy, so a keychain failure — or a corrupted stored private key, since that
// path also re-parses the PEM on every call — propagates out and is fatal to opening a book whose
// bytes are already on the device. That is the exact outcome the policy exists to prevent, and it
// happens offline, where there is no server to have said anything.
//
// WHY A TEST RATHER THAN A FIX: readingSessionClient.ts is Download's file (see the ownership table
// in CLAUDE.md). The fix is one line — move that await inside the try — and it is Abhinav's call,
// not something to smuggle in from Reader. This pins the current behaviour so the defect is visible
// in CI rather than living in a comment, and pairs it with the case that DOES work so the
// difference is legible.
//
// WHEN THIS FILE GOES RED, THE BUG WAS FIXED. The first test asserts the defect. If it starts
// failing, the fail-open policy now covers the keypair too: delete that test (and this header)
// rather than "repairing" it.
//
// Reader's own mitigation for the LATENCY half of this — the missing fetch timeout — is
// ReaderScreen's OPEN_TIMEOUT_MS, covered in ReaderScreen.test.tsx. It bounds what the reader waits
// for; it cannot make a fatal failure non-fatal, which is why this one still needs Download.

import { DownloadError, DownloadFailure } from '@/features/download/errors';
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
  it('DOES NOT cover a keychain failure — an offline reopen is fatal (DEFECT, Download’s to fix)', async () => {
    // No network at all, so nothing can have revoked anything: the only possible verdict is
    // "cannot confirm", which the policy says must allow the read.
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));
    Keychain.getGenericPassword.mockRejectedValue(new Error('User interaction is not allowed.'));

    // Rejects — so ReaderScreen raises CONTENT_LOAD_FAILED and the book will not open, for a
    // reader holding a fully downloaded copy. `expect.assertions` because a change that makes
    // this resolve must not pass silently through an empty catch.
    expect.assertions(2);
    await expect(verifyReadingAccess('book-on-this-device', 'EPUB')).rejects.toThrow();

    // And it is not even a typed DownloadFailure, so nothing downstream can tell this apart from
    // a corrupt book: ReaderScreen falls through to its generic "Could not open this book" branch.
    await expect(verifyReadingAccess('book-on-this-device', 'EPUB')).rejects.not.toBeInstanceOf(
      DownloadFailure,
    );
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
