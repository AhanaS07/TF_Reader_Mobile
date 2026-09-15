// src/auth/defaultAuthClient.test.ts
// Module-level caching means each test needs a fresh module instance —
// jest.resetModules() + require() inside each test gives that, rather than
// a top-level import shared (and thus polluted) across all four tests.
//
// The env var name is repeated as a literal, not held in a shared const used
// for `process.env[...]` access: Expo's babel plugin replaces
// `process.env.EXPO_PUBLIC_*` by matching the literal text at build time, so
// a dynamic `process.env[SOME_VAR]` is a real footgun elsewhere in this repo
// (see config/licence.ts) — the lint rule that catches it applies here too.
const ENV_VAR_NAME = 'EXPO_PUBLIC_FLAMBEAU_BASE_URL';
const originalValue = process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;

afterEach(() => {
  jest.resetModules();
  if (originalValue === undefined) {
    delete process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = originalValue;
  }
});

describe('getDefaultAuthClient', () => {
  it('throws when the base URL env var is unset', () => {
    delete process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
    // A fresh module instance is required at call time, after
    // jest.resetModules(), so this test sees an un-cached client — a static
    // top-level import would share one instance across every test in the file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(() => getDefaultAuthClient()).toThrow(ENV_VAR_NAME);
  });

  it('throws when the base URL env var is blank', () => {
    process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = '   ';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(() => getDefaultAuthClient()).toThrow(ENV_VAR_NAME);
  });

  it('builds an ApiAuthClient when the base URL is set', () => {
    process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = 'http://10.0.2.2:8080';
    // Required fresh from the same post-reset registry as getDefaultAuthClient
    // below, so the instance it builds is actually `instanceof` this class.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiAuthClient } = require('./ApiAuthClient');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(getDefaultAuthClient()).toBeInstanceOf(ApiAuthClient);
  });

  it('returns the same cached instance on a second call', () => {
    process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL = 'http://10.0.2.2:8080';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    const first = getDefaultAuthClient();
    const second = getDefaultAuthClient();

    expect(second).toBe(first);
  });
});
