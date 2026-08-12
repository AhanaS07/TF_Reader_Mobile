// Owner: Sync (Karthik).
//
// Trimmed down from the original standalone prototype (src/features/sync/frontend/) when that
// project was folded into this app as a normal module — the PDF-demo-only exports
// (ASSET_BASE_URL, BOOK_FILE_URL, PDFJS_*) were dropped along with the demo reader that used
// them. Everything below is real sync-engine config, still in use.

import Constants from 'expo-constants';

/**
 * Fixed prototype identity. Every local record and every synced record uses
 * these two values - no random ids anywhere. Overridable so a verification
 * harness can run against its own user without touching the app's data.
 */
export const USER_ID = process.env.EXPO_PUBLIC_USER_ID ?? 'user-001';
export const BOOK_ID = process.env.EXPO_PUBLIC_BOOK_ID ?? 'book-001';

const BACKEND_PORT = 9000;

/**
 * Expo Go runs on a physical device, so "localhost" would mean the phone itself.
 * The dev server's own LAN address is the machine running the backend, so we
 * reuse it and just swap the port.
 */
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

/** Override by setting EXPO_PUBLIC_API_URL, e.g. http://192.168.1.20:9000 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://${resolveBackendHost()}:${BACKEND_PORT}`;

/** Every CRUD collection lives under this prefix on the Mongo backend. */
export const API_V1 = '/api/v1';

/**
 * Set to true once the Mongo services compare `updatedAt` on write and answer
 * 409 when their copy is newer. Until then the device does the comparison
 * itself with a GET before each push, so a stale offline edit cannot overwrite
 * a newer server record.
 */
export const SERVER_RESOLVES_CONFLICTS = false;

/**
 * The Mongo services overwrite `updatedAt` with their own clock on every write:
 * a highlight made offline on Monday and pushed on Thursday is stored as
 * Thursday. The device therefore adopts whatever the server echoes back instead
 * of keeping its own guess - see `adoptPushResult`. Set to false if the request
 * DTOs are changed to store the timestamp as sent, which is the more faithful
 * Last-Write-Wins.
 */
export const SERVER_STAMPS_UPDATED_AT = true;

/**
 * Set to true once the collection GETs accept `?updatedAfter=<iso>`. Until then
 * a pull fetches every record for the user and relies on Last-Write-Wins to
 * discard what the device already has.
 */
export const SUPPORTS_UPDATED_AFTER = false;

/**
 * `PersonalizationRequest` rejects a body without `bookId`, even though
 * personalization is user scoped in the local schema. Until that validation is
 * relaxed the mapper sends {@link BOOK_ID} to satisfy it; nothing reads it back.
 */
export const PERSONALIZATION_REQUIRES_BOOK_ID = true;

/** A validation failure is retried this many times before the op is parked as DEAD. */
export const MAX_PUSH_RETRIES = 6;

/** How long a single network call may take before we treat the device as offline. */
export const REQUEST_TIMEOUT_MS = 8000;
