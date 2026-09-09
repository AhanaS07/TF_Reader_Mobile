// src/model/opds/normalizeSearchFeed.test.ts
// The search-response normalizer, in its own file rather than appended to
// normalize.test.ts: the search endpoint is R3c and unconfirmed, so what is
// asserted here is a SPEC we were handed rather than a frozen sample we were
// given. Keeping the two apart stops a guess being read as a contract.
//
// The fixtures under src/search/fixtures/ are ours and say so; the publication
// blocks inside them are copied unchanged from the frozen samples, so nothing
// here makes a new claim about a `Publication`.
import { CatalogueError } from '@model/errors';
import { normalizeSearchFeed } from '@model/opds/normalize';

import browseInsteadFixture from '@search/fixtures/search-browse-instead.json';
import resultsPage2Fixture from '@search/fixtures/search-results-page-2.json';
import resultsFixture from '@search/fixtures/search-results.json';

describe('a page of results', () => {
  const feed = normalizeSearchFeed(resultsFixture);

  it('normalizes every publication through the same parser a shelf uses', () => {
    expect(feed.publications.map((publication) => publication.id)).toEqual([
      'item_env',
      'item_42',
    ]);
  });

  it('preserves the server order — nothing is re-ranked above the adapter', () => {
    expect(feed.publications[0].title).toBe('Environmental Policy and Air Pollution in China');
  });

  it('reports the server total rather than the page length', () => {
    expect(feed.totalItems).toBe(3);
    expect(feed.publications).toHaveLength(2);
  });

  // The divergence from `normalizeShelf`, which parses a page INDEX out of this
  // href and throws when there isn't one. A search cursor is followed, not
  // understood.
  it('keeps the next link whole, as an opaque value to hand back', () => {
    expect(feed.next).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search?query=climate&page=1',
    );
  });

  it('offers no browse targets on a successful search', () => {
    expect(feed.browseInstead).toEqual([]);
  });
});

describe('the last page', () => {
  const feed = normalizeSearchFeed(resultsPage2Fixture);

  it('has no next, which is how the surface knows to stop offering one', () => {
    expect(feed.next).toBeUndefined();
  });

  it('still carries its publications', () => {
    expect(feed.publications.map((publication) => publication.id)).toEqual(['item_ab6']);
  });
});

// THE CASE THIS WHOLE FILE EXISTS FOR. A zero-result search may come back as a
// navigation feed with no `publications` key at all. That is a valid response and
// a valid empty state — treating it as MALFORMED_FEED would turn the most
// ordinary outcome in the feature into a red error screen.
describe('a zero-result response with no publications key', () => {
  it('has no publications key in the fixture at all', () => {
    expect(browseInsteadFixture).not.toHaveProperty('publications');
  });

  it('does not throw', () => {
    expect(() => normalizeSearchFeed(browseInsteadFixture)).not.toThrow();
  });

  it('normalizes to an empty array rather than undefined', () => {
    expect(normalizeSearchFeed(browseInsteadFixture).publications).toEqual([]);
  });

  // The target reads off the wire's `navigation` key, which is what the FROZEN
  // searchCatalogue operation says a zero-result feed carries. `all` is the
  // reserved groupId, so tapping it opens the whole entitled catalogue.
  it('carries the browse-instead target with a shelfId ready to open', () => {
    expect(normalizeSearchFeed(browseInsteadFixture).browseInstead).toEqual([
      {
        title: 'Browse the full catalogue',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/all',
        shelfId: 'all',
        target: 'shelf',
      },
    ]);
  });
});

describe('absence is tolerated, contradiction is not', () => {
  // Neither key name has been confirmed against a real response, so both are
  // accepted. The day one is confirmed, this test loses a case.
  it('accepts OPDS `navigation` as browse-instead too', () => {
    const feed = normalizeSearchFeed({
      navigation: [{ title: 'eBooks', href: 'https://api.tf/groups/ebooks' }],
    });

    expect(feed.browseInstead).toEqual([
      { title: 'eBooks', href: 'https://api.tf/groups/ebooks', shelfId: 'ebooks', target: 'shelf' },
    ]);
  });

  it('accepts a response carrying nothing but a self link', () => {
    expect(normalizeSearchFeed({ links: [] })).toEqual({
      publications: [],
      browseInstead: [],
    });
  });

  it('accepts an empty publications array, which means the same as omitting it', () => {
    expect(normalizeSearchFeed({ publications: [] }).publications).toEqual([]);
  });

  // A key that is present and the wrong TYPE is a broken feed, not a missing
  // field, and still fails loudly.
  it('rejects a publications key that is not an array', () => {
    expect(() => normalizeSearchFeed({ publications: 'lots' })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a response that is not an object at all', () => {
    expect(() => normalizeSearchFeed('no results')).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a next link with no href', () => {
    expect(() => normalizeSearchFeed({ links: [{ rel: 'next' }] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});
