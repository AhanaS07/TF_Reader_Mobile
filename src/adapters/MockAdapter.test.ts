// src/adapters/MockAdapter.test.ts
// Contract conformance, plus the mock-only behaviour (latency, error injection)
// that has no place in the shared suite.
import { MockAdapter } from '@adapters/MockAdapter';
import {
  describeCatalogueSourceConformance,
  KNOWN_INSTITUTION,
  KNOWN_PUBLICATION,
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

  // Only inst_7f3 has catalogue fixtures. Selecting any other institution and
  // then loading its catalogue is a dead end until more fixtures exist — asserted
  // so the gap is visible rather than discovered during a demo.
  it('lists institutions whose catalogues do not exist yet', async () => {
    const adapter = new MockAdapter();
    const others = (await adapter.getInstitutions()).filter((i) => i.id !== 'inst_7f3');

    expect(others.length).toBeGreaterThan(0);
    await expect(adapter.getHomeCatalogue(others[0].id)).rejects.toMatchObject({
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

    await expect(adapter.getShelf(KNOWN_INSTITUTION, 'ebooks')).rejects.toMatchObject({
      code: CatalogueError.TIMEOUT,
    });
    await expect(
      adapter.getPublication(KNOWN_INSTITUTION, KNOWN_PUBLICATION),
    ).rejects.toMatchObject({ code: CatalogueError.TIMEOUT });
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

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks');

    expect(shelf.id).toBe('ebooks');
    expect(shelf.publications.length).toBeGreaterThan(0);
  });

  it('serves the second page of a multi-page shelf from its own fixture', async () => {
    const adapter = new MockAdapter();

    const firstPage = await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks');
    const secondPage = await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks', firstPage.nextPage);

    // Real rows off 02-shelf-group-page1.json, not a fabricated empty page — the
    // two pages together add up to the shelf's advertised total.
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

    const shelf = await adapter.getShelf(KNOWN_INSTITUTION, 'ebooks', 99);

    expect(shelf.id).toBe('ebooks');
    expect(shelf.publications).toEqual([]);
    // Stripped, so a caller looping on `nextPage` terminates instead of spinning.
    expect(shelf.nextPage).toBeUndefined();
  });

  it('does not serve a home-catalogue preview group as a drillable shelf', async () => {
    const adapter = new MockAdapter();

    // 'new-this-term' exists only as a group inside the home feed. That group is
    // a preview of a collection, not the full listing its self href would
    // return, so it cannot stand in for one: doing so would fake a paginated
    // shelf out of data that has no pages. The home feed is for the home screen.
    await expect(adapter.getShelf(KNOWN_INSTITUTION, 'new-this-term')).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
  });

  it('reports NOT_FOUND for a navigable shelf that has no fixture yet', async () => {
    const adapter = new MockAdapter();

    // 'audiobooks' appears in navigation but no fixture backs it. Pretending it
    // is empty would hide the gap; NOT_FOUND states it.
    await expect(adapter.getShelf(KNOWN_INSTITUTION, 'audiobooks')).rejects.toMatchObject({
      code: CatalogueError.NOT_FOUND,
    });
  });
});
