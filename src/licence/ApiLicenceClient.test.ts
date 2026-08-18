// src/licence/ApiLicenceClient.test.ts
// What can be tested without flambeau: the URLs, the method, the headers, the status
// mapping and the body handling. Whether the endpoints answer is not knowable here, and
// pretending otherwise is what a mocked fetch is for.
import { ApiLicenceClient, type LicenceFetch, type LicenceResponse } from './ApiLicenceClient';
import { LicenceError, isLicenceFailure } from './LicenceSource';

// A bare item id: the calls take nothing else, and the assertions below check that the
// body sent carries nothing else either.
const ITEM = 'item_42';

const LOAN = {
  loanId: 'loan_3b8',
  itemId: 'item_42',
  status: 'ACTIVE',
  dueAt: '2026-08-15T09:00:00Z',
  serverTime: '2026-08-13T10:00:00Z',
};

interface Call {
  url: string;
  init: Parameters<LicenceFetch>[1];
}

// Records what was sent, so the assertions can be about the request and not only the
// reply — a client that parses correctly and calls the wrong URL passes every
// response-shaped test.
const spy = (reply: Partial<LicenceResponse> & { throws?: unknown }) => {
  const calls: Call[] = [];
  const fetch: LicenceFetch = async (url, init) => {
    calls.push({ url, init });
    if (reply.throws !== undefined) throw reply.throws;
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      json: reply.json ?? (async () => LOAN),
    };
  };
  return { calls, fetch };
};

// `null` means "no token", not `undefined`. Passing `undefined` to a parameter with a
// default triggers the default, so a test asking for the tokenless case would silently
// get the token — which is exactly what this helper got wrong first time round.
const client = (fetch: LicenceFetch, token: string | null = 'tok_abc') =>
  new ApiLicenceClient({
    // A trailing slash on purpose: the constructor strips it, and a double slash in a
    // path is the kind of thing that works against one server and 404s on the next.
    baseUrl: 'https://flambeau.test/',
    getToken: async () => token ?? undefined,
    fetch,
  });

const failure = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return isLicenceFailure(error) ? error : undefined;
  }
  return undefined;
};

describe('the requests', () => {
  it('borrows by POSTing the item id, and nothing else', async () => {
    const { calls, fetch } = spy({ status: 201 });
    await client(fetch).borrow(ITEM);

    expect(calls[0]?.url).toBe('https://flambeau.test/api/v1/loans');
    expect(calls[0]?.init.method).toBe('POST');
    // The reader comes from the token and the institution from its scope. Sending our
    // own userId would be either ignored or, worse, honoured.
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ itemId: 'item_42' });
  });

  it('puts the loan id in the return path', async () => {
    const { calls, fetch } = spy({ status: 200, json: async () => ({}) });
    await client(fetch).returnLoan('loan_7c1');
    expect(calls[0]?.url).toBe('https://flambeau.test/api/v1/loans/loan_7c1/return');
  });

  // No `returnedAt`: it means "the reader closed this offline and we are reporting it
  // late", which is a claim we cannot support for a return that just happened.
  it('sends no body when returning', async () => {
    const { calls, fetch } = spy({ status: 200, json: async () => ({}) });
    await client(fetch).returnLoan('loan_7c1');
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('puts the hold id in the accept path', async () => {
    const { calls, fetch } = spy({ status: 201 });
    await client(fetch).acceptOffer('hold_5d1');
    expect(calls[0]?.url).toBe('https://flambeau.test/api/v1/holds/hold_5d1/accept');
  });

  // Reject and leave-the-queue are the same call, because there is no decline endpoint.
  it('cancels with DELETE, which is also how Reject works', async () => {
    const { calls, fetch } = spy({ status: 204 });
    await client(fetch).cancelHold('hold_5d1');
    expect(calls[0]?.url).toBe('https://flambeau.test/api/v1/holds/hold_5d1');
    expect(calls[0]?.init.method).toBe('DELETE');
  });

  it('escapes an id rather than pasting it into the path', async () => {
    const { calls, fetch } = spy({ status: 204 });
    await client(fetch).cancelHold('hold/../../admin');
    expect(calls[0]?.url).toBe('https://flambeau.test/api/v1/holds/hold%2F..%2F..%2Fadmin');
  });

  it('sends the bearer token', async () => {
    const { calls, fetch } = spy({ status: 201 });
    await client(fetch).borrow(ITEM);
    expect(calls[0]?.init.headers.Authorization).toBe('Bearer tok_abc');
  });

  // Omitted, not sent empty. `Bearer undefined` reads as a malformed token and comes
  // back as a different error than the honest "no token" 401 — and until the session
  // store lands, no token is the truthful state.
  it('omits the header entirely when there is no token', async () => {
    const { calls, fetch } = spy({ status: 201 });
    await client(fetch, null).borrow(ITEM);
    expect('Authorization' in (calls[0]?.init.headers ?? {})).toBe(false);
  });
});

describe('the replies', () => {
  it('normalizes a borrow into a loan', async () => {
    const { fetch } = spy({ status: 201 });
    const loan = await client(fetch).borrow(ITEM);
    expect(loan.loanId).toBe('loan_3b8');
    expect(loan.state).toBe('active');
  });

  // 204 has no body. Reading one would throw on the empty string and turn a successful
  // cancel into a MALFORMED_RESPONSE.
  it('accepts a 204 with no body', async () => {
    const { fetch } = spy({
      status: 204,
      json: async () => {
        throw new Error('no body to parse');
      },
    });
    await expect(client(fetch).cancelHold('hold_5d1')).resolves.toBeUndefined();
  });

  // Keyed on `code`, never on the status — the two contracts already disagree once, and
  // this is what survives that.
  it('carries flambeau’s code off a refusal', async () => {
    const { fetch } = spy({
      ok: false,
      status: 409,
      json: async () => ({ status: 409, code: 'NO_COPIES_AVAILABLE', message: 'none free' }),
    });
    const error = await failure(client(fetch).borrow(ITEM));
    expect(error?.code).toBe(LicenceError.REFUSED);
    expect(error?.errorCode).toBe('NO_COPIES_AVAILABLE');
  });

  it('reports OFFER_EXPIRED as an ordinary refusal, not a crash', async () => {
    const { fetch } = spy({
      ok: false,
      status: 409,
      json: async () => ({ code: 'OFFER_EXPIRED' }),
    });
    expect((await failure(client(fetch).acceptOffer('hold_5d1')))?.errorCode).toBe(
      'OFFER_EXPIRED',
    );
  });

  // A refusal with an unreadable body is still a refusal. Reporting a parsing complaint
  // instead would hide what the status already told us.
  it('still refuses when the error body cannot be read', async () => {
    const { fetch } = spy({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('gateway html');
      },
    });
    const error = await failure(client(fetch).borrow(ITEM));
    expect(error?.code).toBe(LicenceError.REFUSED);
    expect(error?.errorCode).toBeUndefined();
  });

  // A loan with no id cannot be returned later, so this fails at the boundary instead of
  // at the Revoke tap.
  it('rejects a 2xx whose shape is wrong', async () => {
    const { fetch } = spy({ status: 201, json: async () => ({ itemId: 'item_42' }) });
    expect((await failure(client(fetch).borrow(ITEM)))?.code).toBe(
      LicenceError.MALFORMED_RESPONSE,
    );
  });

  it('maps a dead connection to NETWORK_UNAVAILABLE', async () => {
    const { fetch } = spy({ throws: new TypeError('Network request failed') });
    expect((await failure(client(fetch).borrow(ITEM)))?.code).toBe(
      LicenceError.NETWORK_UNAVAILABLE,
    );
  });

  // Our own deadline firing, kept apart from no-network because a slow server wants
  // different copy and different retry behaviour.
  it('maps an abort to TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const { fetch } = spy({ throws: abort });
    expect((await failure(client(fetch).borrow(ITEM)))?.code).toBe(LicenceError.TIMEOUT);
  });
});

describe('openReadingSession', () => {
  it('refuses with NOT_OURS_YET rather than calling anything', async () => {
    const { calls, fetch } = spy({ status: 201 });
    const error = await failure(client(fetch).openReadingSession(ITEM));
    expect(error?.code).toBe(LicenceError.NOT_OURS_YET);
    expect(calls).toHaveLength(0);
  });
});
