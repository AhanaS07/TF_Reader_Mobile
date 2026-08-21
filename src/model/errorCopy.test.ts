// src/model/errorCopy.test.ts
// Guards the contract WIRE_ERROR_COPY exists for: every published wire code has
// copy, the copy never leaks an HTTP status, and OFFER_EXPIRED's copy carries
// the half a reader will not guess on their own (rejoining the queue).
import { ERROR_CODES } from '@model/types';
import { WIRE_ERROR_COPY, WIRE_ERROR_VARIANT, wireErrorVariant } from '@model/errorCopy';

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
