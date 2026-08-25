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
//
// MOCK ↔ REAL FLAG (added per API_CONTRACT_NOTES.md B2's narrower half — the switch mechanism,
// not the cross-capability base-URL unification, which stays undone; see that file). Flipping
// EXPO_PUBLIC_USE_REAL_BACKEND does NOT mean the real backend is safe to point at today: `B1`
// (no auth at all) means every real-backend call still 401s. This flag exists so that once `B1`
// and `C6` close, switching is one env var, not a code edit — it is a structural readiness change,
// not a claim of readiness.

import Constants from 'expo-constants';

const MOCK_BACKEND_PORT = 4000;
// Both published contracts (wokay + flambeau) specify this exact value for everyone — see
// API_CONTRACT_NOTES.md B2. Not configurable by port the way the mock is; a real deployment at a
// different host is expected to be reached via EXPO_PUBLIC_REAL_BACKEND_URL instead.
const REAL_BACKEND_PORT = 8080;

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
const MOCK_BACKEND_URL =
  process.env.EXPO_PUBLIC_MOCK_BACKEND_URL ?? `http://${resolveBackendHost()}:${MOCK_BACKEND_PORT}`;

/** Override by setting EXPO_PUBLIC_REAL_BACKEND_URL, e.g. http://192.168.1.20:8080 */
const REAL_BACKEND_URL = process.env.EXPO_PUBLIC_REAL_BACKEND_URL ?? `http://localhost:${REAL_BACKEND_PORT}`;

/** Defaults to the mock — false unless explicitly set. Flip with EXPO_PUBLIC_USE_REAL_BACKEND=true. */
const USE_REAL_BACKEND = process.env.EXPO_PUBLIC_USE_REAL_BACKEND === 'true';

export const API_BASE_URL = USE_REAL_BACKEND ? REAL_BACKEND_URL : MOCK_BACKEND_URL;

// The mock backend has no auth at all (see B1) and no `/api/v1/auth/*` routes, so attaching a
// bearer token there would just add a header nobody checks. Real-backend calls DO get rejected
// (401 UNAUTHENTICATED) without one — see devAuthToken.ts. Exported rather than duplicating the
// `EXPO_PUBLIC_USE_REAL_BACKEND` read, so the two never drift apart.
export const AUTH_REQUIRED = USE_REAL_BACKEND;
