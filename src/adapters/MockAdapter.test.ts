// src/adapters/MockAdapter.test.ts
// Contract conformance, plus the mock-only behaviour (latency, error injection)
// that has no place in the shared suite.
import { MockAdapter } from '@adapters/MockAdapter';
import {
  describeCatalogueSourceConformance,
  KNOWN_INSTITUTION,
  KNOWN_PUBLICATION,
  KNOWN_SHELF,
} from '@adapters/conformance';
import { describeInstitutionSourceConformance } from '@adapters/institutionConformance';
import { CatalogueError, isCatalogueFailure } from '@model/errors';

describeCatalogueSourceConformance('MockAdapter', () => new MockAdapter());
describeInstitutionSourceConformance('MockAdapter', () => new MockAdapter());

describe('MockAdapter institutions', () => {
  it('serves the eight P0-4 institutions', async () => {
    expect(await new MockAdapter().getInstitutions()).toHaveLength(8);
  });

  it('applies injected failure to the institution methods too', async () => {
    const adapter = new MockAdapter({ failWith: CatalogueError.NETWORK_UNAVAILABLE });

    await expect(adapter.getInstitutions()).rejects.toMatchObject({
      code: CatalogueError.NETWORK_UNAVAILABLE,
    });
    await expect(adapter.getInstitution('inst_7f3')).rejects.toMatchObject({
      code: CatalogueError.NETWORK_UNAVAILABLE,
    });
  });

  // Every institution the picker can offer must load, or CAP-3 looks broken for
  // 7 of its own 8 choices. Two have their own root feed and the rest are served
  // the first one — a mock convenience, stated here rather than left as a
  // surprise. Add per-institution fixtures if the demo needs more to differ.
  //
  // The assertion is that a catalogue RESOLVES, not that it has shelves: an
  // administrator configures the shelves, so an institution with none is a valid
  // feed rather than a broken one.
  it('serves a catalogue for every institution it lists, not just inst_7f3', async () => {
    const adapter = new MockAdapter();
    const others = (await adapter.getInstitutions()).filter((i) => i.id !== 'inst_7f3');

    expect(others.length).toBeGreaterThan(0);
    for (const institution of others) {
      const catalogue = await adapter.getHomeCatalogue(institution.id);
      expect(catalogue.navigation.length).toBeGreaterThan(0);
    }
  });

  // The nothing-curated case, reachable without editing a fixture. A brand new
  // institution has no shelves yet and still has to render: one signpost row and
  // no sections. Nothing may treat an empty shelf list as an error.
  it('serves an institution whose administrator has curated no shelves', async () => {
    const adapter = new MockAdapter();

    const catalogue = await adapter.getHomeCatalogue('inst_a21');

    expect(catalogue.shelves).toEqual([]);
    expect(catalogue.navigation.length).toBe(1);
  });

  // The other half of that bargain: only ids the fixtures know are accepted, so
  // MockAdapter still agrees with ApiAdapter (which maps a 404 to NOT_FOUND) and
  // the shared conformance suite stays meaningful.
  it('still rejects an institution that appears in no fixture', async () => {
    const adapter = new MockAdapter();

    await expect(adapter.getHomeCatalogue('inst_not_in_any_fixture')).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
  });
});

describe('MockAdapter detail vs summary', () => {
  it('serves richer detail for a publication than its shelf summary carried', async () => {
    const adapter = new MockAdapter();

    const catalogue = await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    const summary = catalogue.shelves
      .flatMap((shelf) => shelf.publications)
      .find((publication) => publication.id === KNOWN_PUBLICATION);
    const detail = await adapter.getPublication(KNOWN_INSTITUTION, KNOWN_PUBLICATION);

    // The catalogue listing has no subtitle or description; the detail feed does.
    expect(summary?.subtitle).toBeUndefined();
    expect(detail.subtitle).toBeDefined();
    expect(detail.description).toBeDefined();
  });

  it('falls back to the catalogue summary for a publication with no detail fixture', async () => {
    const adapter = new MockAdapter();

    // item_stat is the audiobook; only item_42 has a detail fixture.
    const audiobook = await adapter.getPublication(KNOWN_INSTITUTION, 'item_stat');

    expect(audiobook.id).toBe('item_stat');
    expect(audiobook.format).toBe('AUDIO');
  });
});

describe('MockAdapter latency injection', () => {
  it('resolves immediately by default, so tests stay fast', async () => {
    const adapter = new MockAdapter();
    const before = performance.now();

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(performance.now() - before).toBeLessThan(50);
  });

  it('waits at least the configured latency before resolving', async () => {
    const adapter = new MockAdapter({ latencyMs: 60 });
    const before = performance.now();

    await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    expect(performance.now() - before).toBeGreaterThanOrEqual(55);
  });
});

describe('MockAdapter error injection', () => {
  it('fails every call with the configured code so error states can be built', async () => {
    const adapter = new MockAdapter({ failWith: CatalogueError.NETWORK_UNAVAILABLE });

    let caught: unknown;
    try {
      await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    } catch (err) {
      caught = err;
    }

    expect(isCatalogueFailure(caught)).toBe(true);
    expect((caught as { code: CatalogueError }).code).toBe(CatalogueError.NETWORK_UNAVAILABLE);
  });

  it('applies injected failure to every method, not just the catalogue', async () => {
    const adapter = new MockAdapter({ failWith: CatalogueError.TIMEOUT });

    await expect(adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF)).rejects.toMatchObject({
      code: CatalogueError.TIMEOUT,
    });
    await expect(
      adapter.getPublication(KNOWN_INSTITUTION, KNOWN_PUBLICATION),
    ).rejects.toMatchObject({ code: CatalogueError.TIMEOUT });
    await expect(adapter.getItemsBatch(['item_42'])).rejects.toMatchObject({
      code: CatalogueError.TIMEOUT,
    });
  });

  it('still applies latency before an injected failure', async () => {
    const adapter = new MockAdapter({
      latencyMs: 60,
      failWith: CatalogueError.NETWORK_UNAVAILABLE,
    });
    const before = performance.now();

    await expect(adapter.getHomeCatalogue(KNOWN_INSTITUTION)).rejects.toBeDefined();

    // A failure that arrives instantly cannot exercise a loading spinner.
    expect(performance.now() - before).toBeGreaterThanOrEqual(55);
  });
});

describe('MockAdapter shelf resolution', () => {
  it('serves a shelf that has a standalone feed fixture', async () => {
    const adapter = new MockAdapter();

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);

    expect(shelf.id).toBe(KNOWN_SHELF);
    expect(shelf.publications.length).toBeGreaterThan(0);
  });

  it('serves the second page of a multi-page shelf from its own fixture', async () => {
    const adapter = new MockAdapter();

    const firstPage = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);
    const secondPage = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, firstPage.nextPage);

    // Real rows, not a fabricated empty page — the two pages together add up to
    // the shelf's advertised total.
    expect(secondPage.publications.length).toBeGreaterThan(0);
    expect(firstPage.publications.length + secondPage.publications.length).toBe(
      firstPage.totalItems,
    );
    // Last page, so nothing left to advertise.
    expect(secondPage.nextPage).toBeUndefined();
  });

  // MockAdapter's own choice, NOT part of the shared conformance contract: what a
  // real server does past the end is undecided (see conformance.ts). An empty
  // page is the kinder of the two for a mock, since a 404 here would show the
  // full-screen error for what is really just "no more results".
  it('answers a page past the end with an empty final page', async () => {
    const adapter = new MockAdapter();

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, 99);

    expect(shelf.id).toBe(KNOWN_SHELF);
    expect(shelf.publications).toEqual([]);
    // Stripped, so a caller looping on `nextPage` terminates instead of spinning.
    expect(shelf.nextPage).toBeUndefined();
  });

  // The fixture set keeps one advertised shelf without a listing on purpose, so the
  // not-found path is reachable by tapping a card rather than only via an invented
  // id. Such a shelf may still have a PREVIEW group in the home feed — a preview is
  // not the paginated listing its self href would return, and serving it as one
  // would fake pages out of data that has none.
  //
  // Found by walking the row, never by name: which shelf is unbacked is the
  // fixture's business (AGENTS.md L-5).
  it('reports NOT_FOUND for a navigable shelf whose listing has no fixture', async () => {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(KNOWN_INSTITUTION);

    const unbacked = [];
    for (const entry of catalogue.navigation) {
      try {
        await adapter.getShelf(KNOWN_INSTITUTION, entry.shelfId);
      } catch (err) {
        expect((err as { code: CatalogueError }).code).toBe(CatalogueError.NOT_FOUND);
        unbacked.push(entry.shelfId);
      }
    }

    expect(unbacked.length).toBeGreaterThan(0);
    // And at least one of them is a preview group too, which is the case that would
    // regress if pagesByShelfId ever started serving home-feed groups.
    const previewed = unbacked.filter((shelfId) =>
      catalogue.shelves.some((shelf) => shelf.id === shelfId),
    );
    expect(previewed.length).toBeGreaterThan(0);
  });
});

describe('MockAdapter shelf filter and sort', () => {
  it('narrows to only the matching access tier, across every fixture page', async () => {
    const adapter = new MockAdapter();

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      accessTier: 'OPEN_ACCESS',
    });

    expect(shelf.publications.length).toBeGreaterThan(0);
    expect(
      shelf.publications.every((publication) => publication.acquisition.licenceModel === 'OPEN_ACCESS'),
    ).toBe(true);
  });

  it('narrows to only the matching content format', async () => {
    const adapter = new MockAdapter();

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      contentType: 'AUDIO',
    });

    expect(shelf.publications.length).toBeGreaterThan(0);
    expect(shelf.publications.every((publication) => publication.format === 'AUDIO')).toBe(true);
  });

  // Filtering is expected to shrink the shelf enough that both fixture pages'
  // worth of matches fit on one response — proves matching runs against the
  // whole shelf, not page-by-page, per matchesShelfQuery's own comment.
  it('reports a total that reflects the filter, not the unfiltered shelf', async () => {
    const adapter = new MockAdapter();

    const unfiltered = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);
    const filtered = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      accessTier: 'ELITE',
    });

    expect(filtered.totalItems).toBeLessThan(unfiltered.totalItems ?? 0);
    expect(filtered.totalItems).toBe(filtered.publications.length);
  });

  it('orders by title on the "all" shelf when a sort is requested', async () => {
    const adapter = new MockAdapter();

    // Every title across every page, gathered unsorted, so the expectation is
    // built from the same source data the sorted request draws from — not a
    // second, independent guess at what the fixtures contain.
    const firstPage = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);
    const secondPage =
      firstPage.nextPage === undefined
        ? undefined
        : await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, firstPage.nextPage);
    const allTitles = [
      ...firstPage.publications,
      ...(secondPage?.publications ?? []),
    ].map((publication) => publication.title);

    const sortedFirstPage = await adapter.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF, undefined, {
      sort: 'title.asc',
    });

    const expectedTitles = [...allTitles].sort((a, b) => a.localeCompare(b));
    expect(sortedFirstPage.publications.map((publication) => publication.title)).toEqual(
      expectedTitles.slice(0, sortedFirstPage.publications.length),
    );
  });

  // ShelfQuery's own contract: sort is accepted everywhere but only honoured
  // on 'all' — a curated shelf may treat it as a no-op rather than an error.
  it('ignores sort on a shelf other than "all"', async () => {
    const adapter = new MockAdapter();
    const catalogue = await adapter.getHomeCatalogue(KNOWN_INSTITUTION);
    const curatedShelfId = catalogue.shelves.find((shelf) => shelf.id !== 'all')?.id;
    if (curatedShelfId === undefined) throw new Error('fixture has no curated shelf to test against');

    const unsorted = await adapter.getShelf(KNOWN_INSTITUTION, curatedShelfId);
    const requestedSort = await adapter.getShelf(KNOWN_INSTITUTION, curatedShelfId, undefined, {
      sort: 'title.desc',
    });

    expect(requestedSort.publications.map((publication) => publication.id)).toEqual(
      unsorted.publications.map((publication) => publication.id),
    );
  });
});
