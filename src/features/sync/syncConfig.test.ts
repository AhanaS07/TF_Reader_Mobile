// Exercises resolveBackendHost() indirectly through API_BASE_URL, since it is a private
// function. `syncConfig.ts` computes API_BASE_URL once at module load, so each scenario needs a
// fresh module registry with `expo-constants` mocked before the import.

const BACKEND_PORT = 9000;

function loadApiBaseUrl(constantsShape: Record<string, unknown>): string {
  const original = process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_API_URL;
  let url = '';
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({ __esModule: true, default: constantsShape }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    url = require('./syncConfig').API_BASE_URL;
  });
  if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = original;
  return url;
}

describe('syncConfig.ts resolveBackendHost (via API_BASE_URL)', () => {
  afterEach(() => {
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('falls back to localhost when hostUri is missing entirely', async () => {
    const url = await loadApiBaseUrl({ expoConfig: {}, expoGoConfig: {} });
    expect(url).toBe(`http://localhost:${BACKEND_PORT}`);
  });

  it('falls back to localhost when hostUri is an empty string', async () => {
    const url = await loadApiBaseUrl({ expoConfig: { hostUri: '' }, expoGoConfig: {} });
    expect(url).toBe(`http://localhost:${BACKEND_PORT}`);
  });

  it('falls back to localhost when hostUri is just a bare colon (empty host, empty port)', async () => {
    const url = await loadApiBaseUrl({ expoConfig: { hostUri: ':' }, expoGoConfig: {} });
    expect(url).toBe(`http://localhost:${BACKEND_PORT}`);
  });

  it('falls back to localhost when hostUri starts with a colon (no host before the port)', async () => {
    const url = await loadApiBaseUrl({ expoConfig: { hostUri: ':8081' }, expoGoConfig: {} });
    expect(url).toBe(`http://localhost:${BACKEND_PORT}`);
  });

  it('extracts the real LAN host from a well-formed hostUri', async () => {
    const url = await loadApiBaseUrl({
      expoConfig: { hostUri: '192.168.1.20:8081' },
      expoGoConfig: {},
    });
    expect(url).toBe(`http://192.168.1.20:${BACKEND_PORT}`);
  });

  it('falls back to the debuggerHost when expoConfig has no hostUri at all', async () => {
    const url = await loadApiBaseUrl({
      expoConfig: {},
      expoGoConfig: { debuggerHost: '10.0.0.5:19000' },
    });
    expect(url).toBe(`http://10.0.0.5:${BACKEND_PORT}`);
  });

  it('treats literal "localhost" and "127.0.0.1" hosts the same as missing (still resolves to localhost)', async () => {
    const url1 = await loadApiBaseUrl({ expoConfig: { hostUri: 'localhost:8081' }, expoGoConfig: {} });
    const url2 = await loadApiBaseUrl({ expoConfig: { hostUri: '127.0.0.1:8081' }, expoGoConfig: {} });
    expect(url1).toBe(`http://localhost:${BACKEND_PORT}`);
    expect(url2).toBe(`http://localhost:${BACKEND_PORT}`);
  });
});
