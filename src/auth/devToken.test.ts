// src/auth/devToken.test.ts
//
// `fetch` IS REPLACED ON THE GLOBAL rather than injected. jest-expo's preset already
// stubs `fetch` with something that resolves to no status at all, so a test here has to
// supply its own regardless — and `devToken.ts` reads the global at call time, which is
// what makes that work. It also keeps the production signature free of a `fetch` option
// that exists only for tests.
//
// The env flag is written per test. Expo substitutes `process.env.EXPO_PUBLIC_*` at
// build time, but under Jest it is an ordinary read, so assigning it is enough.
import { setLicenceToken } from '@config/licence';

import {
  devLicenceToken,
  installDevLicenceToken,
  isDevAuthEnabled,
  resetDevLicenceToken,
} from './devToken';

jest.mock('@config/licence', () => ({ setLicenceToken: jest.fn() }));

const BASE_URL = 'http://localhost:8080';
const MINT_URL = `${BASE_URL}/api/v1/auth/dev-token`;

// The observed window: flambeau's dev token lives 15 minutes.
const TOKEN_TTL_MS = 15 * 60_000;

// Shaped exactly like the response from the running instance, 2 Sep 2026 — except that
// `expiresAt` is RELATIVE TO NOW rather than that day's literal timestamp.
//
// It was the literal at first, and the suite failed forty minutes later: a fixture
// whose expiry is a fixed wall-clock time is in the future when you write it and in the
// past by the afternoon, so "reuses a live token" quietly became "re-mints an expired
// one". The dates that matter to this module are all durations from now, so the fixture
// has to be one too. A test asserting on a specific rendered timestamp passes its own.
function aMint(over: Record<string, unknown> = {}) {
  return {
    token: 'eyJhbGciOiJIUzI1NiJ9.header.signature',
    issuedAt: new Date(Date.now()).toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    ...over,
  };
}

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetDevLicenceToken();
  process.env.EXPO_PUBLIC_DEV_AUTH = '1';
  process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = BASE_URL;
  fetchMock = jest.fn(() => ok(aMint()));
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  // The warnings are the point of several of these paths, but they are noise in the
  // report — asserted where they matter and silenced everywhere. Same for the success
  // line, which exists so a working mint is visible in Metro rather than inferred from
  // the absence of a warning.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_DEV_AUTH;
  delete process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
});

describe('the flag', () => {
  it('is off when unset, and installs nothing', () => {
    delete process.env.EXPO_PUBLIC_DEV_AUTH;

    expect(isDevAuthEnabled()).toBe(false);
    expect(installDevLicenceToken()).toBe(false);
    expect(setLicenceToken).not.toHaveBeenCalled();
  });

  // Anything other than the exact opt-in is off. A build that set DEV_AUTH=false and
  // got a dev token would be the worst possible reading of the flag.
  it.each(['0', 'false', 'true', 'yes', ''])('is off for %p', (value) => {
    process.env.EXPO_PUBLIC_DEV_AUTH = value;

    expect(isDevAuthEnabled()).toBe(false);
    expect(installDevLicenceToken()).toBe(false);
  });

  it('installs the provider when opted in', () => {
    expect(installDevLicenceToken()).toBe(true);
    expect(setLicenceToken).toHaveBeenCalledWith(devLicenceToken);
  });
});

describe('minting', () => {
  it('POSTs the dev-token path and returns the token', async () => {
    await expect(devLicenceToken()).resolves.toBe(aMint().token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(MINT_URL);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  // The whole point of the line: on an Android emulator the first attempt usually
  // fails (localhost is the emulator), so "it worked" has to be positively visible.
  it('reports a successful mint with the expiry', async () => {
    // The one place a literal expiry is right: the assertion is about the rendered
    // string, and it is echoed rather than compared against the clock.
    fetchMock.mockImplementationOnce(() => ok(aMint({ expiresAt: '2027-01-01T00:00:00Z' })));

    await devLicenceToken();

    expect(console.log).toHaveBeenCalledWith(
      'devToken: minted, valid until 2027-01-01T00:00:00.000Z',
    );
  });

  it('tolerates a trailing slash on the base url', async () => {
    process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = `${BASE_URL}//`;

    await devLicenceToken();

    expect(fetchMock.mock.calls[0][0]).toBe(MINT_URL);
  });

  it('mints once for two concurrent callers', async () => {
    const [a, b] = await Promise.all([devLicenceToken(), devLicenceToken()]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a live token rather than minting again', async () => {
    const first = await devLicenceToken();
    const second = await devLicenceToken();

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('expiry', () => {
  // The whole reason the provider is a function rather than a value: the token lives 15
  // minutes and the app outlives it.
  it('re-mints once the cached token is inside the buffer', async () => {
    fetchMock.mockImplementationOnce(() =>
      ok(aMint({ token: 'first', expiresAt: new Date(Date.now() + 10_000).toISOString() })),
    );
    fetchMock.mockImplementationOnce(() => ok(aMint({ token: 'second' })));

    await expect(devLicenceToken()).resolves.toBe('first');
    // No clock is advanced — the first token expires in 10s, which is already inside the
    // 30s buffer, so the second call must not hand it out.
    await expect(devLicenceToken()).resolves.toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches only briefly when expiresAt is missing', async () => {
    fetchMock.mockImplementationOnce(() => ok({ token: 'no-expiry' }));

    await expect(devLicenceToken()).resolves.toBe('no-expiry');
    // Cached against the fallback TTL rather than re-minted every call.
    await expect(devLicenceToken()).resolves.toBe('no-expiry');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches only briefly when expiresAt is unparsable', async () => {
    fetchMock.mockImplementationOnce(() => ok(aMint({ expiresAt: 'not a date' })));

    await expect(devLicenceToken()).resolves.toBe(aMint().token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('failure', () => {
  // Every branch here returns undefined rather than throwing, so the call goes out with
  // no Authorization header and flambeau answers the honest 401 — see the note in
  // ApiLicenceClient.send about why a rejecting token provider is worse.
  it('returns undefined and warns when the base url is unset', async () => {
    delete process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;

    await expect(devLicenceToken()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('EXPO_PUBLIC_FLAMBEAU_BASE_URL is unset'),
    );
  });

  it('returns undefined and warns on a non-2xx', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    );

    await expect(devLicenceToken()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('answered 404'));
  });

  it('returns undefined when the body carries no token', async () => {
    fetchMock.mockImplementationOnce(() => ok({ issuedAt: '2026-09-02T10:45:25Z' }));

    await expect(devLicenceToken()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no 'token' field"));
  });

  it('returns undefined when the server is unreachable', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(devLicenceToken()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not reach'));
  });

  // The usual cause is a server still starting up. Caching the failure would mean one
  // unlucky first call left every later call unauthenticated for the whole session.
  it('does not cache a failure', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(devLicenceToken()).resolves.toBeUndefined();
    await expect(devLicenceToken()).resolves.toBe(aMint().token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
