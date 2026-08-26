import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import type { Institution } from '@model/institution';
import { searchInstitutions } from './searchInstitutions';

const IMPERIAL: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

function fakeSource(results: Institution[]): DataSource {
  return {
    getInstitutions: jest.fn().mockResolvedValue(results),
    getInstitution: jest.fn(),
    getFeed: jest.fn(),
    getEntry: jest.fn(),
    searchFeed: jest.fn(),
    getNavigationFeed: jest.fn(),
  } as unknown as DataSource;
}

afterEach(() => {
  setCatalogueSource(undefined);
});

describe('searchInstitutions', () => {
  it('delegates to getCatalogueSource().getInstitutions with the given params', async () => {
    const source = fakeSource([IMPERIAL]);
    setCatalogueSource(source);

    const result = await searchInstitutions({ q: 'Imperial', page: 0, size: 20 });

    expect(source.getInstitutions).toHaveBeenCalledWith({ q: 'Imperial', page: 0, size: 20 });
    expect(result).toEqual([IMPERIAL]);
  });

  it('passes undefined params through unchanged', async () => {
    const source = fakeSource([]);
    setCatalogueSource(source);

    await searchInstitutions();

    expect(source.getInstitutions).toHaveBeenCalledWith(undefined);
  });
});
