// src/adapters/MockAdapter.ts
// CatalogueSource backed by the frozen OPDS fixtures.
//
// This is the adapter the whole app runs on until api.tf exists, so it is held to
// the same conformance suite as ApiAdapter rather than being treated as test
// scaffolding.
//
// IT PARSES THE REAL WIRE FORMAT. The fixtures go through normalize.ts exactly as
// an HTTP response would — no hand-authored domain objects anywhere. That is the
// point: if the normalizer mishandles wokay's OPDS, this adapter surfaces it
// today instead of the day the backend lands.
import type { BookId } from '@/shared/types/primitives';
import type { Catalogue, Publication, Shelf } from '@model/types';
import type { DataSource, InstitutionQueryParams } from '@adapters/InstitutionSource';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import { normalizeCatalogue, normalizePublication, normalizeShelf } from '@model/opds/normalize';
import { type Institution, normalizeInstitutionList } from '@model/institution';
import { assertPublication } from '@model/validate';

import homeCatalogueFixture from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import shelfGroupFixture from '@model/fixtures/OPDS-samples/02-shelf-group.json';
import publicationDetailFixture from '@model/fixtures/OPDS-samples/03-publication-detail.json';
import institutionsFixture from '@model/fixtures/institutions.json';

// Strip combining diacritical marks so "Zurich" matches "Zürich".
function fold(str: string): string {
  return str.normalize('NFD').replace(/\p{M}/gu, '');
}

// The one institution the fixtures describe. Any other id is NOT_FOUND rather
// than silently serving Imperial's catalogue under someone else's name — CAP-3
// switches institutions, and a mock that answers for all of them would hide a
// wiring bug until production.
const FIXTURE_INSTITUTION = 'inst_7f3';

export interface MockAdapterOptions {
  // Artificial delay before every resolve OR reject. Defaults to 0 so the
  // conformance suite stays fast; set it in the gallery to exercise spinners.
  latencyMs?: number;
  // When set, EVERY method rejects with this code. The only way to build and
  // review error states before a real network can fail.
  failWith?: CatalogueError;
}

export class MockAdapter implements DataSource {
  private readonly latencyMs: number;
  private readonly failWith?: CatalogueError;

  constructor(options: MockAdapterOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.failWith = options.failWith;
  }

  async getHomeCatalogue(institutionId: string): Promise<Catalogue> {
    await this.simulate(institutionId);
    // Mock serves the same fixture catalogue for any institution — only one
    // OPDS feed exists in fixtures. assertInstitution is intentionally skipped
    // here now that CAP-3 is wired; the real API will serve per-institution feeds.

    const catalogue = normalizeCatalogue(homeCatalogueFixture);
    catalogue.shelves.flatMap((shelf) => shelf.publications).forEach(assertPublication);
    return catalogue;
  }

  async getShelf(institutionId: string, shelfId: string, page?: number): Promise<Shelf> {
    await this.simulate(shelfId);
    // Same as getHomeCatalogue — fixture serves any institution.

    const shelf = this.shelvesById().get(shelfId);
    // A shelf that navigation advertises but no fixture backs (e.g. 'audiobooks')
    // is NOT_FOUND, not an empty shelf. An empty result would read as "this
    // institution has no audiobooks" and quietly hide the missing fixture.
    if (shelf === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, shelfId);
    }

    // Only one page of fixture data exists. Asking beyond it is answered with an
    // empty final page rather than NOT_FOUND: running off the end of a listing is
    // normal paging, not a missing shelf.
    if (page !== undefined && page > 0) {
      const { nextPage: _nextPage, ...lastPage } = shelf;
      return { ...lastPage, publications: [] };
    }

    shelf.publications.forEach(assertPublication);
    return shelf;
  }

  async getPublication(institutionId: string, bookId: BookId): Promise<Publication> {
    await this.simulate(bookId);
    // Same as getHomeCatalogue — fixture serves any institution.

    const publication = this.publicationsById().get(bookId);
    if (publication === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, bookId);
    }

    assertPublication(publication);
    return publication;
  }

  async getInstitutions(params?: InstitutionQueryParams): Promise<Institution[]> {
    await this.simulate('institutions');

    let results = normalizeInstitutionList(institutionsFixture);

    if (params?.institutionId !== undefined) {
      results = results.filter((i) => i.id === params.institutionId);
    }

    if (params?.q !== undefined && params.q.length > 0) {
      const needle = fold(params.q.toLowerCase());
      results = results.filter((i) => fold(i.name.toLowerCase()).includes(needle));
    }

    if (params?.country !== undefined) {
      const target = params.country.toLowerCase();
      results = results.filter((i) => i.country.toLowerCase() === target);
    }

    const size = params?.size ?? results.length;
    const page = params?.page ?? 0;
    results = results.slice(page * size, page * size + size);

    return results;
  }

  async getInstitution(institutionId: string): Promise<Institution> {
    await this.simulate(institutionId);

    const institution = normalizeInstitutionList(institutionsFixture).find(
      (candidate) => candidate.id === institutionId,
    );
    // Rejects rather than resolving undefined — called out by name in the
    // Foundation Spec's conformance requirements.
    if (institution === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, institutionId);
    }

    return institution;
  }

  // Latency and injected failure, applied to every method in one place.
  // Latency comes FIRST so an injected failure still takes time to arrive —
  // an instant error cannot exercise the loading-then-error transition.
  private async simulate(target: string): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (this.failWith !== undefined) {
      throw new CatalogueFailure(this.failWith, target);
    }
  }

  private assertInstitution(institutionId: string): void {
    if (institutionId !== FIXTURE_INSTITUTION) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, institutionId);
    }
  }

  // Shelves the fixtures can answer for: the standalone shelf feed, plus every
  // group embedded in the home catalogue.
  //
  // Rebuilt per call rather than cached in the constructor so each call returns
  // fresh objects. A shared instance handing out the same mutable arrays would
  // let one screen's edit show up in another's — a bug class the real adapter
  // could never have, so the mock must not invent it.
  private shelvesById(): Map<string, Shelf> {
    const shelves = new Map<string, Shelf>();
    for (const group of normalizeCatalogue(homeCatalogueFixture).shelves) {
      shelves.set(group.id, group);
    }
    // The dedicated shelf feed wins: it is a full paginated listing, while the
    // home-catalogue group is only a preview of the same shelf.
    const standalone = normalizeShelf(shelfGroupFixture);
    shelves.set(standalone.id, standalone);
    return shelves;
  }

  // Every publication the fixtures mention, detail feed preferred over summary.
  private publicationsById(): Map<BookId, Publication> {
    const publications = new Map<BookId, Publication>();
    for (const shelf of this.shelvesById().values()) {
      for (const publication of shelf.publications) {
        publications.set(publication.id, publication);
      }
    }
    // Overwrites the summary: the detail feed carries subtitle, description and
    // page count that a listing omits.
    const detail = normalizePublication(publicationDetailFixture);
    publications.set(detail.id, detail);
    return publications;
  }
}
