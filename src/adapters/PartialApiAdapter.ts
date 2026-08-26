// src/adapters/PartialApiAdapter.ts
// A DataSource for the in-between state where only some real endpoints exist.
//
// Right now the real backend only implements institutions. Everything else
// (catalogue, shelves, publications, public feed, batch items) still needs to
// come from fixtures. Rather than teach every one of those methods its own
// mock/api branch, this class holds one ApiAdapter and one MockAdapter and
// routes each DataSource method to whichever backs it today — swap a method
// over to `this.api` as its real endpoint ships.
import type { BookId } from '@/shared/types/primitives';
import type { BatchItemsResult, Catalogue, Publication, Shelf } from '@model/types';
import type { Institution } from '@model/institution';
import type { DataSource, InstitutionQueryParams } from '@adapters/InstitutionSource';
import type { ShelfQuery } from '@adapters/CatalogueSource';
import { ApiAdapter } from '@adapters/ApiAdapter';
import { MockAdapter, type MockAdapterOptions } from '@adapters/MockAdapter';

export class PartialApiAdapter implements DataSource {
  private readonly api: ApiAdapter;
  private readonly mock: MockAdapter;

  constructor(baseUrl: string, mockOptions?: MockAdapterOptions) {
    this.api = new ApiAdapter({ baseUrl });
    this.mock = new MockAdapter(mockOptions);
  }

  getInstitutions(params?: InstitutionQueryParams): Promise<Institution[]> {
    return this.api.getInstitutions(params);
  }

  getInstitution(institutionId: string): Promise<Institution> {
    return this.api.getInstitution(institutionId);
  }

  getHomeCatalogue(institutionId: string): Promise<Catalogue> {
    return this.mock.getHomeCatalogue(institutionId);
  }

  getShelf(
    institutionId: string,
    shelfId: string,
    page?: number,
    query?: ShelfQuery,
  ): Promise<Shelf> {
    return this.mock.getShelf(institutionId, shelfId, page, query);
  }

  getPublication(institutionId: string, bookId: BookId): Promise<Publication> {
    return this.mock.getPublication(institutionId, bookId);
  }

  getPublicFeed(page?: number): Promise<Shelf> {
    return this.mock.getPublicFeed(page);
  }

  getPublicPublication(bookId: BookId): Promise<Publication> {
    return this.mock.getPublicPublication(bookId);
  }

  getItemsBatch(ids: BookId[]): Promise<BatchItemsResult> {
    return this.mock.getItemsBatch(ids);
  }
}
