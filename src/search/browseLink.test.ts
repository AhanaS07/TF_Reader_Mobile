// src/search/browseLink.test.ts
// URL construction for the browse half of the shared query helper, against the
// REAL fixture hrefs rather than hand-written ones — same reasoning
// searchLink.test.ts gives for using the frozen fixtures.
import { normalizeCatalogue } from '@model/opds/normalize';

import homeCatalogue from '@model/fixtures/OPDS-samples/01-home-catalogue.json';

import { browseParams } from '@search/browseLink';
import { expandSearchLink } from '@search/searchLink';

// Plain hrefs, not templated — the "all" shelf and a curated shelf, read out of
// the home-catalogue fixture rather than hand-written.
const catalogue = normalizeCatalogue(homeCatalogue);
const ALL_HREF = catalogue.navigation.find((link) => link.shelfId === 'all')?.href as string;
const CURATED_HREF = catalogue.navigation.find((link) => link.shelfId === 'shelf_1')
  ?.href as string;

describe('the fixture hrefs these tests are about', () => {
  it('are plain, untemplated URLs', () => {
    expect(ALL_HREF).toBe('https://api.tf/opds/v1/institutions/inst_7f3/groups/all');
    expect(CURATED_HREF).toBe('https://api.tf/opds/v1/institutions/inst_7f3/groups/shelf_1');
  });
});

describe('browseParams', () => {
  it('sends an active contentType filter', () => {
    expect(browseParams('all', { contentType: 'AUDIO' })).toEqual({ contentType: 'AUDIO' });
  });

  it('sends an active accessTier filter', () => {
    expect(browseParams('all', { accessTier: 'ELITE' })).toEqual({ accessTier: 'ELITE' });
  });

  it('omits an unconstrained dimension rather than sending a value for "all"', () => {
    expect(browseParams('all', {})).toEqual({});
  });

  it('sends sort for the "all" shelf', () => {
    expect(browseParams('all', {}, 'title.asc')).toEqual({ sort: 'title.asc' });
  });

  // The contract is explicit: sort is ignored on a curated shelf, the operator's
  // hand-picked order being the order. Sending it anyway would be a parameter
  // that lies about what it does.
  it('drops sort on a curated shelf', () => {
    expect(browseParams('shelf_1', {}, 'title.asc')).toEqual({});
  });

  it('combines every accepted dimension for the "all" shelf', () => {
    expect(
      browseParams('all', { contentType: 'PDF', accessTier: 'SUBSCRIPTION' }, 'title.desc'),
    ).toEqual({
      contentType: 'PDF',
      accessTier: 'SUBSCRIPTION',
      sort: 'title.desc',
    });
  });
});

describe('browseParams composed with the shared expansion', () => {
  it('appends filters onto the plain "all" href', () => {
    expect(
      expandSearchLink(ALL_HREF, browseParams('all', { contentType: 'EPUB' }, 'publishedAt.desc')),
    ).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/groups/all?contentType=EPUB&sort=publishedAt.desc',
    );
  });

  it('leaves a curated shelf href unchanged when nothing is sendable', () => {
    expect(expandSearchLink(CURATED_HREF, browseParams('shelf_1', {}, 'title.asc'))).toBe(
      CURATED_HREF,
    );
  });

  it('still sends contentType on a curated shelf — only sort is withheld', () => {
    expect(
      expandSearchLink(
        CURATED_HREF,
        browseParams('shelf_1', { contentType: 'AUDIO' }, 'title.asc'),
      ),
    ).toBe(`${CURATED_HREF}?contentType=AUDIO`);
  });
});
