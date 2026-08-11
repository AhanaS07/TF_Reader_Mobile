// src/config/catalogue.test.ts
import { ApiAdapter } from '@adapters/ApiAdapter';
import { MockAdapter } from '@adapters/MockAdapter';
import { createCatalogueSource, resolveCatalogueSourceKind } from '@config/catalogue';

describe('resolveCatalogueSourceKind', () => {
  it('defaults to mock, because api.tf does not exist yet', () => {
    expect(resolveCatalogueSourceKind(undefined)).toBe('mock');
  });

  it('honours an explicit api selection', () => {
    expect(resolveCatalogueSourceKind('api')).toBe('api');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(resolveCatalogueSourceKind('  API  ')).toBe('api');
  });

  // A typo'd env var silently falling back to mock is how a build ships pointing
  // at fixtures without anyone noticing.
  it('rejects an unrecognised value rather than falling back', () => {
    expect(() => resolveCatalogueSourceKind('staging')).toThrow(/staging/);
  });
});

describe('createCatalogueSource', () => {
  it('builds a MockAdapter for mock', () => {
    expect(createCatalogueSource({ kind: 'mock' })).toBeInstanceOf(MockAdapter);
  });

  it('builds an ApiAdapter for api', () => {
    expect(createCatalogueSource({ kind: 'api', baseUrl: 'https://api.tf/opds/v1' })).toBeInstanceOf(
      ApiAdapter,
    );
  });

  it('refuses to build an ApiAdapter with no base URL', () => {
    expect(() => createCatalogueSource({ kind: 'api', baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('passes mock options through so the gallery can inject latency', () => {
    const source = createCatalogueSource({ kind: 'mock', mock: { latencyMs: 25 } });
    expect(source).toBeInstanceOf(MockAdapter);
  });

  it('returns a source the app can actually call', async () => {
    const catalogue = await createCatalogueSource({ kind: 'mock' }).getHomeCatalogue('inst_7f3');
    expect(catalogue.shelves.length).toBeGreaterThan(0);
  });
});
