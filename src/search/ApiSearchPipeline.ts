// src/search/ApiSearchPipeline.ts
// The Week-4 real-backend implementation of CatalogueSearchPipeline.
//
// Replaces FixtureSearchPipeline behind the same interface — no caller changes.
// Configured in src/config/search.ts when EXPO_PUBLIC_SEARCH_PIPELINE=api.
//
// AUTH: searchCatalogue is FROZEN with security: [{ appToken }], so every
// request sends a Bearer token via withAuthHeader, the same opt-in helper
// ApiAdapter uses. Token comes from getToken (defaulting to ensureFreshToken)
// injected at construction — one token source, every authenticated client.
//
// SEARCH LINK DISCOVERY: the search URL template is discovered off the
// institution's home catalogue (same as FixtureSearchPipeline), so no path
// is hardcoded here. A catalogue with no search link throws NOT_FOUND —
// correct, because there is no URL to call.
import type { CatalogueSource } from '@adapters/CatalogueSource';
import { type FetchLike, type FetchResponse, withAuthHeader } from '@adapters/ApiAdapter';
import { getCatalogueSource } from '@config/catalogue';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import { normalizeSearchFeed } from '@model/opds/normalize';
import type { SearchFeed } from '@model/types';
import { assertPublication } from '@model/validate';

import type { CatalogueSearchPipeline, SearchRequest } from './pipeline';
import { expandSearchLink, searchParams } from './searchLink';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiSearchPipelineOptions {
  source?: CatalogueSource;
  getToken?: () => Promise<string | undefined>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class ApiSearchPipeline implements CatalogueSearchPipeline {
  private readonly source: CatalogueSource;
  private readonly getToken: () => Promise<string | undefined>;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ApiSearchPipelineOptions = {}) {
    this.source = options.source ?? getCatalogueSource();
    this.getToken = options.getToken ?? (async () => undefined);
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(request: SearchRequest): Promise<SearchFeed> {
    const isPublic = request.institutionId === undefined;
    console.log('ApiSearchPipeline: search mode', isPublic ? 'public' : `institution:${request.institutionId}`);
    const feed = isPublic
      ? await this.source.getPublicFeed()
      : await this.source.getHomeCatalogue(request.institutionId as string);

    const target = request.institutionId ?? 'public';

    if (feed.searchHref === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, `search link for ${target}`);
    }

    const url = expandSearchLink(feed.searchHref, searchParams(request.query, request.filters));
    console.log('ApiSearchPipeline: search url', url);
    return this.fetchFeed(url, target, isPublic);
  }

  async next(next: string): Promise<SearchFeed> {
    return this.fetchFeed(next, next, false);
  }

  private async fetchFeed(url: string, target: string, skipAuth = false): Promise<SearchFeed> {
    const token = skipAuth ? undefined : await this.getToken();
    const headers = withAuthHeader(undefined, token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: FetchResponse;
    try {
      response = await this.fetch(url, { signal: controller.signal, headers });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CatalogueFailure(CatalogueError.TIMEOUT, target, err);
      }
      throw new CatalogueFailure(CatalogueError.NETWORK_UNAVAILABLE, target, err);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new CatalogueFailure(
        response.status === 404 ? CatalogueError.NOT_FOUND : CatalogueError.NETWORK_UNAVAILABLE,
        target,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new CatalogueFailure(CatalogueError.MALFORMED_FEED, target, cause);
    }

    const feed = normalizeSearchFeed(body);
    feed.publications.forEach(assertPublication);
    console.log('ApiSearchPipeline: results count', feed.publications.length);
    return feed;
  }
}
