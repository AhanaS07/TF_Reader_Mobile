// licenseCheck.test.ts — exercises the unified license gate (checkLicense) against mocked
// network calls and mocked contentStore.getPersistedLicenceStatus. Follows the same
// jest.mock + global.fetch pattern as readingSessionClient.test.ts and downloadManager.test.ts.
//
// ONE CALL, NOT TWO (2026-08-23): the real backend has no `POST /api/v1/loans` (confirmed 405 —
// see licenseCheck.ts's header, D-020), so these tests mock only `/api/v1/reading-sessions`.
// `licenceModel`/`canPersist` now travel on the session response itself.

import type { ReadingSessionResponse } from '@/shared/contracts';
import { checkLicense } from './licenseCheck';
import { DownloadError } from './errors';
import { API_BASE_URL } from './config';
import { getPersistedLicenceStatus } from '../encryption/contentStore';
import { verifyLicenceSignature } from '../encryption/licenceSignature';

// ── module mocks ──────────────────────────────────────────────────────────

// Mock device key functions — checkLicense calls these to get the device fingerprint for the
// anti-key-substitution check and licence synthesis.
jest.mock('../encryption/deviceKeypair', () => ({
  generateDeviceKeypair: jest.fn().mockResolvedValue({ publicKey: 'mock-public-key' }),
  publicKeyToRawBase64: jest.fn().mockReturnValue('device-public-key-base64'),
  publicKeyFingerprint: jest.fn().mockResolvedValue('sha256:mock-fingerprint'),
}));

// Mock licence signature — always returns true (the stub). Tests that want to exercise the
// false branch mock the module-level function.
jest.mock('../encryption/licenceSignature', () => ({
  verifyLicenceSignature: jest.fn().mockReturnValue(true),
}));

// Mock contentStore.getPersistedLicenceStatus — only the offline fallback path calls this.
jest.mock('../encryption/contentStore', () => ({
  contentStore: {
    isAvailableOffline: jest.fn().mockResolvedValue(false),
    openSession: jest.fn(),
    decryptBook: jest.fn(),
    close: jest.fn(),
    store: jest.fn(),
    destroy: jest.fn(),
  },
  getPersistedLicenceStatus: jest.fn().mockResolvedValue({ licence: null, expired: false, downloaded: false }),
  MAX_DECRYPTED_BYTES: 25 * 1024 * 1024,
}));

// ── helpers ───────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<ReadingSessionResponse>): ReadingSessionResponse {
  return {
    sessionId: 'session-test-book',
    licenceId: 'loan-test-book',
    itemId: 'test-book',
    licenceModel: 'SUBSCRIPTION',
    canPersist: true,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverTime: new Date().toISOString(),
    content: {
      url: 'http://localhost:4000/fixtures/test-book.epub',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      cipherLength: 5,
      originalLength: 5,
      mimeType: 'application/epub+zip',
    },
    ...overrides,
  };
}

function mockFetchFor(session: ReadingSessionResponse) {
  return jest.fn().mockImplementation(async (url: string) => {
    if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
      return new Response(JSON.stringify(session), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('checkLicense', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns ok:true with mode online on a successful reading-session call', async () => {
    const session = makeSession();
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('online');
    if (result.mode !== 'online') return;
    expect(result.session.sessionId).toBe('session-test-book');
    expect(result.licence.canPersist).toBe(true);
  });

  it('returns ok:true with mode open-access when session.licenceModel is OPEN_ACCESS', async () => {
    const session = makeSession({ licenceModel: 'OPEN_ACCESS', canPersist: true });
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('open-access');
    if (result.mode !== 'open-access') return;
    expect(result.session?.licenceModel).toBe('OPEN_ACCESS');
  });

  it('returns ok:false with reason on fail-closed session denial', async () => {
    const flambeauError = {
      timestamp: new Date().toISOString(),
      status: 403,
      code: 'NO_ENTITLEMENT' as const,
      message: 'No entitlement',
      path: '/api/v1/reading-sessions',
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(flambeauError), { status: 403 }),
    );

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.NO_ENTITLEMENT);
  });

  it('returns DOWNLOAD_NOT_PERMITTED when the server refuses DOWNLOAD intent for an ELITE title', async () => {
    // No client-side downgrade anymore (licenseCheck.ts's header/doc comment) — the caller's
    // requested intent goes straight to the server, and an ELITE refusal surfaces as a real
    // failure rather than being silently retried as STREAM.
    const flambeauError = {
      timestamp: new Date().toISOString(),
      status: 403,
      code: 'DOWNLOAD_NOT_PERMITTED' as const,
      message: 'Download not permitted',
      path: '/api/v1/reading-sessions',
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(flambeauError), { status: 403 }),
    );

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.DOWNLOAD_NOT_PERMITTED);
  });

  it('returns ok:false with reason on fail-closed session denial (device limit)', async () => {
    const flambeauError = {
      timestamp: new Date().toISOString(),
      status: 403,
      code: 'DEVICE_LIMIT_REACHED' as const,
      message: 'Device limit reached',
      path: '/api/v1/reading-sessions',
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(flambeauError), { status: 403 }),
    );

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.DEVICE_LIMIT_REACHED);
  });

  it('returns ok:false with KEY_SUBSTITUTION on key fingerprint mismatch', async () => {
    const session = makeSession({
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'base64wrapped',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyFingerprint: 'sha256:wrong-fingerprint', // mismatch with our mock
      },
    });
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.KEY_SUBSTITUTION);
  });

  it('falls back to offline when the reading-session call fails with a genuine network error', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256' as const, kid: 'test', value: '' },
      },
      expired: false,
      downloaded: true,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
    if (result.mode !== 'offline-license') return;
    expect(result.licence.licenceId).toBe('old-licence');
  });

  it('falls back to offline on a timeout (AbortError), not just a TypeError', async () => {
    // readingSessionClient.ts's own 8s AbortController timer rejects with an AbortError, not a
    // TypeError — isGenuineNetworkError must treat both as "genuinely unreachable".
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256' as const, kid: 'test', value: '' },
      },
      expired: false,
      downloaded: true,
    });
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
  });

  it('returns OFFLINE_LICENSE_UNAVAILABLE when offline and never downloaded', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: null,
      expired: false,
      downloaded: false,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.OFFLINE_LICENSE_UNAVAILABLE);
  });

  it('returns ok:true with mode open-access (no session) when offline and a licence-less open-access book was previously downloaded', async () => {
    // Open access persists with `licence: null` (contentStore.store()'s isElite() comment) —
    // downloaded-but-licence-null must NOT be treated the same as never-downloaded.
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: null,
      expired: false,
      downloaded: true,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'STREAM');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('open-access');
    if (result.mode !== 'open-access') return;
    expect(result.session).toBeUndefined();
    expect(result.licence).toBeUndefined();
  });

  it('returns ENTITLEMENT_EXPIRED when offline and persisted licence is expired', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: '2020-01-01T00:00:00.000Z', // expired
        canPersist: true,
        rights: { print: false },
        signature: { alg: 'RS256' as const, kid: 'test', value: '' },
      },
      expired: true,
      downloaded: true,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_EXPIRED);
  });

  it('returns ok:false when licence signature verification fails', async () => {
    jest.mocked(verifyLicenceSignature).mockReturnValue(false);

    const session = makeSession();
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.KEY_SUBSTITUTION);
  });
});
