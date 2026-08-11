// src/model/opds/normalize.test.ts
// Normalizer tests run against the REAL frozen fixtures, not hand-written OPDS.
// A stub would only ever prove the normalizer agrees with my idea of the wire
// format; the fixtures are wokay's actual snapshots, so they catch the cases I
// would not have thought to invent (non-ISBN identifiers, a metadata-less
// audiobook, a shelf whose title differs from its id).
import { CatalogueError } from '@model/errors';
import { normalizeCatalogue, normalizeShelf, normalizePublication } from '@model/opds/normalize';

import homeCatalogue from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import shelfGroup from '@model/fixtures/OPDS-samples/02-shelf-group.json';
import publicationDetail from '@model/fixtures/OPDS-samples/03-publication-detail.json';

describe('normalizeCatalogue', () => {
  const catalogue = normalizeCatalogue(homeCatalogue);

  it('lifts the feed title and modified stamp', () => {
    expect(catalogue.title).toBe('Imperial College London Library');
    expect(catalogue.modified).toBe('2026-08-10T09:00:00Z');
  });

  it('keeps the templated search href unexpanded for the search feature', () => {
    expect(catalogue.searchHref).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search{?query}',
    );
  });

  it('turns navigation into data with a shelfId per entry', () => {
    expect(catalogue.navigation).toEqual([
      {
        title: 'eBooks',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/ebooks',
        shelfId: 'ebooks',
      },
      {
        title: 'Audiobooks',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/audiobooks',
        shelfId: 'audiobooks',
      },
      {
        title: 'Open access',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/open-access',
        shelfId: 'open-access',
      },
    ]);
  });

  it('normalizes each group into a shelf identified by href, not by title', () => {
    expect(catalogue.shelves.map((s) => [s.id, s.title])).toEqual([
      ['new-this-term', 'New this term'],
      // Title and id genuinely diverge here — this shelf is "Free to read" but
      // points at the same 'open-access' group the nav calls "Open access".
      ['open-access', 'Free to read'],
    ]);
  });

  it('reports a home shelf total but no paging, since a preview has no next page', () => {
    const [firstShelf] = catalogue.shelves;
    expect(firstShelf.publications).toHaveLength(3);
    // Groups do carry numberOfItems...
    expect(firstShelf.totalItems).toBe(3);
    // ...but no `next` link and no itemsPerPage, so there is nothing to page to.
    expect(firstShelf.itemsPerPage).toBeUndefined();
    expect(firstShelf.nextPage).toBeUndefined();
  });
});

describe('normalizeCatalogue publications', () => {
  const catalogue = normalizeCatalogue(homeCatalogue);
  const [newThisTerm, freeToRead] = catalogue.shelves;
  const [borrowable, unlimited, audiobook] = newThisTerm.publications;
  const [openAccess] = freeToRead.publications;

  it('identifies a publication by its self-href tail, not its ISBN', () => {
    expect(borrowable.id).toBe('item_42');
  });

  it('flattens author objects to names and unwraps the ISBN urn', () => {
    expect(borrowable.title).toBe('Rights for Robots');
    expect(borrowable.authors).toEqual(['Joshua C. Gellers']);
    expect(borrowable.publisher).toBe('Routledge');
    expect(borrowable.subjects).toEqual(['Law', 'Technology']);
    expect(borrowable.isbn).toBe('9780367211745');
  });

  it('reads format from the acquisition link rather than the metadata type', () => {
    expect(borrowable.format).toBe('PDF');
  });

  it('carries licence inputs without interpreting them', () => {
    expect(borrowable.acquisition).toEqual({
      actionId: 'borrow',
      href: 'https://api.tf/api/v1/loans?itemId=item_42',
      licenceModel: 'CONCURRENT',
      copiesTotal: 2,
      encryption: { algorithm: 'AES-256-GCM', originalLength: 6373752 },
      hasSearchIndex: true,
      canPersist: false,
    });
  });

  it('maps a bare acquisition rel to acquire and omits copies when unlimited', () => {
    expect(unlimited.acquisition.actionId).toBe('acquire');
    expect(unlimited.acquisition.licenceModel).toBe('UNLIMITED');
    expect(unlimited.acquisition.copiesTotal).toBeUndefined();
  });

  it('gives audio a null encryption and no search index', () => {
    expect(audiobook.format).toBe('AUDIO');
    // null, never undefined: the frozen contract defines null as "plaintext".
    expect(audiobook.acquisition.encryption).toBeNull();
    expect(audiobook.acquisition.hasSearchIndex).toBe(false);
  });

  it('leaves isbn undefined when the identifier is not an ISBN urn', () => {
    // 'urn:tf:catalogue:item_stat' is a catalogue urn — storing its tail as an
    // ISBN would be a plausible-looking lie.
    expect(audiobook.isbn).toBeUndefined();
  });

  it('treats open access as unlicensed and unencrypted', () => {
    expect(openAccess.acquisition.actionId).toBe('openAccess');
    expect(openAccess.format).toBe('EPUB');
    expect(openAccess.acquisition.licenceModel).toBeUndefined();
    expect(openAccess.acquisition.encryption).toBeNull();
    expect(openAccess.acquisition.canPersist).toBe(true);
  });

  it('uses the only image as the cover and sets no thumbnail', () => {
    expect(borrowable.coverUrl).toBe('https://cdn.tf/covers/item_42.jpg');
    expect(borrowable.thumbnailUrl).toBeUndefined();
  });
});

describe('normalizeShelf', () => {
  const shelf = normalizeShelf(shelfGroup);

  it('identifies the shelf from its self href, ignoring the page query', () => {
    expect(shelf.id).toBe('ebooks');
    expect(shelf.title).toBe('eBooks');
  });

  it('carries server-reported pagination', () => {
    expect(shelf.totalItems).toBe(3);
    expect(shelf.itemsPerPage).toBe(2);
  });

  it('derives the next page index from the next link', () => {
    expect(shelf.nextPage).toBe(1);
  });

  it('normalizes every publication in the page', () => {
    expect(shelf.publications.map((p) => p.id)).toEqual(['item_42', 'item_env']);
  });
});

describe('normalizePublication', () => {
  const publication = normalizePublication(publicationDetail);

  it('lifts the detail-only fields the summary lacks', () => {
    expect(publication.subtitle).toBe(
      'Artificial Intelligence, Animal and Environmental Law',
    );
    expect(publication.description).toContain('Bringing a unique perspective');
    expect(publication.numberOfPages).toBe(212);
    expect(publication.language).toBe('en');
    expect(publication.published).toBe('2020-09-30');
  });

  it('picks the widest image as cover and the narrowest as thumbnail', () => {
    expect(publication.coverUrl).toBe('https://cdn.tf/covers/item_42.jpg');
    expect(publication.thumbnailUrl).toBe('https://cdn.tf/covers/item_42-thumb.jpg');
  });
});

describe('normalizePublication rejects feeds it cannot honour', () => {
  it('rejects a publication with no acquisition link', () => {
    const noAcquisition = {
      metadata: { title: 'Orphan' },
      links: [
        {
          rel: 'self',
          href: 'https://api.tf/opds/v1/institutions/inst_7f3/publications/item_x',
          type: 'application/opds-publication+json',
        },
      ],
    };
    expect(() => normalizePublication(noAcquisition)).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a publication with no title', () => {
    const untitled = {
      metadata: {},
      links: [
        {
          rel: 'self',
          href: 'https://api.tf/opds/v1/institutions/inst_7f3/publications/item_y',
          type: 'application/opds-publication+json',
        },
        {
          rel: 'http://opds-spec.org/acquisition',
          href: 'https://api.tf/api/v1/loans?itemId=item_y',
          type: 'application/pdf',
          properties: { hasSearchIndex: false, canPersist: true },
        },
      ],
    };
    expect(() => normalizePublication(untitled)).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });

  it('rejects a publication with no self link, since it would have no id', () => {
    const noSelf = {
      metadata: { title: 'Anonymous' },
      links: [
        {
          rel: 'http://opds-spec.org/acquisition',
          href: 'https://api.tf/api/v1/loans?itemId=item_z',
          type: 'application/pdf',
          properties: { hasSearchIndex: false, canPersist: true },
        },
      ],
    };
    expect(() => normalizePublication(noSelf)).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});
