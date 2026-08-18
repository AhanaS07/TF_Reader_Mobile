// src/licence/ApiLicenceClient.ts
// `LicenceSource` over HTTP against flambeau.
//
// HONEST ABOUT WHAT IS UNTESTABLE TODAY: NONE of these six endpoints exists yet. The
// contract's own preamble is explicit — "Built today: POST /api/v1/auth/saml/start and
// GET /api/v1/auth/me. Everything else is declared here and not yet implemented, which
// is deliberate — the contract is agreed before the code, not after." Both of those are
// auth; not one licence call is live.
//
// So the URL building, the status mapping and the parsing are real and tested against
// their contract's worked examples, and whether the endpoints answer is not something
// this file can know. Same footing `ApiAdapter` is on with wokay — and the reason
// `MockLicenceClient` is load-bearing rather than a convenience.
//
// THE TOKEN IS INJECTED, NOT READ. Every one of these endpoints is
// `security: [{ appToken: [] }]`, and the session store is Keshav's and unbuilt. A
// `getToken` callback means this file is finishable now and needs no edit when the real
// session lands — the store is wired in at construction, in config/licence.ts.
//
// IT SHARES `normalizeLicence.ts` WITH THE MOCK, so the two cannot disagree about the
// shape they produce — only about where the bytes came from.
import type { BookId } from '@/shared/types/primitives';
import type { Hold, Loan } from '@model/types';
import {
  LicenceError,
  LicenceFailure,
  type Library,
  type LicenceSource,
} from './LicenceSource';
import { normalizeHold, normalizeLibrary, normalizeLoan } from './normalizeLicence';

// Only the parts of Response this client touches. Structural rather than the DOM type,
// so tests hand over a plain object and nothing here depends on which fetch React
// Native ships.
export interface LicenceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type LicenceFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<LicenceResponse>;

export interface ApiLicenceClientOptions {
  // e.g. 'https://flambeau.tf'. Trailing slashes are tolerated.
  baseUrl: string;
  // Supplies the bearer token. Async because a real store may need to refresh one, and
  // a signature that cannot await would have to be widened later.
  getToken: () => Promise<string | undefined>;
  fetch?: LicenceFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiLicenceClient implements LicenceSource {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;
  private readonly fetch: LicenceFetch;
  private readonly timeoutMs: number;

  constructor(options: ApiLicenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as LicenceFetch);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async borrow(itemId: BookId): Promise<Loan> {
    // The body names only the item, because `BorrowRequest` declares exactly one property
    // and requires it. There is nowhere to put a user or an institution, so identity is
    // the token's job alone — which is also why this takes a `BookId` rather than the
    // `LicenceRef` an earlier draft threaded through here.
    const body = await this.send('POST', '/api/v1/loans', itemId, { itemId });
    return normalizeLoan(body);
  }

  async returnLoan(loanId: string): Promise<void> {
    // No `returnedAt`. It is optional and means "the reader closed this offline and we
    // are reporting it late" — sending our own clock for a return that just happened
    // would be a claim we cannot support, and flambeau clamp it to their own window
    // anyway.
    await this.send('POST', `/api/v1/loans/${encodeURIComponent(loanId)}/return`, loanId);
  }

  async placeHold(itemId: BookId): Promise<Hold> {
    // `HoldRequest` is the same one-property shape as `BorrowRequest`.
    const body = await this.send('POST', '/api/v1/holds', itemId, { itemId });
    return normalizeHold(body);
  }

  async acceptOffer(holdId: string): Promise<Loan> {
    const body = await this.send(
      'POST',
      `/api/v1/holds/${encodeURIComponent(holdId)}/accept`,
      holdId,
    );
    return normalizeLoan(body);
  }

  async cancelHold(holdId: string): Promise<void> {
    await this.send('DELETE', `/api/v1/holds/${encodeURIComponent(holdId)}`, holdId);
  }

  async getLibrary(): Promise<Library> {
    const body = await this.send('GET', '/api/v1/library');
    return normalizeLibrary(body);
  }

  async openReadingSession(itemId: BookId): Promise<never> {
    // Not implemented rather than not present — see the note on the interface. The
    // blocker is a `devicePublicKey` we do not hold, not the HTTP.
    throw new LicenceFailure(LicenceError.NOT_OURS_YET, {
      target: itemId,
      cause:
        'POST /api/v1/reading-sessions needs a devicePublicKey from t4targaryen’s ' +
        'keystore. Ownership is open question 6.',
    });
  }

  // One place that does the request, so no call can forget the token, the deadline or
  // the error mapping.
  //
  // RETURNS `unknown`, never a parsed shape. Parsing belongs to `normalizeLicence.ts`,
  // and keeping it out of here is what stops a second interpretation of the wire
  // growing inside the transport.
  private async send(
    method: string,
    path: string,
    target?: string,
    body?: unknown,
  ): Promise<unknown> {
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: LicenceResponse;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          // Sent when we have one and omitted when we do not, rather than sent empty.
          // An `Authorization: Bearer undefined` reads as a malformed token and comes
          // back as a different error than the honest "no token" 401.
          ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (cause) {
      // An abort is our own deadline firing, and it wants different copy from a dead
      // connection — a slow server is worth retrying differently from no network.
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new LicenceFailure(aborted ? LicenceError.TIMEOUT : LicenceError.NETWORK_UNAVAILABLE, {
        ...(target !== undefined ? { target } : {}),
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw await this.refusal(response, target);

    // 204 on a successful cancel, and DELETE has no body to parse. Reading one would
    // throw on the empty string and turn a success into a MALFORMED_RESPONSE.
    if (response.status === 204) return undefined;

    try {
      return await response.json();
    } catch (cause) {
      throw new LicenceFailure(LicenceError.MALFORMED_RESPONSE, {
        ...(target !== undefined ? { target } : {}),
        cause,
      });
    }
  }

  // Turns a non-2xx into a REFUSED carrying flambeau's own `code`.
  //
  // KEYED ON `code` AND NEVER ON THE STATUS, which is not fastidiousness: the two
  // contracts already disagree once, `DOWNLOAD_NOT_PERMITTED` being 403 in wokay's
  // document and 422 in flambeau's own reference. Reading the body costs nothing and
  // survives that.
  private async refusal(response: LicenceResponse, target?: string): Promise<LicenceFailure> {
    let errorCode: string | undefined;
    try {
      const body = await response.json();
      if (typeof body === 'object' && body !== null) {
        const code = (body as Record<string, unknown>).code;
        if (typeof code === 'string' && code.length > 0) errorCode = code;
      }
    } catch {
      // A refusal with no readable body is still a refusal. Swallowed on purpose: the
      // status told us it failed, and reporting MALFORMED_RESPONSE here would hide
      // that behind a parsing complaint.
    }
    return new LicenceFailure(LicenceError.REFUSED, {
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(target !== undefined ? { target } : {}),
      cause: `HTTP ${response.status}`,
    });
  }
}
