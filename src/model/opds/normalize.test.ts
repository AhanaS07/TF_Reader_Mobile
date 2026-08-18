// src/model/opds/normalize.test.ts
// Normalizer tests run against the REAL fixtures, not hand-written OPDS. A stub
// would only ever prove the normalizer agrees with my idea of the wire format;
// the fixtures are built from the pinned contracts in docs/contracts/, so they
// carry cases I would not have thought to invent (non-ISBN identifiers, an
// audiobook with no page count, a shelf whose title differs from its id).
//
// Hand-built documents appear below only for cases a legal feed cannot express —
// a malformed feed, or a shelf count no single institution would have.
import { CatalogueError } from '@model/errors';
import { normalizeCatalogue, normalizeShelf, normalizePublication } from '@model/opds/normalize';

import homeCatalogue from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import newInstitutionCatalogue from '@model/fixtures/OPDS-samples/02-home-catalogue-new-institution.json';
import shelfPage0 from '@model/fixtures/OPDS-samples/03-shelf-all-page0.json';
import publicationDetail from '@model/fixtures/OPDS-samples/07-publication-detail.json';

describe('normalizeCatalogue', () => {
  const catalogue = normalizeCatalogue(homeCatalogue);

  it('lifts the feed title and modified stamp', () => {
    expect(catalogue.title).toBe('Imperial College London Library');
    expect(catalogue.modified).toBe('2026-08-16T08:30:00Z');
  });

  it('keeps the templated search href unexpanded for the search feature', () => {
    expect(catalogue.searchHref).toBe(
      'https://api.tf/opds/v1/institutions/inst_7f3/search{?query}',
    );
  });

  it('turns navigation into data with a shelfId per entry', () => {
    expect(catalogue.navigation).toEqual([
      {
        title: 'All titles',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/all',
        shelfId: 'all',
      },
      {
        title: 'New this month',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/shelf_1',
        shelfId: 'shelf_1',
      },
      // A title an administrator typed. Long, and about a subject rather than a
      // content type — nothing may shorten, relabel or reorder it.
      {
        title: 'Nineteenth-century literary criticism',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/shelf_2',
        shelfId: 'shelf_2',
      },
      {
        title: 'Audio picks',
        href: 'https://api.tf/opds/v1/institutions/inst_7f3/groups/shelf_3',
        shelfId: 'shelf_3',
      },
    ]);
  });

  it('normalizes each group into a shelf identified by href, not by title', () => {
    expect(catalogue.shelves.map((s) => [s.id, s.title])).toEqual([
      ['shelf_1', 'New this month'],
      // Title and id genuinely diverge, and so do the two titles for this same
      // shelf: the nav row calls it "Nineteenth-century literary criticism" while
      // its own feed calls it this. Both are correct. Render what you were given.
      ['shelf_2', 'Criticism & theory, 1800–1899'],
      ['shelf_3', 'Audio picks'],
    ]);
  });

  it('reports a home shelf total but no paging, since a preview has no next page', () => {
    const [firstShelf] = catalogue.shelves;
    expect(firstShelf.publications).toHaveLength(2);
    // Groups do carry numberOfItems...
    expect(firstShelf.totalItems).toBe(2);
    // ...but no `next` link and no itemsPerPage, so there is nothing to page to.
    expect(firstShelf.itemsPerPage).toBeUndefined();
    expect(firstShelf.nextPage).toBeUndefined();
  });

  // Range proven synthetically: a fixture can only ever show one institution's
  // choice, and the count is the administrator's (AGENTS.md L-5).
  function catalogueWithNavigation(entries: { title: string; href: string }[]) {
    return {
      metadata: { title: 'Somewhere Library' },
      links: [
        {
          rel: 'self',
          href: 'https://api.tf/opds/v1/institutions/inst_zzz/catalogue',
          type: 'application/opds+json',
        },
      ],
      navigation: entries.map((entry) => ({
        ...entry,
        type: 'application/opds+json',
        rel: 'subsection',
      })),
    };
  }

  it('keeps every navigation entry, in order, however many arrive', () => {
    const titles = [
      'All titles',
      'Nineteenth-century literary criticism',
      'Audio picks',
      'Reading lists, Michaelmas',
      'Open monographs',
      'Theses and dissertations',
      'Reference and dictionaries',
      'Recently returned',
    ];
    const entries = titles.map((title, index) => ({
      title,
      // Ids that mean nothing and are not in title order, so an implementation
      // that sorted or derived either one from the other would show up here.
      href: `https://api.tf/opds/v1/institutions/inst_zzz/groups/s${titles.length - index}`,
    }));

    const many = normalizeCatalogue(catalogueWithNavigation(entries));

    expect(many.navigation).toHaveLength(titles.length);
    expect(many.navigation.map((entry) => entry.title)).toEqual(titles);
    expect(many.navigation.map((entry) => entry.shelfId)).toEqual([
      's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1',
    ]);
  });

  it('accepts a single navigation entry, the whole row for a new institution', () => {
    const one = normalizeCatalogue(
      catalogueWithNavigation([
        { title: 'All titles', href: 'https://api.tf/opds/v1/institutions/inst_zzz/groups/all' },
      ]),
    );

    expect(one.navigation.map((entry) => entry.shelfId)).toEqual(['all']);
  });

  it('reads a feed whose administrator has curated no shelves at all', () => {
    const bare = normalizeCatalogue(newInstitutionCatalogue);

    // No `groups` key. Absent is not malformed — the contract says an array with
    // nothing to put in it is omitted, and a brand new institution has none.
    expect(bare.shelves).toEqual([]);
    expect(bare.navigation).toHaveLength(1);
  });
});

describe('normalizeCatalogue publications', () => {
  const catalogue = normalizeCatalogue(homeCatalogue);
  const rows = catalogue.shelves.flatMap((shelf) => shelf.publications);
  const find = (id: string) => {
    const found = rows.find((row) => row.id === id);
    if (found === undefined) throw new Error(`fixture has no ${id}`);
    return found;
  };
  const borrowable = find('item_42');
  const subscription = find('item_soc');
  const audiobook = find('item_stat');
  const openAccess = find('item_aud2');

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
      licenceModel: 'ELITE',
      copiesTotal: 2,
      encryption: { algorithm: 'AES-256-GCM', originalLength: 6373752 },
      hasSearchIndex: true,
      canPersist: false,
    });
  });

  it('omits copies for a tier that has no copy limit', () => {
    // `copies` is ELITE-only; a subscription is not counted in seats.
    expect(subscription.acquisition.licenceModel).toBe('SUBSCRIPTION');
    expect(subscription.acquisition.copiesTotal).toBeUndefined();
  });

  it('maps a bare acquisition rel to acquire', () => {
    expect(audiobook.acquisition.actionId).toBe('acquire');
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

  it('gives open access an explicit tier, not an absent one', () => {
    expect(openAccess.acquisition.actionId).toBe('openAccess');
    expect(openAccess.acquisition.licenceModel).toBe('OPEN_ACCESS');
    expect(openAccess.acquisition.encryption).toBeNull();
    expect(openAccess.acquisition.canPersist).toBe(true);
  });

  it('reads the file type from indirectAcquisition, not the link type', () => {
    // Every acquisition link says 'application/json' — the href answers with JSON,
    // not with a book. A normalizer reading the link's own type would make every
    // publication in the feed an unknown format.
    expect(borrowable.format).toBe('PDF');
    expect(audiobook.format).toBe('AUDIO');
    expect(subscription.format).toBe('EPUB');
  });

  it('uses the only image as the cover and sets no thumbnail', () => {
    expect(borrowable.coverUrl).toBe('https://cdn.tf/covers/item_42.jpg');
    expect(borrowable.thumbnailUrl).toBeUndefined();
  });
});

describe('normalizeShelf', () => {
  const shelf = normalizeShelf(shelfPage0);

  it('identifies the shelf from its self href, ignoring the page query', () => {
    expect(shelf.id).toBe('all');
    expect(shelf.title).toBe('All titles');
  });

  it('carries server-reported pagination', () => {
    expect(shelf.totalItems).toBe(8);
    expect(shelf.itemsPerPage).toBe(4);
  });

  it('derives the next page index from the next link', () => {
    expect(shelf.nextPage).toBe(1);
  });

  it('normalizes every publication in the page', () => {
    expect(shelf.publications.map((p) => p.id)).toEqual([
      'item_42',
      'item_env',
      'item_stat',
      'item_soc',
    ]);
  });

  it('treats a missing publications key as an empty shelf, not a broken one', 
    () => {
      const emptyShelf = {
        metadata: { 
          title: "All titles",
          numberOfItems: 0
        },
        links: [
          {
            rel: 'self',
            href: 'https://api.tf/opds/v1/institutions/inst_zzz/groups/all',
            type: 'application/opds+json',
          },
        ],
      };
      const shelf = normalizeShelf(emptyShelf);
      expect(shelf.publications).toEqual([]);
    }
  )
});

describe('normalizePublication', () => {
  const publication = normalizePublication(publicationDetail);

  it('lifts the detail-only fields the summary lacks', () => {
    expect(publication.subtitle).toBe(
      'Artificial Intelligence, Animal and Environmental Law',
    );
    expect(publication.description).toContain('legal personhood');
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
          type: 'application/json',
          properties: {
            licenceModel: 'SUBSCRIPTION',
            indirectAcquisition: [{ type: 'application/pdf' }],
            hasSearchIndex: false,
            canPersist: true,
          },
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
          type: 'application/json',
          properties: {
            licenceModel: 'SUBSCRIPTION',
            indirectAcquisition: [{ type: 'application/pdf' }],
            hasSearchIndex: false,
            canPersist: true,
          },
        },
      ],
    };
    expect(() => normalizePublication(noSelf)).toThrow(
      expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
    );
  });
});

// The file type moved to `properties.indirectAcquisition`, so every way that can
// be wrong is now a way a whole feed can fail. Each must be a MALFORMED_FEED with
// something to point at, never a crash and never a silent blank format.
describe('normalizePublication rejects a broken indirectAcquisition', () => {
  function publicationWithProperties(properties: unknown) {
    return {
      metadata: { title: 'Rights for Robots' },
      links: [
        {
          rel: 'self',
          href: 'https://api.tf/opds/v1/institutions/inst_7f3/publications/item_42',
          type: 'application/opds-publication+json',
        },
        {
          rel: 'http://opds-spec.org/acquisition/borrow',
          href: 'https://api.tf/api/v1/loans?itemId=item_42',
          type: 'application/json',
          properties,
        },
      ],
    };
  }

  const base = {
    licenceModel: 'SUBSCRIPTION',
    hasSearchIndex: false,
    canPersist: true,
  };

  const broken: [string, unknown][] = [
    ['absent', { ...base }],
    ['not an array', { ...base, indirectAcquisition: { type: 'application/pdf' } }],
    ['empty', { ...base, indirectAcquisition: [] }],
    ['an entry with no type', { ...base, indirectAcquisition: [{}] }],
    ['a media type we cannot render', { ...base, indirectAcquisition: [{ type: 'text/plain' }] }],
  ];

  for (const [what, properties] of broken) {
    it(`rejects indirectAcquisition that is ${what}`, () => {
      expect(() => normalizePublication(publicationWithProperties(properties))).toThrow(
        expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
      );
    });
  }
});

// A KNOWN GAP, tested so it is visible rather than discovered. rels.ts maps the
// `subscribe` rel now, but a subscribe link carries no `indirectAcquisition` —
// it leads to a page explaining how to get access, not to a file — so the
// publication is still rejected here. It only appears on the public discovery
// routes, which no fixture uses yet.
//
// WHEN THIS TEST STARTS FAILING, the gap has been closed: delete it and assert
// the real behaviour instead.
it('still cannot normalize a subscribe publication, which has no file at all', () => {
  const subscribeOnly = {
    metadata: { title: 'Rights for Robots' },
    links: [
      {
        rel: 'self',
        href: 'https://api.tf/opds/v1/public/publications/item_42',
        type: 'application/opds-publication+json',
      },
      {
        rel: 'http://opds-spec.org/acquisition/subscribe',
        href: 'https://api.tf/api/v1/institutions',
        type: 'application/json',
        title: 'Available through your institution',
        properties: { licenceModel: 'ELITE', availability: { state: 'unavailable' } },
      },
    ],
  };

  expect(() => normalizePublication(subscribeOnly)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});
