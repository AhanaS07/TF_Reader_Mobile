// src/adapters/conformance.ts
// The shared conformance suite every CatalogueSource must pass.
//
// WHY ONE SUITE INSTEAD OF TWO TEST FILES: "Mock and Api are interchangeable" is
// only true if something checks it. Two hand-written suites drift — the mock's
// tests get written against what the mock happens to do, and the day api.tf goes
// live the app breaks in ways the mocked tests were structurally incapable of
// catching. One suite run twice makes "interchangeable" a claim the build
// enforces rather than a comment.
//
// NOT a .test.ts file on purpose: jest must not collect it directly, because it
// has no implementation to run against on its own. MockAdapter.test.ts and
// ApiAdapter.test.ts each import it and supply a factory.
//
// Tests here assert on the CONTRACT ONLY — shapes, ids, invariants, failure
// codes. Anything specific to one implementation (injected latency, fetch call
// counts) belongs in that adapter's own test file, not here.
import type { CatalogueSource } from '@adapters/CatalogueSource';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import { assertPublication } from '@model/validate';

// Both implementations are backed by the same fixtures, so these ids are part of
// the shared contract the suite tests against.
//
// KNOWN_SHELF IS 'all' because it is the one RESERVED groupId: the contract
// guarantees it exists and never 404s, whereas a curated shelf may legally be
// empty and 404 — which would fail this suite against a real server for a reason
// that is not a bug.
//
// Reserved is not the same as meaningful. Curated ids stay opaque (AGENTS.md L-5).
// And multi-page, which the tests below require, is a property of our fixtures
// rather than a contract guarantee: worst case `all` is a feed with only a self
// link.
export const KNOWN_INSTITUTION = 'inst_7f3';
export const KNOWN_SHELF = 'all';
export const KNOWN_PUBLICATION = 'item_42';

// A title the PUBLIC feed serves. Deliberately not KNOWN_PUBLICATION: that one is
// Elite, so it can never appear here, and a public-feed test that reused it would
// be asserting the opposite of what the endpoint promises.
export const KNOWN_PUBLIC_PUBLICATION = 'item_oa1';

async function expectNotFound(operation: Promise<unknown>, what: string): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (err) {
    caught = err;
  }
  if (caught === undefined) {
    throw new Error(`expected ${what} to reject with NOT_FOUND, but it resolved`);
  }
  expect(isCatalogueFailure(caught)).toBe(true);
  expect((caught as { code: CatalogueError }).code).toBe(CatalogueError.NOT_FOUND);
}

/**
 * Runs the CatalogueSource contract against one implementation.
 *
 * @param name  Label for the describe block, e.g. 'MockAdapter'.
 * @param createSource  Fresh instance per test — no shared state between cases.
 */
export function describeCatalogueSourceConformance(
  name: string,
  createSource: () => CatalogueSource,
): void {
  describe(`${name} conforms to CatalogueSource`, () => {
    describe('getHomeCatalogue', () => {
      it('returns a titled catalogue with navigation and shelves', async () => {
        const catalogue = await createSource().getHomeCatalogue(KNOWN_INSTITUTION);

        expect(catalogue.title.length).toBeGreaterThan(0);
        expect(catalogue.navigation.length).toBeGreaterThan(0);
        expect(catalogue.shelves.length).toBeGreaterThan(0);
      });

      it('gives every navigation entry a shelfId usable with getShelf', async () => {
        const catalogue = await createSource().getHomeCatalogue(KNOWN_INSTITUTION);

        for (const entry of catalogue.navigation) {
          expect(entry.shelfId.length).toBeGreaterThan(0);
          expect(entry.shelfId).not.toContain('/');
        }
      });

      it('returns publications that satisfy the model invariants', async () => {
        const catalogue = await createSource().getHomeCatalogue(KNOWN_INSTITUTION);
        const publications = catalogue.shelves.flatMap((shelf) => shelf.publications);

        expect(publications.length).toBeGreaterThan(0);
        for (const publication of publications) {
          // Throws CatalogueFailure on any cross-field contradiction.
          expect(() => assertPublication(publication)).not.toThrow();
        }
      });

      it('never exposes OPDS wire fields to callers', async () => {
        const catalogue = await createSource().getHomeCatalogue(KNOWN_INSTITUTION);
        const [publication] = catalogue.shelves[0].publications;

        // If any of these survive, the adapter leaked the wire format and every
        // screen becomes coupled to wokay's OPDS layout.
        expect(publication).not.toHaveProperty('links');
        expect(publication).not.toHaveProperty('metadata');
        expect(publication).not.toHaveProperty('properties');
      });

      it('rejects an unknown institution with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getHomeCatalogue('inst_does_not_exist'),
          'getHomeCatalogue',
        );
      });
    });

    describe('getShelf', () => {
      it('returns the shelf that was asked for', async () => {
        const shelf = await createSource().getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);

        expect(shelf.id).toBe(KNOWN_SHELF);
        expect(shelf.title.length).toBeGreaterThan(0);
        expect(shelf.publications.length).toBeGreaterThan(0);
      });

      it('reports a next page index rather than a URL when more pages exist', async () => {
        const shelf = await createSource().getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);

        if (shelf.nextPage !== undefined) {
          expect(typeof shelf.nextPage).toBe('number');
          expect(shelf.nextPage).toBeGreaterThan(0);
        }
      });

      // The pagination contract end to end, not just the shape of one response:
      // follow the advertised cursor and the page it names must arrive, carry
      // different titles, and eventually stop advertising a successor.
      //
      // KNOWN_SHELF is required to be multi-page for this reason — a source that
      // silently re-served page 0 for every request would pass every other test
      // in this suite, and ShelfScreen would append the same rows forever.
      it('serves the page its own next cursor names', async () => {
        const source = createSource();
        const firstPage = await source.getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);
        expect(firstPage.nextPage).toBeDefined();

        const secondPage = await source.getShelf(
          KNOWN_INSTITUTION,
          KNOWN_SHELF,
          firstPage.nextPage,
        );

        expect(secondPage.id).toBe(KNOWN_SHELF);
        expect(secondPage.publications.length).toBeGreaterThan(0);
        // Distinct rows, so "page 2" is genuinely a further page and not page 0
        // handed back a second time.
        const firstIds = firstPage.publications.map((publication) => publication.id);
        for (const publication of secondPage.publications) {
          expect(firstIds).not.toContain(publication.id);
        }
        // Paging terminates: the last page advertises no successor, which is what
        // lets a caller stop rather than loop.
        expect(secondPage.nextPage).toBeUndefined();
      });

      // DELIBERATELY NOT PINNED HERE: what a source does with a page past the end
      // (empty feed, or 404?) is a server decision wokay have not made, so
      // requiring one answer of both adapters would assert a contract that does
      // not exist yet. It costs nothing today because a caller only ever requests
      // a `nextPage` the feed itself advertised. MockAdapter's own choice is
      // covered in MockAdapter.test.ts.

      it('returns publications that satisfy the model invariants', async () => {
        const shelf = await createSource().getShelf(KNOWN_INSTITUTION, KNOWN_SHELF);

        for (const publication of shelf.publications) {
          expect(() => assertPublication(publication)).not.toThrow();
        }
      });

      it('rejects an unknown shelf with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getShelf(KNOWN_INSTITUTION, 'no-such-shelf'),
          'getShelf',
        );
      });

      it('rejects an unknown institution with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getShelf('inst_does_not_exist', KNOWN_SHELF),
          'getShelf',
        );
      });
    });

    describe('getPublication', () => {
      it('returns the publication that was asked for', async () => {
        const publication = await createSource().getPublication(
          KNOWN_INSTITUTION,
          KNOWN_PUBLICATION,
        );

        expect(publication.id).toBe(KNOWN_PUBLICATION);
        expect(publication.title.length).toBeGreaterThan(0);
        expect(publication.acquisition.href.length).toBeGreaterThan(0);
      });

      it('satisfies the model invariants', async () => {
        const publication = await createSource().getPublication(
          KNOWN_INSTITUTION,
          KNOWN_PUBLICATION,
        );

        expect(() => assertPublication(publication)).not.toThrow();
      });

      it('carries a format from the ContentFormat union', async () => {
        const publication = await createSource().getPublication(
          KNOWN_INSTITUTION,
          KNOWN_PUBLICATION,
        );

        expect(['PDF', 'EPUB', 'AUDIO']).toContain(publication.format);
      });

      it('rejects an unknown publication with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getPublication(KNOWN_INSTITUTION, 'item_nope'),
          'getPublication',
        );
      });

      it('rejects an unknown institution with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getPublication('inst_does_not_exist', KNOWN_PUBLICATION),
          'getPublication',
        );
      });
    });

    // A1 — the second entry point, for a reader who has chosen no institution.
    //
    // THE MISSING ARGUMENT IS THE CONTRACT. Every method above takes an
    // institutionId; these two take none, and that is the whole feature rather
    // than a convenience. A source that quietly served an institution's feed here
    // would pass every shape assertion below, so the open-access test is the one
    // that actually pins it.
    describe('getPublicFeed', () => {
      it('returns a flat list of publications without an institution', async () => {
        const feed = await createSource().getPublicFeed();

        expect(feed.title.length).toBeGreaterThan(0);
        expect(feed.publications.length).toBeGreaterThan(0);
      });

      it('carries open access titles only', async () => {
        const feed = await createSource().getPublicFeed();

        for (const publication of feed.publications) {
          expect(publication.acquisition.licenceModel).toBe('OPEN_ACCESS');
        }
      });

      // The same end-to-end paging contract getShelf is held to: follow the
      // advertised cursor, get genuinely different rows, and eventually stop.
      it('serves the page its own next cursor names', async () => {
        const source = createSource();
        const firstPage = await source.getPublicFeed();
        expect(firstPage.nextPage).toBeDefined();

        const secondPage = await source.getPublicFeed(firstPage.nextPage);

        expect(secondPage.publications.length).toBeGreaterThan(0);
        const firstIds = firstPage.publications.map((publication) => publication.id);
        for (const publication of secondPage.publications) {
          expect(firstIds).not.toContain(publication.id);
        }
        expect(secondPage.nextPage).toBeUndefined();
      });

      it('returns publications that satisfy the model invariants', async () => {
        const feed = await createSource().getPublicFeed();

        for (const publication of feed.publications) {
          expect(() => assertPublication(publication)).not.toThrow();
        }
      });

      it('never exposes OPDS wire fields to callers', async () => {
        const feed = await createSource().getPublicFeed();
        const [publication] = feed.publications;

        expect(publication).not.toHaveProperty('links');
        expect(publication).not.toHaveProperty('metadata');
        expect(publication).not.toHaveProperty('properties');
      });
    });

    describe('getPublicPublication', () => {
      it('returns the publication that was asked for', async () => {
        const publication = await createSource().getPublicPublication(KNOWN_PUBLIC_PUBLICATION);

        expect(publication.id).toBe(KNOWN_PUBLIC_PUBLICATION);
        expect(publication.title.length).toBeGreaterThan(0);
        expect(publication.acquisition.href.length).toBeGreaterThan(0);
      });

      it('satisfies the model invariants', async () => {
        const publication = await createSource().getPublicPublication(KNOWN_PUBLIC_PUBLICATION);

        expect(() => assertPublication(publication)).not.toThrow();
      });

      it('opens every title its own feed listed', async () => {
        const source = createSource();
        const feed = await source.getPublicFeed();

        for (const listed of feed.publications) {
          const detail = await source.getPublicPublication(listed.id);
          expect(detail.id).toBe(listed.id);
        }
      });

      it('rejects an unknown publication with NOT_FOUND', async () => {
        await expectNotFound(
          createSource().getPublicPublication('item_nope'),
          'getPublicPublication',
        );
      });
    });
  });
}
