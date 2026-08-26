// src/model/institution.test.ts
import { CatalogueError } from '@model/errors';
import { normalizeInstitution, normalizeInstitutionList } from '@model/institution';

import institutionsFixture from '@model/fixtures/institutions.json';

describe('normalizeInstitution', () => {
  it('normalizes a fully populated institution', () => {
    expect(
      normalizeInstitution({
        id: 'inst_7f3',
        name: 'Imperial College London',
        country: 'United Kingdom',
        code: 'ICL',
        city: 'London',
        catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
        branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
      }),
    ).toEqual({
      id: 'inst_7f3',
      name: 'Imperial College London',
      country: 'United Kingdom',
      code: 'ICL',
      city: 'London',
      catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
      branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
    });
  });

  // W-17: no branding means InstitutionRow renders initials instead. The field
  // must be genuinely absent, not present with an empty logoUrl.
  it('omits branding entirely when the institution has none', () => {
    const institution = normalizeInstitution({
      id: 'inst_c88',
      name: 'Kwame Nkrumah University of Science and Technology',
      country: 'Ghana',
      code: 'KNUST',
      city: 'Kumasi',
      catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_c88/catalogue',
    });

    expect(institution.branding).toBeUndefined();
    expect(Object.keys(institution)).not.toContain('branding');
  });

  it('treats an empty logoUrl as no branding rather than a broken URL', () => {
    expect(
      normalizeInstitution({
        id: 'inst_x',
        name: 'Somewhere',
        country: 'Nowhere',
        code: 'SW',
        city: 'Somewhere City',
        catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_x/catalogue',
        branding: { logoUrl: '' },
      }).branding,
    ).toBeUndefined();
  });

  // The real backend does not send this field yet (Q-D, CLAUDE.md), unlike
  // the frozen contract's assumption — must be omittable without failing.
  it('omits catalogueUrl entirely when the institution has none', () => {
    const institution = normalizeInstitution({
      id: 'inst_c88',
      name: 'Kwame Nkrumah University of Science and Technology',
      country: 'Ghana',
      code: 'KNUST',
      city: 'Kumasi',
    });

    expect(institution.catalogueUrl).toBeUndefined();
    expect(Object.keys(institution)).not.toContain('catalogueUrl');
  });

  it('treats an empty catalogueUrl as absent rather than a broken URL', () => {
    expect(
      normalizeInstitution({
        id: 'inst_x',
        name: 'Somewhere',
        country: 'Nowhere',
        code: 'SW',
        city: 'Somewhere City',
        catalogueUrl: '',
      }).catalogueUrl,
    ).toBeUndefined();
  });

  it.each(['id', 'name', 'country', 'code', 'city'])(
    'rejects a missing %s',
    (field) => {
      const complete: Record<string, unknown> = {
        id: 'i',
        name: 'n',
        country: 'c',
        code: 'CD',
        city: 'City',
        catalogueUrl: 'https://api.tf/opds/v1/institutions/i/catalogue',
      };
      delete complete[field];

      expect(() => normalizeInstitution(complete)).toThrow(
        expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
      );
    },
  );
});

describe('normalizeInstitutionList', () => {
  it('normalizes every institution in the paged envelope', () => {
    const institutions = normalizeInstitutionList(institutionsFixture);

    expect(institutions).toHaveLength(8);
    expect(institutions[0].id).toBe('inst_7f3');
  });

  it('rejects a payload with no items array', () => {
    expect(() => normalizeInstitutionList({ total: 0, page: 0, size: 20 })).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a bare array — the published contract always wraps in an envelope', () => {
    expect(() =>
      normalizeInstitutionList([
        {
          id: 'i',
          name: 'n',
          country: 'c',
          code: 'CD',
          city: 'City',
          catalogueUrl: 'https://api.tf/opds/v1/institutions/i/catalogue',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }));
  });
});

// P0-4 mandates specific awkward cases. Asserting them here turns the spec's
// prose requirement into something that fails if a future edit tidies the
// fixtures up.
describe('institution fixtures cover the P0-4 awkward cases', () => {
  const institutions = normalizeInstitutionList(institutionsFixture);

  it('provides the eight institutions P0-4 asks for', () => {
    expect(institutions).toHaveLength(8);
  });

  it('includes the institution the catalogue fixtures belong to', () => {
    expect(institutions.map((i) => i.id)).toContain('inst_7f3');
  });

  it('includes at least one institution with no branding (W-17 initials fallback)', () => {
    expect(institutions.filter((i) => i.branding === undefined).length).toBeGreaterThan(0);
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

  it('every institution has a catalogueUrl', () => {
    expect(institutions.every((i) => (i.catalogueUrl?.length ?? 0) > 0)).toBe(true);
  });
});
