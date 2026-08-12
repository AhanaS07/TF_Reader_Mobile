import Constants from 'expo-constants';

/**
 * Fixed prototype identity. Every local record and every synced record uses
 * these two values - no random ids anywhere. Overridable so the verification
 * harness can run against its own user without touching the app's data.
 */
export const USER_ID = process.env.EXPO_PUBLIC_USER_ID ?? 'user-001';
export const BOOK_ID = process.env.EXPO_PUBLIC_BOOK_ID ?? 'book-001';

const BACKEND_PORT = 9000;

/**
 * The book file and the pdf.js runtime are static resources, not CRUD, and the
 * Mongo backend does not serve them - `/api/books/{id}/file` is a 404 on 9000.
 * Until it does, they come from the old Spring app on 8090. Once the Mongo
 * service picks them up, set this to BACKEND_PORT and the SQLite backend can go.
 */
const ASSET_PORT = 8090;

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

/** Override by setting EXPO_PUBLIC_API_URL, e.g. http://192.168.1.20:8090 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://${resolveBackendHost()}:${BACKEND_PORT}`;

/** Every CRUD collection lives under this prefix on the Mongo backend. */
export const API_V1 = '/api/v1';

/**
 * Licence check for one book: `GET /api/v1/licences/book/{bookId}/expired`,
 * answering a bare JSON boolean. Note the British spelling - `licenses` is a 404.
 *
 * Unlike the six CRUD collections this is not a syncable entity. There is no
 * local licences table and nothing is ever pushed to it; the device only ever
 * asks the question and records the answer in `downloads.is_valid`.
 */
export const licenceExpiredPath = (bookId: string) =>
  `${API_V1}/licences/book/${encodeURIComponent(bookId)}/expired`;

/**
 * Whether the boolean from {@link licenceExpiredPath} is an *expired* flag
 * (true = expired = the book must not open) rather than a *validity* flag
 * (false = the book must not open).
 *
 * It is the expired reading, confirmed against the running server rather than
 * inferred from the `isExpiredForBook` method name: `book-001` holds licence
 * `lic-001` running 2026-08-01 to 2027-08-01, which is current, and the endpoint
 * answers `false`. Taking `false` as "invalid" would therefore revoke a book
 * whose licence has another year to run.
 *
 * Flip this if the endpoint's meaning is ever inverted server-side.
 */
export const LICENCE_RESPONSE_IS_EXPIRED_FLAG = true;

/**
 * What a 404 - "Licence for book 'x' was not found" - should mean.
 *
 * Left at false, a book with no licence record keeps whatever validity it had.
 * Strictly, no licence means no entitlement and it should be blocked; in
 * practice a 404 is far more likely to mean the licences collection is simply
 * unseeded, and blocking on that would brick the reader for everyone. Set to
 * true once every book is guaranteed to have a licence document.
 */
export const BLOCK_WHEN_LICENCE_MISSING = false;

/** Point EXPO_PUBLIC_ASSET_URL at whatever serves the book - see ASSET_PORT. */
export const ASSET_BASE_URL =
  process.env.EXPO_PUBLIC_ASSET_URL ?? `http://${resolveBackendHost()}:${ASSET_PORT}`;

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

export const BOOK_FILE_URL = `${ASSET_BASE_URL}/api/books/${BOOK_ID}/file`;
export const PDFJS_LIB_URL = `${ASSET_BASE_URL}/api/assets/pdfjs/pdf.min.js`;
export const PDFJS_WORKER_URL = `${ASSET_BASE_URL}/api/assets/pdfjs/pdf.worker.min.js`;

/** pdf.js needs these to draw the PDF base-14 fonts (Helvetica, Helvetica-Bold). */
export const PDFJS_STANDARD_FONTS = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
] as const;

export const pdfjsFontUrl = (filename: string) =>
  `${ASSET_BASE_URL}/api/assets/pdfjs/standard_fonts/${filename}`;

/** How long a single network call may take before we treat the device as offline. */
export const REQUEST_TIMEOUT_MS = 8000;
