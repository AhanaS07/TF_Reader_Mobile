// src/search/FixtureSearchPipeline.test.ts
// What is worth asserting about a stub is the parts of it that are NOT stubbed —
// templated-link discovery, expansion, parsing and the `next` round trip. Those
// four survive into Week 4; the canned responses do not.
import { MockAdapter } from '@adapters/MockAdapter';
import { CatalogueError } from '@model/errors';

import { FixtureSearchPipeline } from '@search/FixtureSearchPipeline';

const INSTITUTION = 'inst_7f3';

function pipeline() {
  // The source is injected rather than defaulted, so this suite never touches the
  // process-wide instance `src/config/catalogue.ts` hands out.
  return new FixtureSearchPipeline({ source: new MockAdapter() });
}

describe('the search link is discovered, not hardcoded', () => {
  it('answers for an institution whose catalogue advertises a search link', async () => {
    const feed = await pipeline().search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    expect(feed.publications).not.toHaveLength(0);
  });

  // An institution the catalogue source does not know is NOT_FOUND at the source,
  // never a search against a URL we invented for it.
  it('rejects for an institution with no catalogue', async () => {
    await expect(
      pipeline().search({ institutionId: 'inst_unknown', query: 'climate', filters: {} }),
    ).rejects.toMatchObject({ code: CatalogueError.NOT_FOUND });
  });
});

describe('a query with results', () => {
  it('returns the page in the order the server sent it', async () => {
    const feed = await pipeline().search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    expect(feed.publications.map((publication) => publication.id)).toEqual([
      'item_env',
      'item_42',
    ]);
  });

  it('reports the server total, which exceeds the page', async () => {
    const feed = await pipeline().search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    expect(feed.totalItems).toBe(3);
    expect(feed.publications).toHaveLength(2);
  });

  it('offers a next value to follow', async () => {
    const feed = await pipeline().search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    expect(feed.next).toBeDefined();
  });

  // The query is trimmed on the way into the URL, so these are one request.
  it('treats a padded query as the same request', async () => {
    const padded = await pipeline().search({
      institutionId: INSTITUTION,
      query: '  climate  ',
      filters: {},
    });

    expect(padded.publications.map((publication) => publication.id)).toEqual([
      'item_env',
      'item_42',
    ]);
  });
});

// The stub answers a DIFFERENT request rather than narrowing the previous
// response — which is only possible if the filter reached it as a query
// parameter, before any paging happened.
describe('a filter reaches the request, not the page', () => {
  it('returns a different result set when contentType is applied', async () => {
    const feed = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: { contentType: 'AUDIO' },
    });

    expect(feed.publications.map((publication) => publication.id)).toEqual(['item_stat']);
  });

  it('is not a subset of the unfiltered page, because it was never that page', async () => {
    const unfiltered = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: {},
    });
    const filtered = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: { contentType: 'AUDIO' },
    });

    const unfilteredIds = unfiltered.publications.map((publication) => publication.id);
    expect(unfilteredIds).not.toContain('item_stat');
    expect(filtered.publications.map((publication) => publication.id)).toEqual(['item_stat']);
  });

  it('reports its own total for the filtered set', async () => {
    const feed = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: { contentType: 'AUDIO' },
    });

    expect(feed.totalItems).toBe(1);
  });

  // Q-12: the tier is not sent, so a tier-only change cannot alter the response.
  // When wokay confirm the parameter, this expectation changes deliberately.
  it('does not vary by accessTier while Q-12 is open', async () => {
    const plain = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: {},
    });
    const tiered = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'climate',
      filters: { accessTier: 'ELITE' },
    });

    expect(tiered.publications.map((p) => p.id)).toEqual(plain.publications.map((p) => p.id));
  });
});

describe('pagination follows the next value verbatim', () => {
  it('returns the second page for the cursor the first page carried', async () => {
    const source = pipeline();
    const first = await source.search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    const second = await source.next(first.next as string);

    expect(second.publications.map((publication) => publication.id)).toEqual(['item_ab6']);
  });

  it('ends the run — the last page carries no next', async () => {
    const source = pipeline();
    const first = await source.search({ institutionId: INSTITUTION, query: 'climate', filters: {} });
    const second = await source.next(first.next as string);

    expect(second.next).toBeUndefined();
  });

  it('needs no institution or query, because the cursor already carries them', async () => {
    const source = pipeline();
    const first = await source.search({ institutionId: INSTITUTION, query: 'climate', filters: {} });

    // `next` takes one argument by design: a client that re-sent the query could
    // disagree with what the server encoded in its own cursor.
    await expect(source.next(first.next as string)).resolves.toBeDefined();
  });
});

// The default response, reached by almost any query — which is the point: it is
// impossible to build this surface without meeting the zero-result path.
describe('a query with no results', () => {
  it('RESOLVES rather than rejecting — an empty answer is still an answer', async () => {
    await expect(
      pipeline().search({ institutionId: INSTITUTION, query: 'quantum basket weaving', filters: {} }),
    ).resolves.toBeDefined();
  });

  it('comes back with no publications', async () => {
    const feed = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'quantum basket weaving',
      filters: {},
    });

    expect(feed.publications).toEqual([]);
  });

  it('comes back with somewhere to go instead', async () => {
    const feed = await pipeline().search({
      institutionId: INSTITUTION,
      query: 'quantum basket weaving',
      filters: {},
    });

    expect(feed.browseInstead.map((entry) => entry.shelfId)).toEqual(['all']);
  });
});

describe('injected failure, for building the error state', () => {
  it('rejects with the code it was given', async () => {
    const failing = new FixtureSearchPipeline({
      source: new MockAdapter(),
      failWith: CatalogueError.NETWORK_UNAVAILABLE,
    });

    await expect(
      failing.search({ institutionId: INSTITUTION, query: 'climate', filters: {} }),
    ).rejects.toMatchObject({ code: CatalogueError.NETWORK_UNAVAILABLE });
  });

  it('fails a next page too, so paging has an error path of its own', async () => {
    const failing = new FixtureSearchPipeline({
      source: new MockAdapter(),
      failWith: CatalogueError.TIMEOUT,
    });

    await expect(failing.next('https://api.tf/search?query=climate&page=1')).rejects.toMatchObject({
      code: CatalogueError.TIMEOUT,
    });
  });
});
