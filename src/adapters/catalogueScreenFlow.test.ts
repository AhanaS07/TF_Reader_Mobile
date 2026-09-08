// src/adapters/catalogueScreenFlow.test.ts
// Encodes the CATALOGUE SCREEN's data contract, slot by slot, against the mock.
//
// WHY THIS EXISTS SEPARATELY FROM conformance.ts: that suite proves the adapters
// are interchangeable. This one proves the fixtures can actually fill the screen
// as designed — a different question, and the one that breaks first when a fixture
// changes. If a slot below stops resolving, a specific part of the UI has lost its
// data source, and the failing test names which part.
//
// NO SHELF IS NAMED IN AN ASSERTION HERE, deliberately. An administrator picks the
// shelves, their titles and their ids per institution (AGENTS.md, settled
// decisions, L-5), so a test that expected "eBooks" would be asserting one
// customer's configuration and would fail on the next one. Everything below is
// about shape, order and reachability.
//
// Screen mapping (from the reference design):
//   Category row       → catalogue.navigation      (whatever the admin configured)
//   Subject-style chips → catalogue.shelves         (the groups)
//   Bottom list        → selected shelf.publications
//   Tapping a category card → getShelf(shelfId) on a new screen
import { MockAdapter } from '@adapters/MockAdapter';
import { CatalogueError, isCatalogueFailure } from '@model/errors';

const INSTITUTION = 'inst_7f3';

describe('The category row is fed by navigation', () => {
  it('offers however many sections the feed carries, never a fixed set', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    // The count is the administrator's, so the only claim available is that there
    // is at least one row to render. `navigation` is required by the contract and
    // always carries at least the whole-catalogue signpost.
    expect(catalogue.navigation.length).toBeGreaterThan(0);
  });

  it('gives every card a title to render and a shelfId to navigate with', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    for (const entry of catalogue.navigation) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.shelfId.length).toBeGreaterThan(0);
      // A shelfId goes into a URL path segment, so a '/' would reshape the request.
      expect(entry.shelfId).not.toContain('/');
    }
  });

  // The reference design draws these cards with cover art. Navigation entries in
  // OPDS carry only title/href/type, so a section card CANNOT show a cover from
  // this data — the UI needs a different treatment (icon, colour, count) or the
  // feed needs an image per navigation entry.
  it('has no imagery for section cards, which the design must account for', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    for (const entry of catalogue.navigation) {
      expect(entry).not.toHaveProperty('coverUrl');
      expect(Object.keys(entry).sort()).toEqual(['href', 'shelfId', 'target', 'title']);
    }
  });
});

describe('Chips are fed by groups, bottom list by the selected group', () => {
  it('offers a chip per group, labelled and keyed independently', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    expect(catalogue.shelves.length).toBeGreaterThan(0);
    for (const shelf of catalogue.shelves) {
      expect(shelf.id.length).toBeGreaterThan(0);
      expect(shelf.title.length).toBeGreaterThan(0);
    }
  });

  // Render `title`, navigate by `id` — the two are independent, and a shelf's own
  // feed may call itself something different again. Proven rather than described,
  // because a UI that derived one from the other would pass every other test here.
  it('has at least one shelf whose title differs from the navigation row for it', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    const divergent = catalogue.shelves.filter((shelf) => {
      const navEntry = catalogue.navigation.find((entry) => entry.shelfId === shelf.id);
      return navEntry !== undefined && navEntry.title !== shelf.title;
    });

    expect(divergent.length).toBeGreaterThan(0);
  });

  it('fills the bottom list from whichever chip is selected, with no extra fetch', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    // The home payload already carries each group's publications, so switching
    // chips is local state — it must not trigger a network call. The precondition
    // is that the chips lead somewhere DIFFERENT: if every shelf carried the same
    // rows, selection would be unobservable and this screen would be untestable.
    const rowSets = catalogue.shelves.map((shelf) =>
      shelf.publications.map((publication) => publication.id).sort().join(','),
    );
    for (const rows of rowSets) {
      expect(rows.length).toBeGreaterThan(0);
    }
    expect(new Set(rowSets).size).toBeGreaterThan(1);
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

  it('gives every row a tier for the badge, agreeing with how it is acquired', async () => {
    const catalogue = await new MockAdapter().getHomeCatalogue(INSTITUTION);

    for (const publication of catalogue.shelves.flatMap((shelf) => shelf.publications)) {
      const { actionId, licenceModel } = publication.acquisition;
      expect(licenceModel).toBeDefined();
      // An open-access rel and an OPEN_ACCESS tier are the same statement made
      // twice; disagreeing would hand resolveAccess two different answers.
      if (actionId === 'openAccess') {
        expect(licenceModel).toBe('OPEN_ACCESS');
      }
    }
  });
});

describe('Tapping a category card drills into a shelf screen', () => {
  // Which shelves have a listing is a property of the fixture set, not of their
  // names, so this walks the row and counts outcomes.
  async function openEveryAdvertisedShelf() {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(INSTITUTION);
    const opened = [];
    const missing = [];

    for (const entry of catalogue.navigation) {
      try {
        opened.push(await adapter.getShelf(INSTITUTION, entry.shelfId));
      } catch (err) {
        expect(isCatalogueFailure(err)).toBe(true);
        expect((err as { code: CatalogueError }).code).toBe(CatalogueError.NOT_FOUND);
        missing.push(entry.shelfId);
      }
    }
    return { opened, missing };
  }

  it('opens more than one advertised shelf as a full listing', async () => {
    const { opened } = await openEveryAdvertisedShelf();

    // More than one, because a single working card was the old failing state: it
    // made the row look like a fixed set with the rest broken.
    expect(opened.length).toBeGreaterThan(1);
    for (const shelf of opened) {
      expect(shelf.title.length).toBeGreaterThan(0);
      expect(shelf.publications.length).toBeGreaterThan(0);
    }
  });

  it('keeps at least one advertised shelf unbacked so the not-found path stays live', async () => {
    const { missing } = await openEveryAdvertisedShelf();

    // Deliberate. A shelf with no listing fixture reports NOT_FOUND rather than an
    // empty shelf, and keeping one reachable from the UI means the error state is
    // exercised by tapping a card, not only by a synthetic id.
    expect(missing.length).toBeGreaterThan(0);
  });

  it('pages a shelf that has more than one page', async () => {
    const { opened } = await openEveryAdvertisedShelf();
    const paged = opened.filter((shelf) => shelf.nextPage !== undefined);

    expect(paged.length).toBeGreaterThan(0);
    for (const shelf of paged) {
      expect(shelf.totalItems).toBeGreaterThan(shelf.publications.length);
    }
  });
});

describe('Drilling from a row into publication detail', () => {
  it('opens detail for a row tapped in the bottom list', async () => {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(INSTITUTION);
    const rows = catalogue.shelves.flatMap((shelf) => shelf.publications);
    // The one row a detail fixture backs. Found by asking, not by position — which
    // group it sits in is the administrator's choice.
    const enriched = rows.find((row) => row.id === 'item_42');

    expect(enriched).toBeDefined();
    const detail = await adapter.getPublication(INSTITUTION, (enriched as { id: string }).id);

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
