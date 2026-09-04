// src/adapters/PartialApiAdapter.test.ts
// Which side of the mock/api split each DataSource method lands on.
//
// ApiAdapter.test.ts already proves ApiAdapter parses, builds URLs and maps
// errors correctly, and conformance.ts holds both adapters to the same shape.
// Neither of those can catch the bug THIS file exists for: a method wired to
// the wrong half of PartialApiAdapter. A `this.mock` left in place ships fixture
// data from a build configured for the real backend — green tests, plausible
// screens, nothing on the wire.
//
// WHY A GLOBAL FETCH STUB RATHER THAN INJECTION. PartialApiAdapter builds its
// own ApiAdapter from a baseUrl and takes no `fetch`, so there is no seam to
// inject through — and adding one just for a test would change production code
// to test production code. ApiAdapter falls back to `globalThis.fetch`, so
// stubbing that reaches it through the real constructor, with the real
// delegation in between. Restored after every test.
//
// A FETCH CALL IS THE PROOF, not the returned data. MockAdapter normalizes the
// SAME frozen public-catalogue fixtures this file serves over the wire
// (MockAdapter.publicPages()), so identical rows come back either way and
// asserting on them alone would pass alongside `this.mock`. What the mock can
// never do is make an HTTP request — so the assertions here are about the call
// that did or did not happen, plus one test that serves a body the fixtures
// could not have produced.
import { PartialApiAdapter } from '@adapters/PartialApiAdapter';
import type { FetchResponse } from '@adapters/ApiAdapter';
import { KNOWN_PUBLIC_PUBLICATION } from '@adapters/conformance';

import publicCataloguePage0Fixture from '@model/fixtures/OPDS-samples/08-public-catalogue-page0.json';
import publicCataloguePage1Fixture from '@model/fixtures/OPDS-samples/09-public-catalogue-page1.json';

// Scheme + host only, exactly as ApiAdapter's own contract requires — every
// method appends its own /api/v1 or /opds/v1 namespace.
const BASE_URL = 'https://api.tf';

const PUBLIC_CATALOGUE_PATH = '/opds/v1/public/catalogue';
const PUBLIC_PAGES = [publicCataloguePage0Fixture, publicCataloguePage1Fixture];

// Only the fields ApiAdapter actually passes to fetch, same narrowing
// FetchResponse itself uses.
interface RecordedCall {
  url: string;
  init?: { headers?: Record<string, string>; method?: string; body?: string };
}

function ok(body: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => body };
}

function notFound(): FetchResponse {
  return { ok: false, status: 404, json: async () => ({}) };
}

// Serves the frozen public-catalogue fixtures at the contract's own path, paged
// on the query string exactly as the adapter builds it. Answering page 0 for
// every request would let the adapter drop the param entirely and nothing here
// would notice — the same reasoning ApiAdapter.test.ts's serveFixtures gives.
function servePublicPages(url: string): FetchResponse {
  const { pathname, searchParams } = new URL(url);
  if (pathname !== PUBLIC_CATALOGUE_PATH) return notFound();

  const page = searchParams.get('page');
  const body = PUBLIC_PAGES[page === null ? 0 : Number(page)];
  return body === undefined ? notFound() : ok(body);
}

let calls: RecordedCall[] = [];
let realFetch: typeof globalThis.fetch;

// Every test that configures a token uses this one, so "was a token even asked
// for" is checkable separately from "was a header sent".
let getToken: jest.Mock<Promise<string | undefined>, []>;

function stubFetch(respond: (url: string) => FetchResponse): void {
  globalThis.fetch = (async (url: string, init?: RecordedCall['init']) => {
    calls.push({ url, init });
    return respond(url);
  }) as unknown as typeof globalThis.fetch;
}

// A token IS configured in every test below. That is the point: the public feed
// must stay unauthenticated even when one is available, which is a stronger
// claim than "sends nothing when there is nothing to send".
function createAdapter(): PartialApiAdapter {
  return new PartialApiAdapter(BASE_URL, undefined, getToken);
}

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  getToken = jest.fn(async () => 'tok_abc123');
  stubFetch(servePublicPages);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('PartialApiAdapter getPublicFeed', () => {
  // The delegation test. One request, at the contract's frozen path, with no
  // query string at all — which also pins the no-page case below.
  it('reaches the real API at the frozen public catalogue path', async () => {
    await createAdapter().getPublicFeed();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}${PUBLIC_CATALOGUE_PATH}`);
  });

  // Omitted entirely rather than sent as 0, so the server applies its own
  // default. `page=0` would be us guessing at that default.
  it('sends no page parameter when no page was asked for', async () => {
    await createAdapter().getPublicFeed();

    expect(calls[0].url).not.toContain('page=');
    expect(calls[0].url).not.toContain('?');
  });

  it('appends the page index when paging', async () => {
    await createAdapter().getPublicFeed(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}${PUBLIC_CATALOGUE_PATH}?page=1`);
  });

  // The one assertion the shared fixtures cannot fake: a title no fixture
  // carries. If this method ever reverts to `this.mock`, every other test in
  // this file still fails on the missing request, but THIS one fails on the
  // data — which is what a reader would actually see.
  it('returns what the wire served, not the mock fixture', async () => {
    const served = {
      ...publicCataloguePage0Fixture,
      metadata: { ...publicCataloguePage0Fixture.metadata, title: 'Served over HTTP' },
    };
    stubFetch(() => ok(served));

    const feed = await createAdapter().getPublicFeed();

    expect(feed.title).toBe('Served over HTTP');
  });

  // `security: []` in wokay's contract. Sending a bearer here would not merely
  // be redundant, it would be a spec violation — hence a regression test rather
  // than an untested absence.
  it('sends no Authorization header even when a getToken is configured', async () => {
    await createAdapter().getPublicFeed();

    expect(calls[0].init?.headers).toBeUndefined();
  });

  // Stronger than the header check above, and the reason authenticatedHeaders()
  // is opt-in per method: an unauthenticated endpoint should not even reach for
  // a token, since ensureFreshToken can fire a refresh round-trip to produce one.
  it('never asks for a token', async () => {
    await createAdapter().getPublicFeed();

    expect(getToken).not.toHaveBeenCalled();
  });

  // Through the shared normalizeShelf — no second parser for this endpoint.
  // Values are the frozen page-0 fixture's own; `id` is the tail of its self
  // href with the query stripped, which is why a paginated feed is not keyed
  // by page.
  it('normalizes the served feed', async () => {
    const feed = await createAdapter().getPublicFeed();

    expect(feed.id).toBe('catalogue');
    expect(feed.title).toBe('Open access titles');
    expect(feed.totalItems).toBe(5);
    expect(feed.itemsPerPage).toBe(3);
    expect(feed.nextPage).toBe(1);
    expect(feed.publications).toHaveLength(3);
    expect(feed.publications[0].title).toBe('Coastal Wetlands of the Bay of Bengal');
    expect(feed.publications[0].acquisition.licenceModel).toBe('OPEN_ACCESS');
    // OPDS wire fields never escape the adapter.
    expect(feed.publications[0]).not.toHaveProperty('metadata');
    expect(feed.publications[0]).not.toHaveProperty('links');
  });

  // The last page advertises no `next`, so nextPage is absent — that absence is
  // how a caller knows to stop, and it is derived from the feed rather than
  // from a page count we track.
  it('normalizes the last page with no next cursor', async () => {
    const feed = await createAdapter().getPublicFeed(1);

    expect(feed.publications).toHaveLength(2);
    expect(feed.publications[0].title).toBe('Public Health Data in Low-Bandwidth Settings');
    expect(feed.nextPage).toBeUndefined();
  });
});

// The boundary of this change, asserted rather than assumed: flipping the feed
// must not drag its sibling along. `/opds/v1/public/publications/{itemId}` is
// DRAFT in wokay's contract, not FROZEN, so it stays on fixtures until that
// endpoint is verified — see PartialApiAdapter.ts's header.
//
// TASK 2 FLIPS THIS EXPECTATION. When getPublicPublication moves to `this.api`,
// this test is the one that should fail, and it should then be rewritten to
// assert the request rather than deleted.
describe('PartialApiAdapter getPublicPublication', () => {
  it('still comes from fixtures, making no request', async () => {
    const publication = await createAdapter().getPublicPublication(KNOWN_PUBLIC_PUBLICATION);

    expect(calls).toHaveLength(0);
    expect(publication.id).toBe(KNOWN_PUBLIC_PUBLICATION);
  });
});
