// src/model/errorCopy.test.ts
// Guards the contract WIRE_ERROR_COPY exists for: every published wire code has
// copy, the copy never leaks an HTTP status, and OFFER_EXPIRED's copy carries
// the half a reader will not guess on their own (rejoining the queue).
import { ERROR_CODES } from '@model/types';
import { CatalogueError } from '@model/errors';
import {
  CATALOGUE_ERROR_COPY,
  catalogueErrorVariant,
  WIRE_ERROR_COPY,
  WIRE_ERROR_VARIANT,
  wireErrorVariant,
} from '@model/errorCopy';

const CATALOGUE_ERROR_CODES = Object.values(CatalogueError);

describe('CATALOGUE_ERROR_COPY', () => {
  it('has an entry for every CatalogueError member', () => {
    expect(Object.keys(CATALOGUE_ERROR_COPY).sort()).toEqual([...CATALOGUE_ERROR_CODES].sort());
  });

  it('has a non-empty sentence for every code', () => {
    for (const code of CATALOGUE_ERROR_CODES) {
      expect(CATALOGUE_ERROR_COPY[code].length).toBeGreaterThan(0);
    }
  });

  it('never leaks an HTTP status or other digit to the reader', () => {
    for (const code of CATALOGUE_ERROR_CODES) {
      expect(CATALOGUE_ERROR_COPY[code]).not.toMatch(/\d/);
    }
  });
});

describe('catalogueErrorVariant', () => {
  it('has a variant for every CatalogueError member', () => {
    for (const code of CATALOGUE_ERROR_CODES) {
      expect(catalogueErrorVariant(code)).toBeDefined();
    }
  });

  it('resolves NOT_FOUND to the one non-retryable variant', () => {
    expect(catalogueErrorVariant(CatalogueError.NOT_FOUND)).toBe('not_found');
  });

  it('resolves NETWORK_UNAVAILABLE and TIMEOUT to retryable variants', () => {
    expect(catalogueErrorVariant(CatalogueError.NETWORK_UNAVAILABLE)).toBe('network');
    expect(catalogueErrorVariant(CatalogueError.TIMEOUT)).toBe('not_ready');
  });
});

describe('WIRE_ERROR_COPY', () => {
  it('has an entry for every published error code', () => {
    expect(Object.keys(WIRE_ERROR_COPY).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('has a non-empty sentence for every code', () => {
    for (const code of ERROR_CODES) {
      expect(WIRE_ERROR_COPY[code].length).toBeGreaterThan(0);
    }
  });

  it('never leaks an HTTP status or other digit to the reader', () => {
    for (const code of ERROR_CODES) {
      expect(WIRE_ERROR_COPY[code]).not.toMatch(/\d/);
    }
  });

  it('tells the reader they have rejoined the queue when an offer expires', () => {
    expect(WIRE_ERROR_COPY.OFFER_EXPIRED.toLowerCase()).toContain('queue');
  });
});

describe('WIRE_ERROR_VARIANT', () => {
  it('has an entry for every published error code', () => {
    expect(Object.keys(WIRE_ERROR_VARIANT).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('resolves NOT_FOUND to the one non-retryable, non-restricted variant', () => {
    expect(wireErrorVariant('NOT_FOUND')).toBe('not_found');
  });
});
