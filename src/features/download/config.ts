// Owner: Download (Abhinav).
//
// Mock-backend's own base URL — port 4000, NOT sync/config.ts's port-9000 Mongo backend. The two
// are different servers with unrelated routes (device-key/content-licence/signed-url/seat vs.
// api/v1/{entity} CRUD) — see docs/build-status.md's "network error on both platforms is
// expected" note. Download must not import sync/config.ts's API_BASE_URL; it would silently
// point at the wrong server.
//
// Same LAN-host-resolution reasoning as sync/config.ts: Expo Go/dev-client runs on a physical
// device or simulator, so "localhost" only resolves when the backend runs on the SAME machine
// Metro's own dev server reports as its host.

import Constants from 'expo-constants';

const MOCK_BACKEND_PORT = 4000;

function resolveBackendHost(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    '';

  const host = hostUri.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return host;
  }
  return 'localhost';
}

/** Override by setting EXPO_PUBLIC_MOCK_BACKEND_URL, e.g. http://192.168.1.20:4000 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_MOCK_BACKEND_URL ?? `http://${resolveBackendHost()}:${MOCK_BACKEND_PORT}`;
