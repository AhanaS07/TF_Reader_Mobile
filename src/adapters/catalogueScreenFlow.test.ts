// src/adapters/catalogueScreenFlow.test.ts
// Encodes the CATALOGUE SCREEN's data contract, slot by slot, against the mock.
//
// WHY THIS EXISTS SEPARATELY FROM conformance.ts: that suite proves the adapters
// are interchangeable. This one proves the fixtures can actually fill the screen
// as designed — a different question, and the one that breaks first when a fixture
// changes. If a slot below stops resolving, a specific part of the UI has lost its
// data source, and the failing test names which part.
//
// Screen mapping (from the reference design):
//   Featured carousel  → catalogue.navigation      (eBooks / Audiobooks / Open access)
//   Subject-style chips → catalogue.shelves         (the groups)
//   Bottom list        → selected shelf.publications
//   Tapping a carousel card → getShelf(shelfId) on a new screen
import { MockAdapter } from '@adapters/MockAdapter';
import { CatalogueError } from '@model/errors';

const INSTITUTION = 'inst_7f3';

describe('Featured carousel is fed by navigation', () => {
  it('offers exactly the three sections the design shows', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    expect(catalogue.navigation.map((entry) => entry.title)).toEqual([
      'eBooks',
      'Audiobooks',
      'Open access',
    ]);
  });

  it('gives each card a shelfId it can navigate with, no URL parsing in the UI', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    expect(catalogue.navigation.map((entry) => entry.shelfId)).toEqual([
      'ebooks',
      'audiobooks',
      'open-access',
    ]);
  });

  // The reference design draws these cards with cover art. Navigation entries in
  // OPDS carry only title/href/type, so a section card CANNOT show a cover from
  // this data — the UI needs a different treatment (icon, colour, count) or the
  // feed needs an image per navigation entry.
  it('has no imagery for section cards, which the design must account for', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    for (const entry of catalogue.navigation) {
      expect(entry).not.toHaveProperty('coverUrl');
      expect(Object.keys(entry).sort()).toEqual(['href', 'shelfId', 'title']);
    }
  });
});

describe('Chips are fed by groups, bottom list by the selected group', () => {
  it('offers a chip per group, labelled and keyed independently', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    expect(catalogue.shelves.map((shelf) => ({ id: shelf.id, title: shelf.title }))).toEqual([
      { id: 'new-this-term', title: 'New this term' },
      // Title and id diverge here — render `title`, navigate by `id`.
      { id: 'open-access', title: 'Free to read' },
    ]);
  });

  it('fills the bottom list from whichever chip is selected, with no extra fetch', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    // The home payload already carries each group's publications, so switching
    // chips is local state — it must not trigger a network call.
    const [newThisTerm, freeToRead] = catalogue.shelves;
    expect(newThisTerm.publications.map((p) => p.title)).toEqual([
      'Rights for Robots',
      'Environmental Policy and Air Pollution in China',
      'An Introduction to Statistics',
    ]);
    expect(freeToRead.publications.map((p) => p.title)).toEqual(['Ethnographies of Waiting']);
  });

  it('gives every bottom-list row the fields those cards render', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    for (const publication of catalogue.shelves.flatMap((shelf) => shelf.publications)) {
      expect(publication.title.length).toBeGreaterThan(0);
      // The reference rows show a title, a source line, a thumbnail and an
      // access badge. Publisher stands in for the journal/source line.
      expect(publication.publisher).toBeDefined();
      expect(publication.coverUrl).toBeDefined();
      // The badge is derived from actionId by resolveAccess — never computed in
      // the row itself, so the row only needs the input to be present.
      expect(publication.acquisition.actionId).toBeDefined();
    }
  });

  it('marks exactly the open-access title as openAccess for the badge', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);
    const openAccess = catalogue.shelves
      .flatMap((shelf) => shelf.publications)
      .filter((publication) => publication.acquisition.actionId === 'openAccess');

    expect(openAccess.map((p) => p.title)).toEqual(['Ethnographies of Waiting']);
  });
});

describe('Tapping a carousel card drills into a shelf screen', () => {
  it('opens the eBooks shelf as a full paginated listing', async () => {
    const shelf = await new MockAdapter().getShelf(INSTITUTION, 'ebooks');

    expect(shelf.title).toBe('eBooks');
    expect(shelf.publications.map((p) => p.id)).toEqual(['item_42', 'item_env']);
    // 3 items total across pages of 2, so the screen can page.
    expect(shelf.totalItems).toBe(3);
    expect(shelf.nextPage).toBe(1);
  });

  it('opens the Open access section, reusing the home group as its listing', async () => {
    const shelf = await new MockAdapter().getShelf(INSTITUTION, 'open-access');

    expect(shelf.publications.map((p) => p.id)).toEqual(['item_ab6']);
  });

  // THE GAP: 'audiobooks' is advertised in navigation but no fixture backs it, so
  // the third carousel card cannot open. This test documents the gap rather than
  // hiding it — it will start failing the moment a fixture (or a derived shelf)
  // makes that card work, which is the signal to delete it.
  it('cannot yet open the Audiobooks section — no fixture backs it', async () => {
    await expect(new MockAdapter().getShelf(INSTITUTION, 'audiobooks')).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
  });
});

describe('Drilling from a row into publication detail', () => {
  it('opens detail for a row tapped in the bottom list', async () => {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(INSTITUTION);
    const [firstRow] = catalogue.shelves[0].publications;

    const detail = await adapter.getPublication(INSTITUTION, firstRow.id);

    expect(detail.id).toBe(firstRow.id);
    // Detail adds what the row omitted, which is the reason for the second screen.
    expect(detail.subtitle).toBeDefined();
    expect(detail.description).toBeDefined();
    expect(detail.numberOfPages).toBe(212);
  });

  it('opens detail for every row the home screen can show', async () => {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(INSTITUTION);
    const rows = catalogue.shelves.flatMap((shelf) => shelf.publications);

    // No row in the UI may be a dead end.
    for (const row of rows) {
      const detail = await adapter.getPublication(INSTITUTION, row.id);
      expect(detail.id).toBe(row.id);
    }
  });
});
