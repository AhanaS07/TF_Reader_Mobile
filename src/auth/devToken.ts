// src/auth/devToken.ts
// DEV ONLY — mints a real flambeau bearer token so `EXPO_PUBLIC_LICENCE_SOURCE=api`
// has something a 401 will accept.
//
// WHY THIS EXISTS AT ALL. Sign-in is still a stub on both paths: SignInScreen
// synthesises `stub:${institutionId}` and personalAccount.ts `stub-personal:${email}`,
// because the real SAML flow mints its token at the ACS after a browser redirect and
// the deep-link half of that contract is still open. Those strings are not tokens —
// flambeau answers them with `401 UNAUTHENTICATED` — so every licence call in api mode
// fails, and `libraryStore.refresh()` swallows the failure by design. The visible
// result is a Library screen that renders its empty state and cannot say why.
//
// `POST /api/v1/auth/dev-token` is flambeau's own dev affordance: no credentials, and
// it hands back a signed 15-minute access token for `usr_dev123` / `inst_7f3`. It is
// not in the contract, so nothing here may become load-bearing — this file is the
// scaffold that lets the screens be built and demonstrated against real data, and it
// is deleted the day real sign-in lands.
//
// IT REPLACES THE TOKEN PROVIDER RATHER THAN THE SESSION. `sessionStore` wires
// `setLicenceToken(getToken)` once at module load, and this overrides that wiring for
// the process — so the stub token a later sign-in writes into the session store never
// reaches the licence client. That is deliberate: in dev-auth mode the real token has
// to win, and a sign-in tap must not silently break every call that was working a
// moment ago. Nothing else about the session changes, so ProfileScreen and
// `resolveAccess` still see whatever the sign-in flow gave them.
//
// OFF UNLESS ASKED FOR. Absent `EXPO_PUBLIC_DEV_AUTH=1` this module installs nothing
// and no request is made, so an ordinary build cannot reach a dev-token endpoint.
import { setLicenceToken } from '@config/licence';

// READ AS LITERALS, never through a variable — Expo's babel plugin substitutes
// `process.env.EXPO_PUBLIC_*` by matching the source text at build time, so a dynamic
// lookup survives into the bundle as `undefined`. config/licence.ts carries the long
// version of this warning; the failure mode here is a release build that quietly asks
// a production host for a dev token.
const FLAG_VAR = 'EXPO_PUBLIC_DEV_AUTH';
const BASE_URL_VAR = 'EXPO_PUBLIC_FLAMBEAU_BASE_URL';

const DEV_TOKEN_PATH = '/api/v1/auth/dev-token';

// The mint is a dev endpoint on a machine that is usually localhost. Short, because a
// stalled token call holds up every licence call behind it.
const TIMEOUT_MS = 5_000;

// Re-mint this far before expiry rather than at it, so a token cannot expire in flight.
// Same 30s buffer sessionStore applies, for the same reason.
const EXPIRY_BUFFER_MS = 30_000;

// What to assume when `expiresAt` is missing or unparsable. Deliberately short: the
// token is known to be minted-now and 15 minutes is only the observed value, not a
// documented one, so this caches for a minute rather than guessing the window.
const FALLBACK_TTL_MS = 60_000;

interface Minted {
  token: string;
  expiresAtMs: number;
}

let cached: Minted | undefined;
// Dedupes concurrent mints. The Library screen refreshes on mount while
// QueueNotificationHost polls, so two calls can want a token in the same tick and one
// token serves both.
let inFlight: Promise<Minted | undefined> | undefined;

/** Whether dev auth was asked for. False in any ordinary build. */
export function isDevAuthEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEV_AUTH === '1';
}

function baseUrl(): string | undefined {
  const raw = process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
  if (raw === undefined || raw.trim() === '') return undefined;
  // Trailing slashes stripped here as well as in ApiLicenceClient — this file builds
  // its own URL and does not go through that client.
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Reads `expiresAt` off the mint response.
 *
 * The absolute timestamp is preferred over any duration because it is the server's own
 * clock, and this token is checked against the device's. A device that is minutes fast
 * would otherwise keep a token it thinks is fresh past the point flambeau will take it.
 */
function expiryOf(body: unknown, nowMs: number): number {
  if (typeof body === 'object' && body !== null) {
    const raw = (body as Record<string, unknown>).expiresAt;
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return nowMs + FALLBACK_TTL_MS;
}

function tokenOf(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null) {
    const raw = (body as Record<string, unknown>).token;
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}

async function mint(url: string): Promise<Minted | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', signal: controller.signal });
    if (!response.ok) {
      // LOUD, because the thing downstream of here is silent. `refresh()` swallows the
      // 401 this failure causes, so if this warning is not printed the empty Library
      // screen has no explanation anywhere.
      console.warn(`devToken: ${url} answered ${response.status}; calls will be unauthenticated.`);
      return undefined;
    }
    const body: unknown = await response.json();
    const token = tokenOf(body);
    if (token === undefined) {
      console.warn(`devToken: ${url} returned no 'token' field; calls will be unauthenticated.`);
      return undefined;
    }
    const expiresAtMs = expiryOf(body, Date.now());
    // SAYS SO OUT LOUD, once per mint. The alternative is proving this worked by the
    // ABSENCE of a warning, and "no news is good news" is a poor signal for the one
    // thing standing between the screens and real data — especially on an Android
    // emulator, where `localhost` is the emulator and reaching the host needs
    // `adb reverse tcp:8080 tcp:8080`. Roughly one line per 15 minutes.
    console.log(`devToken: minted, valid until ${new Date(expiresAtMs).toISOString()}`);
    return { token, expiresAtMs };
  } catch (cause) {
    // Almost always "flambeau is not running". Reported rather than thrown: a token
    // provider that rejects surfaces as itself out of ApiLicenceClient.send, which is
    // a session failure dressed as a licence one — see the long note there.
    console.warn(`devToken: could not reach ${url} (${String(cause)}); calls will be unauthenticated.`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A bearer token for the licence client, minted on demand and re-minted on expiry.
 *
 * Returns `undefined` rather than throwing on every failure, so a dead mint produces
 * flambeau's honest `TOKEN_MISSING` 401 instead of an `Authorization: Bearer undefined`
 * that comes back as a different error.
 */
export async function devLicenceToken(): Promise<string | undefined> {
  const url = baseUrl();
  if (url === undefined) {
    console.warn(`devToken: ${FLAG_VAR}=1 but ${BASE_URL_VAR} is unset; nothing to mint against.`);
    return undefined;
  }

  if (cached !== undefined && Date.now() < cached.expiresAtMs - EXPIRY_BUFFER_MS) {
    return cached.token;
  }

  // A failed mint is NOT cached — the next call tries again, because the usual cause is
  // a server that had not finished starting.
  inFlight ??= mint(`${url}${DEV_TOKEN_PATH}`).finally(() => {
    inFlight = undefined;
  });
  const minted = await inFlight;
  if (minted === undefined) return undefined;
  cached = minted;
  return minted.token;
}

/**
 * Points the licence client at `devLicenceToken`, if and only if dev auth is enabled.
 *
 * Call once at startup, AFTER the module graph has pulled in `sessionStore` — its own
 * `setLicenceToken` runs as an import side effect, and whichever call runs last owns the
 * provider. App.tsx satisfies this by importing RootNavigator above the call.
 *
 * Returns whether it installed anything, so a caller can log it.
 */
export function installDevLicenceToken(): boolean {
  if (!isDevAuthEnabled()) return false;
  setLicenceToken(devLicenceToken);
  return true;
}

/** Drops the cached token. Tests only — it is how one test's token stays out of the next. */
export function resetDevLicenceToken(): void {
  cached = undefined;
  inFlight = undefined;
}
