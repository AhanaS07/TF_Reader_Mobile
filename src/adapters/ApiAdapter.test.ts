// src/adapters/ApiAdapter.test.ts
// ApiAdapter runs the SAME conformance suite as MockAdapter, with fetch replaced
// by a fake that serves the frozen fixtures over the URL scheme the real API is
// expected to use. That is what makes "interchangeable" checkable today: api.tf
// does not exist, but the adapter's parsing, URL building and error mapping all
// do, and all three are exercised here.
import { ApiAdapter, type FetchLike, type FetchResponse } from '@adapters/ApiAdapter';
import { describeCatalogueSourceConformance, KNOWN_INSTITUTION } from '@adapters/conformance';
import { describeInstitutionSourceConformance } from '@adapters/institutionConformance';
import { CatalogueError } from '@model/errors';
import { normalizeInstitutionList } from '@model/institution';

import homeCatalogueFixture from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import shelfGroupFixture from '@model/fixtures/OPDS-samples/02-shelf-group.json';
import shelfGroupPage1Fixture from '@model/fixtures/OPDS-samples/02-shelf-group-page1.json';
import publicationDetailFixture from '@model/fixtures/OPDS-samples/03-publication-detail.json';
import institutionsFixture from '@model/fixtures/institutions.json';

const BASE_URL = 'https://api.tf/opds/v1';

function ok(body: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => body };
}

function notFound(): FetchResponse {
  return { ok: false, status: 404, json: async () => ({}) };
}

// Serves the fixtures at the paths the real OPDS API is expected to expose,
// derived from the self-hrefs inside the fixtures themselves.
const serveFixtures: FetchLike = async (url) => {
  const { pathname } = new URL(url);

  if (pathname === `/opds/v1/institutions/${KNOWN_INSTITUTION}/catalogue`) {
    return ok(homeCatalogueFixture);
  }
  if (pathname === `/opds/v1/institutions/${KNOWN_INSTITUTION}/groups/ebooks`) {
    // Paged on the query string, exactly as the adapter builds it. Serving page 0
    // for every request would let a paging bug pass this suite — the adapter
    // could drop the page param entirely and nothing here would notice.
    const page = new URL(url).searchParams.get('page');
    if (page === null || page === '0') return ok(shelfGroupFixture);
    if (page === '1') return ok(shelfGroupPage1Fixture);
    return notFound();
  }
  if (pathname === `/opds/v1/institutions/${KNOWN_INSTITUTION}/publications/item_42`) {
    return ok(publicationDetailFixture);
  }

  // The institution endpoints. `/institutions` is the list; `/institutions/<id>`
  // with no trailing collection is a single institution.
  if (pathname === '/opds/v1/institutions') {
    return ok(institutionsFixture);
  }
  const single = /^\/opds\/v1\/institutions\/([^/]+)$/.exec(pathname);
  if (single) {
    const institution = normalizeInstitutionList(institutionsFixture).find(
      (candidate) => candidate.id === decodeURIComponent(single[1]),
    );
    return institution === undefined ? notFound() : ok(institution);
  }

  return notFound();
};

describeCatalogueSourceConformance(
  'ApiAdapter',
  () => new ApiAdapter({ baseUrl: BASE_URL, fetch: serveFixtures }),
);
describeInstitutionSourceConformance(
  'ApiAdapter',
  () => new ApiAdapter({ baseUrl: BASE_URL, fetch: serveFixtures }),
);

describe('ApiAdapter institution endpoints', () => {
  it('requests the institutions collection', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getInstitutions();

    expect(requested).toEqual([`${BASE_URL}/institutions`]);
  });

  it('escapes the institution id in the detail path', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return notFound();
      },
    });

    await expect(adapter.getInstitution('../../admin')).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
    expect(requested[0]).not.toContain('../');
  });

  it('maps a non-institution payload to MALFORMED_FEED', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => ok({ results: [] }),
    });

    await expect(adapter.getInstitutions()).rejects.toMatchObject({
      code: CatalogueError.MALFORMED_FEED,
    });
  });
});

describe('ApiAdapter URL construction', () => {
  it('requests the catalogue endpoint for the given institution', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(requested).toEqual([`${BASE_URL}/institutions/${KNOWN_INSTITUTION}/catalogue`]);
  });

  it('sends no page parameter when no page was asked for', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks');

    expect(requested[0]).not.toContain('page=');
  });

  it('appends the page index when paging', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return ok(shelfGroupFixture);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks', 2);

    expect(requested[0]).toBe(
      `${BASE_URL}/institutions/${KNOWN_INSTITUTION}/groups/ebooks?page=2`,
    );
  });

  it('escapes ids so a crafted id cannot reshape the URL path', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return notFound();
      },
    });

    await expect(
      adapter.getPublication(KNOWN_INSTITUTION, '../../admin'),
    ).rejects.toMatchObject({ code: CatalogueError.NOT_FOUND });
    expect(requested[0]).not.toContain('../');
  });
});

describe('ApiAdapter failure mapping', () => {
  it('maps 404 to NOT_FOUND', async () => {
    const adapter = new ApiAdapter({ baseUrl: BASE_URL, fetch: async () => notFound() });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
  });

  it('maps a server error to NETWORK_UNAVAILABLE, since retrying may succeed', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.NETWORK_UNAVAILABLE,
    });
  });

  it('maps a thrown fetch to NETWORK_UNAVAILABLE', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.NETWORK_UNAVAILABLE,
    });
  });

  it('maps an aborted request to TIMEOUT', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => {
        const aborted = new Error('Aborted');
        aborted.name = 'AbortError';
        throw aborted;
      },
    });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.TIMEOUT,
    });
  });

  it('maps an unparseable body to MALFORMED_FEED', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }),
    });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.MALFORMED_FEED,
    });
  });

  it('maps a well-formed JSON body that is not an OPDS feed to MALFORMED_FEED', async () => {
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => ok({ hello: 'world' }),
    });

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toMatchObject({
      code: CatalogueError.MALFORMED_FEED,
    });
  });
});
