// src/adapters/ApiAdapter.test.ts
// ApiAdapter runs the SAME conformance suite as MockAdapter, with fetch replaced
// by a fake that serves the frozen fixtures over the URL scheme the real API is
// expected to use. That is what makes "interchangeable" checkable today: api.tf
// does not exist, but the adapter's parsing, URL building and error mapping all
// do, and all three are exercised here.
import { ApiAdapter, type FetchLike, type FetchResponse } from '@adapters/ApiAdapter';
import {
  describeCatalogueSourceConformance,
  KNOWN_INSTITUTION,
  KNOWN_PUBLICATION,
  KNOWN_SHELF,
} from '@adapters/conformance';
import { describeInstitutionSourceConformance } from '@adapters/institutionConformance';
import { CatalogueError } from '@model/errors';
import { normalizeInstitutionList } from '@model/institution';
import { idFromHref } from '@model/opds/rels';

import homeCatalogueFixture from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import newInstitutionCatalogueFixture from '@model/fixtures/OPDS-samples/02-home-catalogue-new-institution.json';
import allTitlesPage0Fixture from '@model/fixtures/OPDS-samples/03-shelf-all-page0.json';
import allTitlesPage1Fixture from '@model/fixtures/OPDS-samples/04-shelf-all-page1.json';
import curatedShelfFixture from '@model/fixtures/OPDS-samples/05-shelf-curated-page0.json';
import curatedShelfAltFixture from '@model/fixtures/OPDS-samples/06-shelf-curated-alt-page0.json';
import publicationDetailFixture from '@model/fixtures/OPDS-samples/07-publication-detail.json';
import publicCataloguePage0Fixture from '@model/fixtures/OPDS-samples/08-public-catalogue-page0.json';
import publicCataloguePage1Fixture from '@model/fixtures/OPDS-samples/09-public-catalogue-page1.json';
import institutionsFixture from '@model/fixtures/institutions.json';

const BASE_URL = 'https://api.tf/opds/v1';

function ok(body: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => body };
}

function notFound(): FetchResponse {
  return { ok: false, status: 404, json: async () => ({}) };
}

// The institution id inside a fixture's own self href, so no id is written twice.
function selfHrefOf(fixture: unknown): string {
  const { links } = fixture as { links: { rel: string; href: string }[] };
  const self = links.find((link) => link.rel === 'self');
  if (self === undefined) throw new Error('fixture has no self link');
  return self.href;
}

function institutionIdOf(fixture: unknown): string {
  const match = /\/institutions\/([^/]+)\//.exec(selfHrefOf(fixture));
  if (match === null) throw new Error('fixture self href names no institution');
  return match[1];
}

const CATALOGUE_BY_INSTITUTION: Record<string, unknown> = {
  [institutionIdOf(homeCatalogueFixture)]: homeCatalogueFixture,
  [institutionIdOf(newInstitutionCatalogueFixture)]: newInstitutionCatalogueFixture,
};

// Shelf listings keyed by the id in each fixture's own self href, so no shelf
// name is spelled out here — the ids are the administrator's, not ours. Index in
// the array is the page number.
const SHELF_PAGES = new Map<string, unknown[]>();
for (const pages of [
  [allTitlesPage0Fixture, allTitlesPage1Fixture],
  [curatedShelfFixture],
  [curatedShelfAltFixture],
]) {
  SHELF_PAGES.set(idFromHref(selfHrefOf(pages[0])), pages);
}

const PUBLIC_PAGES = [publicCataloguePage0Fixture, publicCataloguePage1Fixture];

// Every publication the public feed lists, keyed by the id in its own self href.
const PUBLIC_PUBLICATIONS = new Map<string, unknown>();
for (const page of PUBLIC_PAGES) {
  for (const publication of page.publications) {
    PUBLIC_PUBLICATIONS.set(idFromHref(selfHrefOf(publication)), publication);
  }
}

// Serves the fixtures at the paths the real OPDS API is expected to expose,
// derived from the self-hrefs inside the fixtures themselves.
const serveFixtures: FetchLike = async (url) => {
  const { pathname, searchParams } = new URL(url);

  // The public routes come FIRST: '/public' would otherwise match the
  // `/institutions/([^/]+)` patterns below if those paths ever loosen, and a
  // public request quietly answered by an institution fixture is exactly the
  // bug this whole card exists to prevent.
  if (pathname === '/opds/v1/public/catalogue') {
    // Paged on the query string, exactly as the adapter builds it — serving page
    // 0 for every request would let the adapter drop the param entirely and
    // nothing here would notice.
    const page = searchParams.get('page');
    const body = PUBLIC_PAGES[page === null ? 0 : Number(page)];
    return body === undefined ? notFound() : ok(body);
  }

  const publicPublication = /^\/opds\/v1\/public\/publications\/([^/]+)$/.exec(pathname);
  if (publicPublication) {
    const body = PUBLIC_PUBLICATIONS.get(decodeURIComponent(publicPublication[1]));
    return body === undefined ? notFound() : ok(body);
  }

  const catalogue = /^\/opds\/v1\/institutions\/([^/]+)\/catalogue$/.exec(pathname);
  if (catalogue) {
    const fixture = CATALOGUE_BY_INSTITUTION[decodeURIComponent(catalogue[1])];
    return fixture === undefined ? notFound() : ok(fixture);
  }

  const group = /^\/opds\/v1\/institutions\/([^/]+)\/groups\/([^/]+)$/.exec(pathname);
  if (group) {
    // An institution the fixtures do not know is a 404 before the shelf is even
    // looked at, so both adapters agree that an unknown institution is NOT_FOUND
    // whichever method asked.
    if (CATALOGUE_BY_INSTITUTION[decodeURIComponent(group[1])] === undefined) return notFound();
    const pages = SHELF_PAGES.get(decodeURIComponent(group[2]));
    if (pages === undefined) return notFound();
    // Paged on the query string, exactly as the adapter builds it. Serving page 0
    // for every request would let a paging bug pass this suite — the adapter
    // could drop the page param entirely and nothing here would notice.
    const page = searchParams.get('page');
    const index = page === null ? 0 : Number(page);
    const body = pages[index];
    return body === undefined ? notFound() : ok(body);
  }

  const publication = /^\/opds\/v1\/institutions\/([^/]+)\/publications\/([^/]+)$/.exec(pathname);
  if (publication) {
    if (CATALOGUE_BY_INSTITUTION[decodeURIComponent(publication[1])] === undefined) {
      return notFound();
    }
    if (decodeURIComponent(publication[2]) === KNOWN_PUBLICATION) {
      return ok(publicationDetailFixture);
    }
    return notFound();
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

    await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);

    expect(requested[0]).not.toContain('page=');
  });

  it('appends the page index when paging', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return ok(allTitlesPage0Fixture);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, 2);

    expect(requested[0]).toBe(
      `${BASE_URL}/institutions/${KNOWN_INSTITUTION}/groups/${KNOWN_SHELF}?page=2`,
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

  // Screen 12's filter/sort dimensions, built through the shared query helper
  // (browseParams) rather than spelled out in the adapter.
  it('sends contentType and accessTier as query parameters', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      contentType: 'AUDIO',
      accessTier: 'OPEN_ACCESS',
    });

    const { searchParams } = new URL(requested[0]);
    expect(searchParams.get('contentType')).toBe('AUDIO');
    expect(searchParams.get('accessTier')).toBe('OPEN_ACCESS');
  });

  it('sends sort for the all shelf', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, 'all', undefined, { sort: 'title.asc' });

    expect(new URL(requested[0]).searchParams.get('sort')).toBe('title.asc');
  });

  // browseLink.ts's own contract: sort is dropped for anything but 'all',
  // because a curated shelf's own order is the order.
  it('drops sort for a curated shelf', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return serveFixtures(url);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      sort: 'title.asc',
    }).catch(() => {});
    await adapter
      .getShelf(KNOWN_INSTITUTION, 'shelf_1', undefined, { sort: 'title.asc' })
      .catch(() => {});

    expect(new URL(requested[requested.length - 1]).searchParams.has('sort')).toBe(false);
  });

  it('combines page with a filter in the same request', async () => {
    const requested: string[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (url) => {
        requested.push(url);
        return ok(allTitlesPage0Fixture);
      },
    });

    await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, 2, { contentType: 'EPUB' });

    const { searchParams } = new URL(requested[0]);
    expect(searchParams.get('page')).toBe('2');
    expect(searchParams.get('contentType')).toBe('EPUB');
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

// Home-feed ETag caching (getHomeCatalogue only — see the file header for why
// this method and not the others).
describe('ApiAdapter home-feed ETag caching', () => {
  function okWithEtag(body: unknown, etag: string): FetchResponse {
    return {
      ok: true,
      status: 200,
      json: async () => body,
      headers: { get: (name) => (name === 'ETag' ? etag : null) },
    };
  }

  function notModified(): FetchResponse {
    return {
      ok: false,
      status: 304,
      json: async () => {
        throw new Error('304 has no body — a caller reading it is the bug this test catches');
      },
    };
  }

  it('sends no If-None-Match on the first request', async () => {
    const requestInits: { headers?: Record<string, string> }[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (_url, init) => {
        requestInits.push(init ?? {});
        return okWithEtag(homeCatalogueFixture, 'W/"v1"');
      },
    });

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(requestInits[0]?.headers).toBeUndefined();
  });

  it('sends the ETag it was given as If-None-Match on the next request', async () => {
    const requestInits: { headers?: Record<string, string> }[] = [];
    let call = 0;
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (_url, init) => {
        requestInits.push(init ?? {});
        call += 1;
        return call === 1 ? okWithEtag(homeCatalogueFixture, 'W/"v1"') : notModified();
      },
    });

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(requestInits[1]?.headers).toEqual({ 'If-None-Match': 'W/"v1"' });
  });

  it('serves the cached catalogue on a 304 without reading a body', async () => {
    let call = 0;
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async () => {
        call += 1;
        return call === 1 ? okWithEtag(homeCatalogueFixture, 'W/"v1"') : notModified();
      },
    });

    const first = await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    // notModified()'s json() throws if ever called — resolving here proves the
    // 304 path never tried to read a (nonexistent) body, i.e. the download
    // was actually skipped, not just the cache silently re-served.
    const second = await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(second).toEqual(first);
  });

  it('does not cache, and sends no If-None-Match, when the server sends no ETag', async () => {
    const requestInits: { headers?: Record<string, string> }[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (_url, init) => {
        requestInits.push(init ?? {});
        return ok(homeCatalogueFixture);
      },
    });

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(requestInits[1]?.headers).toBeUndefined();
  });

  it('caches per institution, not globally', async () => {
    const requestInits: { headers?: Record<string, string> }[] = [];
    const adapter = new ApiAdapter({
      baseUrl: BASE_URL,
      fetch: async (_url, init) => {
        requestInits.push(init ?? {});
        return okWithEtag(newInstitutionCatalogueFixture, 'W/"other"');
      },
    });

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    await adapter.getHomeCatalogue('inst_a21');

    // The second institution has never been fetched before, so it must not
    // carry the first institution's ETag.
    expect(requestInits[1]?.headers).toBeUndefined();
  });
});
