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

  // The fourth rel, and the reason the whole feed used to die on it: an
  // unrecognised rel throws, so one unobtainable title took down the page it
  // arrived on. Mapping it here is only half the job — see the gap test in
  // normalize.test.ts.
  it('maps the subscribe rel to subscribe', () => {
    expect(toActionId('http://opds-spec.org/acquisition/subscribe')).toBe('subscribe');
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

  // The contract's own indirectAcquisition.type is a free-form string (no
  // enum) — "the media type of the book itself" — so an audiobook is never
  // guaranteed to arrive as audio/mpeg. wokay's real backend sends audio/wav
  // for at least one shelf, which used to 404 the whole shelf as MALFORMED_FEED.
  it('maps audio/wav to AUDIO', () => {
    expect(toContentFormat('audio/wav')).toBe('AUDIO');
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
      idFromHref('https://api.tf/opds/v1/institutions/inst_7f3/groups/shelf_2?page=1'),
    ).toBe('shelf_2');
  });

  it('rejects an href with no usable segment', () => {
    expect(() => idFromHref('https://api.tf')).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});
