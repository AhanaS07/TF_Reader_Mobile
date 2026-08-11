// src/model/opds/rels.test.ts
// The three normalization seams the fixtures forced, tested in isolation before
// anything composes them.
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import { toActionId, toContentFormat, toAlgorithm, idFromHref } from '@model/opds/rels';

describe('toActionId', () => {
  it('maps the borrow rel to borrow', () => {
    expect(toActionId('http://opds-spec.org/acquisition/borrow')).toBe('borrow');
  });

  it('maps the bare acquisition rel to acquire', () => {
    expect(toActionId('http://opds-spec.org/acquisition')).toBe('acquire');
  });

  it('maps the open-access rel to openAccess', () => {
    expect(toActionId('http://opds-spec.org/acquisition/open-access')).toBe('openAccess');
  });

  // A rel we do not understand means the action vocabulary moved under us
  // (L-3 is explicitly unsettled). Guessing would put a wrong button in the UI.
  it('rejects an unknown rel as a malformed feed', () => {
    expect(() => toActionId('http://opds-spec.org/acquisition/buy')).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});

describe('toContentFormat', () => {
  it('maps application/pdf to PDF', () => {
    expect(toContentFormat('application/pdf')).toBe('PDF');
  });

  it('maps application/epub+zip to EPUB', () => {
    expect(toContentFormat('application/epub+zip')).toBe('EPUB');
  });

  it('maps audio/mpeg to AUDIO', () => {
    expect(toContentFormat('audio/mpeg')).toBe('AUDIO');
  });

  it('rejects an unknown mime type as a malformed feed', () => {
    expect(() => toContentFormat('application/x-mobipocket-ebook')).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});

describe('toAlgorithm', () => {
  // Seam 1: the feed says W3C URI, the frozen EncryptionDescriptor says literal.
  it('maps the W3C xmlenc URI to the literal the encryption contract uses', () => {
    expect(toAlgorithm('http://www.w3.org/2009/xmlenc11#aes256-gcm')).toBe('AES-256-GCM');
  });

  // Passing an unrecognised algorithm through would hand the crypto layer
  // something it cannot honour, and it would fail much later with no context.
  it('rejects an unknown algorithm rather than passing it through', () => {
    let caught: unknown;
    try {
      toAlgorithm('http://www.w3.org/2001/04/xmlenc#aes128-cbc');
    } catch (err) {
      caught = err;
    }
    expect(isCatalogueFailure(caught)).toBe(true);
    expect((caught as { code: CatalogueError }).code).toBe(CatalogueError.MALFORMED_FEED);
  });
});

describe('idFromHref', () => {
  it('takes the last path segment as the id', () => {
    expect(idFromHref('https://api.tf/opds/v1/institutions/inst_7f3/publications/item_42')).toBe(
      'item_42',
    );
  });

  it('ignores a query string when taking the id', () => {
    expect(
      idFromHref('https://api.tf/opds/v1/institutions/inst_7f3/groups/ebooks?page=1'),
    ).toBe('ebooks');
  });

  it('rejects an href with no usable segment', () => {
    expect(() => idFromHref('https://api.tf')).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});
