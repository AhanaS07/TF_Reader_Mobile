// src/model/institution.test.ts
import { CatalogueError } from '@model/errors';
import {
  AUTH_TYPES,
  normalizeInstitution,
  normalizeInstitutionList,
} from '@model/institution';

import institutionsFixture from '@model/fixtures/institutions.json';

describe('normalizeInstitution', () => {
  it('normalizes a fully populated institution', () => {
    expect(
      normalizeInstitution({
        id: 'inst_7f3',
        name: 'Imperial College London',
        country: 'United Kingdom',
        crestUrl: 'https://cdn.tf/crests/inst_7f3.png',
        authType: 'saml',
      }),
    ).toEqual({
      id: 'inst_7f3',
      name: 'Imperial College London',
      country: 'United Kingdom',
      crestUrl: 'https://cdn.tf/crests/inst_7f3.png',
      authType: 'saml',
    });
  });

  // W-17: no crest means InstitutionRow renders initials instead. The field must
  // be genuinely absent, not an empty string, or the row will try to load ''.
  it('omits crestUrl entirely when the institution has no crest', () => {
    const institution = normalizeInstitution({
      id: 'inst_c88',
      name: 'Kwame Nkrumah University of Science and Technology',
      country: 'Ghana',
      authType: 'oidc',
    });

    expect(institution.crestUrl).toBeUndefined();
    expect(Object.keys(institution)).not.toContain('crestUrl');
  });

  it('treats an empty crestUrl as no crest rather than a broken URL', () => {
    expect(
      normalizeInstitution({
        id: 'inst_x',
        name: 'Somewhere',
        country: 'Nowhere',
        crestUrl: '',
        authType: 'email',
      }).crestUrl,
    ).toBeUndefined();
  });

  // CAP-3: 'unknown' is a legitimate value, not missing data — it routes sign-in
  // to the fallback path. It must survive normalization untouched.
  it('accepts unknown as a real authType', () => {
    expect(
      normalizeInstitution({
        id: 'inst_e62',
        name: 'Indian Institute of Technology Bombay',
        country: 'India',
        authType: 'unknown',
      }).authType,
    ).toBe('unknown');
  });

  it('accepts every member of AUTH_TYPES', () => {
    for (const authType of AUTH_TYPES) {
      expect(
        normalizeInstitution({ id: 'i', name: 'n', country: 'c', authType }).authType,
      ).toBe(authType);
    }
  });

  // An auth type we do not recognise cannot be routed. Defaulting it to 'unknown'
  // would silently send a SAML institution down the email path.
  it('rejects an authType outside the union', () => {
    expect(() =>
      normalizeInstitution({ id: 'i', name: 'n', country: 'c', authType: 'ldap' }),
    ).toThrow(expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }));
  });

  it('rejects a missing authType rather than guessing', () => {
    expect(() => normalizeInstitution({ id: 'i', name: 'n', country: 'c' })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it.each(['id', 'name', 'country'])('rejects a missing %s', (field) => {
    const complete: Record<string, unknown> = {
      id: 'i',
      name: 'n',
      country: 'c',
      authType: 'saml',
    };
    delete complete[field];

    expect(() => normalizeInstitution(complete)).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});

describe('normalizeInstitutionList', () => {
  it('normalizes every institution in the envelope', () => {
    const institutions = normalizeInstitutionList(institutionsFixture);

    expect(institutions).toHaveLength(8);
    expect(institutions[0].id).toBe('inst_7f3');
  });

  it('rejects a payload with no institutions array', () => {
    expect(() => normalizeInstitutionList({ items: [] })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('accepts a bare array, since the envelope is still provisional', () => {
    expect(
      normalizeInstitutionList([{ id: 'i', name: 'n', country: 'c', authType: 'saml' }]),
    ).toHaveLength(1);
  });
});

// P0-4 mandates specific awkward cases. Asserting them here turns the spec's
// prose requirement into something that fails if a future edit tidies the
// fixtures up — which is exactly how "40 tidy books" happens.
describe('institution fixtures cover the P0-4 awkward cases', () => {
  const institutions = normalizeInstitutionList(institutionsFixture);

  it('provides the eight institutions P0-4 asks for', () => {
    expect(institutions).toHaveLength(8);
  });

  it('includes the institution the catalogue fixtures belong to', () => {
    // Without this, institution selection could never reach a real catalogue.
    expect(institutions.map((i) => i.id)).toContain('inst_7f3');
  });

  it('includes at least one institution with no crest (W-17 initials fallback)', () => {
    expect(institutions.filter((i) => i.crestUrl === undefined).length).toBeGreaterThan(0);
  });

  it('includes at least one institution with authType unknown (CAP-3 fallback)', () => {
    expect(institutions.filter((i) => i.authType === 'unknown').length).toBeGreaterThan(0);
  });

  it('spans more than one country, so the country line is not decorative', () => {
    expect(new Set(institutions.map((i) => i.country)).size).toBeGreaterThan(1);
  });

  it('includes a name long enough to exercise truncation', () => {
    expect(Math.max(...institutions.map((i) => i.name.length))).toBeGreaterThan(60);
  });

  it('gives every institution a unique id', () => {
    expect(new Set(institutions.map((i) => i.id)).size).toBe(institutions.length);
  });
});
