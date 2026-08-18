// Exercises resolveBackendHost() indirectly through API_BASE_URL (private function), same
// pattern as src/features/sync/config.test.ts. config.ts computes API_BASE_URL once at module
// load, so each scenario needs a fresh module registry with expo-constants mocked before import.

const MOCK_BACKEND_PORT = 4000;

function loadApiBaseUrl(constantsShape: Record<string, unknown>): string {
  const original = process.env.EXPO_PUBLIC_MOCK_BACKEND_URL;
  delete process.env.EXPO_PUBLIC_MOCK_BACKEND_URL;
  let url = '';
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({ __esModule: true, default: constantsShape }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    url = require('./config').API_BASE_URL;
  });
  if (original === undefined) delete process.env.EXPO_PUBLIC_MOCK_BACKEND_URL;
  else process.env.EXPO_PUBLIC_MOCK_BACKEND_URL = original;
  return url;
}

describe('download/config.ts resolveBackendHost (via API_BASE_URL)', () => {
  afterEach(() => {
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('falls back to localhost when hostUri is missing entirely', () => {
    const url = loadApiBaseUrl({ expoConfig: {}, expoGoConfig: {} });
    expect(url).toBe(`http://localhost:${MOCK_BACKEND_PORT}`);
  });

  it('extracts the real LAN host from a well-formed hostUri', () => {
    const url = loadApiBaseUrl({ expoConfig: { hostUri: '192.168.1.20:8081' }, expoGoConfig: {} });
    expect(url).toBe(`http://192.168.1.20:${MOCK_BACKEND_PORT}`);
  });

  it('is overridable via EXPO_PUBLIC_MOCK_BACKEND_URL regardless of hostUri', () => {
    process.env.EXPO_PUBLIC_MOCK_BACKEND_URL = 'http://10.0.0.9:4000';
    let url = '';
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: { hostUri: '192.168.1.20:8081' }, expoGoConfig: {} },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      url = require('./config').API_BASE_URL;
    });
    delete process.env.EXPO_PUBLIC_MOCK_BACKEND_URL;
    expect(url).toBe('http://10.0.0.9:4000');
  });
});

// API_CONTRACT_NOTES.md B2's narrower half: a structural mock<->real switch, not a claim that
// the real backend is safe to point at yet (B1 still means every real call 401s).
describe('download/config.ts USE_REAL_BACKEND flag', () => {
  afterEach(() => {
    jest.dontMock('expo-constants');
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_USE_REAL_BACKEND;
    delete process.env.EXPO_PUBLIC_REAL_BACKEND_URL;
    delete process.env.EXPO_PUBLIC_MOCK_BACKEND_URL;
  });

  function loadWithEnv(env: Record<string, string | undefined>): string {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    let url = '';
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {}, expoGoConfig: {} } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      url = require('./config').API_BASE_URL;
    });
    return url;
  }

  it('defaults to the mock backend when the flag is unset', () => {
    const url = loadWithEnv({});
    expect(url).toBe(`http://localhost:${MOCK_BACKEND_PORT}`);
  });

  it('stays on the mock backend for any value other than the literal string "true"', () => {
    const url = loadWithEnv({ EXPO_PUBLIC_USE_REAL_BACKEND: '1' });
    expect(url).toBe(`http://localhost:${MOCK_BACKEND_PORT}`);
  });

  it('switches to the real backend default (:8080) when the flag is "true"', () => {
    const url = loadWithEnv({ EXPO_PUBLIC_USE_REAL_BACKEND: 'true' });
    expect(url).toBe('http://localhost:8080');
  });

  it('honours EXPO_PUBLIC_REAL_BACKEND_URL when the flag is on', () => {
    const url = loadWithEnv({
      EXPO_PUBLIC_USE_REAL_BACKEND: 'true',
      EXPO_PUBLIC_REAL_BACKEND_URL: 'http://192.168.1.20:8080',
    });
    expect(url).toBe('http://192.168.1.20:8080');
  });

  it('ignores EXPO_PUBLIC_MOCK_BACKEND_URL when the flag is on — the two overrides do not leak into each other', () => {
    const url = loadWithEnv({
      EXPO_PUBLIC_USE_REAL_BACKEND: 'true',
      EXPO_PUBLIC_MOCK_BACKEND_URL: 'http://10.0.0.9:4000',
    });
    expect(url).toBe('http://localhost:8080');
  });
});
