// licenseCheck.test.ts — exercises the unified license gate (checkLicense) against mocked
// network calls and mocked contentStore.getPersistedLicenceStatus. Follows the same
// jest.mock + global.fetch pattern as readingSessionClient.test.ts and downloadManager.test.ts.
//
// ONE CALL, NOT TWO (2026-08-23): the real backend has no `POST /api/v1/loans` (confirmed 405 —
// see licenseCheck.ts's header, D-020), so these tests mock only `/api/v1/reading-sessions`.
// `licenceModel`/`canPersist` now travel on the session response itself.

import type { ReadingSessionResponse } from '@/shared/contracts';
import { checkLicense, computeOfflineLicenceExpiry } from './licenseCheck';
import { DownloadError } from './errors';
import { API_BASE_URL } from './config';
import { getPersistedLicenceStatus, invalidateLicence, recordLicenceValidation } from '../encryption/contentStore';
import { downloadStore } from '../sync/stores/downloadStore';

// ── module mocks ──────────────────────────────────────────────────────────

// Mock device key functions — checkLicense calls these to get the device fingerprint for the
// anti-key-substitution check and licence synthesis.
jest.mock('../encryption/deviceKeypair', () => ({
  generateDeviceKeypair: jest.fn().mockResolvedValue({ publicKey: 'mock-public-key' }),
  publicKeyToRawBase64: jest.fn().mockReturnValue('device-public-key-base64'),
  publicKeyFingerprint: jest.fn().mockResolvedValue('sha256:mock-fingerprint'),
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
  getPersistedLicenceStatus: jest.fn().mockResolvedValue({ licence: null, expired: false, downloaded: false, revoked: false, lastValidatedAt: null }),
  invalidateLicence: jest.fn().mockResolvedValue(undefined),
  recordLicenceValidation: jest.fn().mockResolvedValue(undefined),
  MAX_DECRYPTED_BYTES: 25 * 1024 * 1024,
  MAX_AUDIO_DECRYPTED_BYTES: 20 * 1024 * 1024,
  maxDecryptedBytesFor: (format: string) => (format === 'AUDIO' ? 20 * 1024 * 1024 : 25 * 1024 * 1024),
}));

// Mock downloadStore.isBookValid — the offline fallback's pull-based revocation check.
jest.mock('../sync/stores/downloadStore', () => ({
  downloadStore: {
    isBookValid: jest.fn().mockResolvedValue(true),
  },
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
  beforeEach(() => {
    // Reset mocks that individual tests override to their defaults — module-level jest.mock()
    // values persist across tests.
    jest.mocked(downloadStore.isBookValid).mockResolvedValue(true);
    jest.mocked(invalidateLicence).mockResolvedValue(undefined);
    jest.mocked(recordLicenceValidation).mockClear();
  });
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
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
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
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
  });

  it('falls back to offline on a plain Error, not just TypeError/AbortError', async () => {
    // Pins the actual bug: device testing (2026-08-25) found that a real connection-refused on a
    // real iOS simulator does not reliably reject with `instanceof TypeError` — a downloaded
    // SUBSCRIPTION book failed to reopen offline because of exactly this narrowing. Any Error that
    // isn't readingSessionClient.ts's UnmappedServerResponse must count as "genuinely unreachable".
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
  });

  it('does NOT fall back to offline when the server responds, just not in a FlambeauError shape', async () => {
    // The reachable-but-unparseable case (readingSessionClient.ts's UnmappedServerResponse) must
    // stay an explicit denial — the server answered, so a stale local licence would mask a real
    // server-side problem, not route around an outage.
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'old-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: false },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    global.fetch = jest.fn().mockResolvedValue(
      new Response('<html>not json</html>', { status: 500 }),
    );

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.SESSION_FETCH_FAILED);
  });

  it('returns OFFLINE_LICENSE_UNAVAILABLE when offline and never downloaded', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: null,
      expired: false,
      downloaded: false,
      revoked: false,
      lastValidatedAt: null,
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
      revoked: false,
      lastValidatedAt: null,
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
      },
      expired: true,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_EXPIRED);
  });

  // ── 4-day offline cap ──────────────────────────────────────────────────────

  it('returns ENTITLEMENT_EXPIRED when offline and the licence expiresAt is in the past (within the 4-day window)', async () => {
    // The 4-day cap computes `min(now + 4 days, candidateExpiry)`. When the licence's own
    // expiresAt is in the past, it is less than `now + 4 days`, so the effective offline expiry
    // IS the licence's expiresAt — which has already passed.
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'expired-4day-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        canPersist: true,
        rights: { print: true },
      },
      expired: false, // getPersistedLicenceStatus checks this with its own Date.now()
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(), // fresh — candidateExpiry alone drives this test
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_EXPIRED);
  });

  it('returns ok:true when a nearer candidateExpiry (3 days out) is still in the future', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'future-4day-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
        canPersist: true,
        rights: { print: true },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
  });

  it('returns ENTITLEMENT_EXPIRED when the 4-day window has genuinely elapsed since lastValidatedAt', async () => {
    // This is the case the OLD implementation could never actually produce: it anchored the
    // 4-day window on Date.now() AT CHECK TIME, so "now + 4 days" was always in the future no
    // matter how long the book had been sitting offline. Anchoring on the PERSISTED
    // lastValidatedAt instead means a real elapsed window can now genuinely expire it.
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'stale-anchor-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: '9999-12-31T23:59:59.000Z', // far-future — the anchor is what matters here
        canPersist: true,
        rights: { print: true },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // validated 5 days ago
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_EXPIRED);
  });

  it('returns ENTITLEMENT_EXPIRED when there is no recorded lastValidatedAt at all (fails closed, no free grant)', async () => {
    // A meta.json written before this field existed. Must NOT be treated as "just validated" —
    // that would hand every pre-existing download an unearned fresh 4-day window.
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'no-anchor-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: '9999-12-31T23:59:59.000Z',
        canPersist: true,
        rights: { print: true },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: null,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_EXPIRED);
  });

  it('returns ok:true when offline and the far-future licence is within the 4-day rolling window', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'fresh-4day-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: '9999-12-31T23:59:59.000Z',
        canPersist: true,
        rights: { print: true },
      },
      expired: false,
      downloaded: true,
      revoked: false,
      lastValidatedAt: new Date().toISOString(),
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe('offline-license');
  });

  // ── offline revocation ─────────────────────────────────────────────────────

  it('returns ENTITLEMENT_REVOKED when offline and downloadStore.isBookValid is false, and calls invalidateLicence', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: {
        licenceId: 'revoked-licence',
        itemId: 'test-book',
        keyFingerprint: 'sha256:mock-fingerprint',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        canPersist: true,
        rights: { print: true },
      },
      expired: false,
      downloaded: true,
      revoked: false, // not yet revoked in meta — this is the first time we're checking
      lastValidatedAt: new Date().toISOString(),
    });
    jest.mocked(downloadStore.isBookValid).mockResolvedValue(false);
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_REVOKED);
    expect(invalidateLicence).toHaveBeenCalledWith('test-book');
  });

  it('returns ENTITLEMENT_REVOKED when offline and previously invalidated (revoked flag in meta)', async () => {
    jest.mocked(getPersistedLicenceStatus).mockResolvedValue({
      licence: null,
      expired: false,
      downloaded: true,
      revoked: true, // already revoked by a previous open attempt
      lastValidatedAt: null,
    });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(DownloadError.ENTITLEMENT_REVOKED);
  });

  // ── synthesised licence rights ─────────────────────────────────────────────

  it('synthesises licence with rights.print:true for DOWNLOAD intent', async () => {
    const session = makeSession();
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.mode !== 'online') return;
    expect(result.licence.rights.print).toBe(true);
  });

  it('synthesises licence with rights.print:false for STREAM intent', async () => {
    const session = makeSession();
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'STREAM');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.mode !== 'online') return;
    expect(result.licence.rights.print).toBe(false);
  });

  // ── online licence rollover ─────────────────────────────────────────────────

  it('bumps lastValidatedAt (recordLicenceValidation) on a genuine online success', async () => {
    const session = makeSession();
    global.fetch = mockFetchFor(session);

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(true);
    expect(recordLicenceValidation).toHaveBeenCalledWith('test-book');
  });

  it('does NOT call recordLicenceValidation on an explicit denial', async () => {
    const flambeauError = {
      timestamp: new Date().toISOString(),
      status: 403,
      code: 'NO_ENTITLEMENT' as const,
      message: 'No entitlement',
      path: '/api/v1/reading-sessions',
    };
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(flambeauError), { status: 403 }));

    const result = await checkLicense('test-book', 'EPUB', 'DOWNLOAD');

    expect(result.ok).toBe(false);
    expect(recordLicenceValidation).not.toHaveBeenCalled();
  });
});

// ── computeOfflineLicenceExpiry unit tests ────────────────────────────────────

describe('computeOfflineLicenceExpiry', () => {
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;

  it('returns lastValidatedAt+4 days when the candidate expiry is far-future', () => {
    const before = Date.now();
    const result = computeOfflineLicenceExpiry(new Date().toISOString(), '9999-12-31T23:59:59.000Z');
    const after = Date.now();

    expect(result.getTime()).toBeGreaterThanOrEqual(before + fourDaysMs);
    expect(result.getTime()).toBeLessThanOrEqual(after + fourDaysMs);
  });

  it('returns the candidate expiry when it is sooner than lastValidatedAt+4 days', () => {
    const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const result = computeOfflineLicenceExpiry(new Date().toISOString(), twoDaysFromNow.toISOString());

    // Should be approximately 2 days from now (within 1 second tolerance)
    expect(Math.abs(result.getTime() - twoDaysFromNow.getTime())).toBeLessThan(1000);
  });

  it('falls back to lastValidatedAt+4 days when the candidate expiry is malformed', () => {
    const now = new Date().toISOString();
    const result = computeOfflineLicenceExpiry(now, 'not-a-date');

    expect(Math.abs(result.getTime() - (new Date(now).getTime() + fourDaysMs))).toBeLessThan(1000);
  });

  it('ANCHORS ON lastValidatedAt, not Date.now() — this is the bug fix', () => {
    // The old implementation computed `Date.now() + 4 days` INSIDE this function, so it was
    // always ~4 days in the future relative to whenever it happened to be called, no matter how
    // stale the book actually was. Anchoring on a lastValidatedAt from 3 days ago must produce an
    // expiry ~1 day from now, not ~4.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeOfflineLicenceExpiry(threeDaysAgo, '9999-12-31T23:59:59.000Z');
    const oneDayFromNow = Date.now() + 24 * 60 * 60 * 1000;

    expect(Math.abs(result.getTime() - oneDayFromNow)).toBeLessThan(1000);
  });

  it('a later lastValidatedAt (rollover) moves the expiry forward, not just holds it', () => {
    // This is "online licence rollover" at the unit level: checking in again on day 3 of a
    // 4-day window resets the clock to day 3 + 4, not day 0 + 4.
    const day0 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const day3CheckIn = new Date(Date.now());

    const expiryFromDay0 = computeOfflineLicenceExpiry(day0.toISOString(), '9999-12-31T23:59:59.000Z');
    const expiryFromDay3 = computeOfflineLicenceExpiry(day3CheckIn.toISOString(), '9999-12-31T23:59:59.000Z');

    expect(expiryFromDay3.getTime()).toBeGreaterThan(expiryFromDay0.getTime());
    expect(expiryFromDay3.getTime() - expiryFromDay0.getTime()).toBeGreaterThanOrEqual(
      3 * 24 * 60 * 60 * 1000 - 1000,
    );
  });

  it('fails closed (already-expired) when lastValidatedAt is null — no free grant for a missing anchor', () => {
    const result = computeOfflineLicenceExpiry(null, '9999-12-31T23:59:59.000Z');

    expect(result.getTime()).toBeLessThan(Date.now());
  });

  it('fails closed when lastValidatedAt is present but malformed', () => {
    const result = computeOfflineLicenceExpiry('not-a-date-either', '9999-12-31T23:59:59.000Z');

    expect(result.getTime()).toBeLessThan(Date.now());
  });
});
