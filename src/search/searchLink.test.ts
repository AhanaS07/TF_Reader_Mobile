// src/search/searchLink.test.ts
// URL construction is the one part of B1 that a screenshot cannot review, so it
// is tested directly and against the REAL frozen template rather than a
// hand-written one — the same reasoning normalize.test.ts gives for using the
// fixtures.
import { normalizeCatalogue } from '@model/opds/normalize';
import { CatalogueError } from '@model/errors';

import homeCatalogue from '@model/fixtures/OPDS-samples/01-home-catalogue.json';

import {
  ACCESS_TIER_FILTER_CONFIRMED,
  expandSearchLink,
  searchParams,
} from '@search/searchLink';

// The template as wokay actually ship it, read out of the frozen sample.
const TEMPLATE = normalizeCatalogue(homeCatalogue).searchHref as string;

describe('the frozen template is what these tests are about', () => {
  it('declares query and nothing else', () => {
    expect(TEMPLATE).toBe('https://api.tf/opds/v1/institutions/inst_7f3/search{?query}');
  });
});

describe('expandSearchLink', () => {
  it('expands a declared variable that was supplied', () => {
    expect(expandSearchLink(TEMPLATE, { query: 'climate' })).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search?query=climate',
    );
  });

  // RFC 6570: a declared variable with nothing supplied contributes nothing. The
  // failure mode this prevents is '?query=', which a server may well read as "you
  // asked for the empty string" rather than "you did not ask".
  it('omits a declared variable that was not supplied', () => {
    expect(expandSearchLink(TEMPLATE, {})).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search',
    );
  });

  it('treats an empty value as not supplied', () => {
    expect(expandSearchLink(TEMPLATE, { query: '' })).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search',
    );
  });

  it('percent-encodes values, so a multi-word query survives the wire', () => {
    expect(expandSearchLink(TEMPLATE, { query: 'climate policy & law' })).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search?query=climate%20policy%20%26%20law',
    );
  });

  it('expands several declared variables in the template order', () => {
    expect(
      expandSearchLink('https://api.tf/search{?query,contentType}', {
        contentType: 'EPUB',
        query: 'climate',
      }),
    ).toBe('https://api.tf/search?query=climate&contentType=EPUB');
  });

  // The documented decision: the frozen template declares only `query`, and B1
  // must still send filters as query parameters. Dropping them would leave the
  // chips visibly inert, which reads as a client bug.
  it('appends supplied parameters the template does not declare', () => {
    expect(expandSearchLink(TEMPLATE, { query: 'climate', contentType: 'AUDIO' })).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search?query=climate&contentType=AUDIO',
    );
  });

  it('opens a query string when the expansion produced none', () => {
    expect(expandSearchLink(TEMPLATE, { contentType: 'AUDIO' })).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search?contentType=AUDIO',
    );
  });

  it('joins onto a query string the template already carried', () => {
    expect(
      expandSearchLink('https://api.tf/search?scope=all{?query}', { contentType: 'PDF' }),
    ).toBe('https://api.tf/search?scope=all&contentType=PDF');
  });

  it('leaves a plain untemplated URL usable', () => {
    expect(expandSearchLink('https://api.tf/search', { query: 'climate' })).toBe(
      'https://api.tf/search?query=climate',
    );
  });

  // Loud at the boundary, like rels.ts. A silently mangled URL surfaces much
  // later as an empty result list with nothing to point at.
  it('rejects an operator it does not implement rather than guessing', () => {
    expect(() => expandSearchLink('https://api.tf/search{+query}', { query: 'x' })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects an expression declaring no variables', () => {
    expect(() => expandSearchLink('https://api.tf/search{?}', {})).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});

describe('searchParams — filters travel as query parameters', () => {
  it('sends the query trimmed', () => {
    expect(searchParams('  climate  ', {})).toEqual({ query: 'climate' });
  });

  it('omits a blank query entirely', () => {
    expect(searchParams('   ', {})).toEqual({});
  });

  // The heart of "filters before pagination": the filter is part of the SAME
  // request as the query, so the server narrows before it pages. There is no
  // second, local pass over what came back.
  it('sends an active contentType filter alongside the query', () => {
    expect(searchParams('climate', { contentType: 'AUDIO' })).toEqual({
      query: 'climate',
      contentType: 'AUDIO',
    });
  });

  it('omits an unconstrained dimension rather than sending a value for "all"', () => {
    expect(searchParams('climate', {})).toEqual({ query: 'climate' });
  });

  it('sends a filter with no query, so a filter alone is still a request', () => {
    expect(searchParams('', { contentType: 'EPUB' })).toEqual({ contentType: 'EPUB' });
  });
});

// Q-12 is open: with no tier field anywhere, is `?accessTier=` a parameter the
// search endpoint accepts at all? The repository cannot answer it, so nothing is
// sent. This test is the tripwire — flipping the constant when wokay confirm will
// fail here, which is the reminder to update the expectation deliberately rather
// than discovering the parameter went live by accident.
describe('accessTier is withheld while Q-12 is open', () => {
  it('is not confirmed by anything in the repository', () => {
    expect(ACCESS_TIER_FILTER_CONFIRMED).toBe(false);
  });

  it('does not send the parameter even when a tier is selected', () => {
    expect(searchParams('climate', { accessTier: 'OPEN_ACCESS' })).toEqual({
      query: 'climate',
    });
  });

  it('never reaches the URL', () => {
    expect(
      expandSearchLink(TEMPLATE, searchParams('climate', { accessTier: 'ELITE' })),
    ).not.toContain('accessTier');
  });
});
