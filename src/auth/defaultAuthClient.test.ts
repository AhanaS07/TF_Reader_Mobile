// src/auth/defaultAuthClient.test.ts
// Module-level caching means each test needs a fresh module instance —
// jest.resetModules() + require() inside each test gives that, rather than
// a top-level import shared (and thus polluted) across all four tests.

const ENV_VAR = 'EXPO_PUBLIC_FLAMBEAU_BASE_URL';
const originalValue = process.env[ENV_VAR];

afterEach(() => {
  jest.resetModules();
  if (originalValue === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = originalValue;
  }
});

describe('getDefaultAuthClient', () => {
  it('throws when the base URL env var is unset', () => {
    delete process.env[ENV_VAR];
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(() => getDefaultAuthClient()).toThrow(ENV_VAR);
  });

  it('throws when the base URL env var is blank', () => {
    process.env[ENV_VAR] = '   ';
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(() => getDefaultAuthClient()).toThrow(ENV_VAR);
  });

  it('builds an ApiAuthClient when the base URL is set', () => {
    process.env[ENV_VAR] = 'http://10.0.2.2:8080';
    const { ApiAuthClient } = require('./ApiAuthClient');
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    expect(getDefaultAuthClient()).toBeInstanceOf(ApiAuthClient);
  });

  it('returns the same cached instance on a second call', () => {
    process.env[ENV_VAR] = 'http://10.0.2.2:8080';
    const { getDefaultAuthClient } = require('./defaultAuthClient');

    const first = getDefaultAuthClient();
    const second = getDefaultAuthClient();

    expect(second).toBe(first);
  });
});
