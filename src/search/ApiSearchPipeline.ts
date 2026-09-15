// src/search/ApiSearchPipeline.ts
// The Week-4 real-backend implementation of CatalogueSearchPipeline.
//
// Replaces FixtureSearchPipeline behind the same interface — no caller changes.
// Configured in src/config/search.ts when EXPO_PUBLIC_SEARCH_PIPELINE=api.
//
// AUTH: institution search uses security: [{ appToken }] — Bearer token via
// withAuthHeader. Public search uses security: [] — no token, even if one is
// in storage. isPublicSearch tracks which mode is active so next() honours
// the same contract as the initial search() call.
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
  // Scheme+host+port of the backend (e.g. 'http://10.132.124.77:8080'). When
  // set, the origin of every URL received from a feed response is rewritten to
  // this value before fetching — the server returns 'localhost:8080' in hrefs,
  // which is unreachable from a physical device.
  baseUrl?: string;
}

export class ApiSearchPipeline implements CatalogueSearchPipeline {
  private readonly source: CatalogueSource;
  private readonly getToken: () => Promise<string | undefined>;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string | undefined;
  // Carries the auth mode from search() into next() so pagination respects the
  // same security contract as the initial request (public = no token).
  private isPublicSearch = false;

  constructor(options: ApiSearchPipelineOptions = {}) {
    this.source = options.source ?? getCatalogueSource();
    this.getToken = options.getToken ?? (async () => undefined);
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl;
  }

  // The backend returns 'localhost:8080' in every href it emits. That is
  // unreachable from a physical device, so we swap the origin for the
  // configured baseUrl before every fetch. No-op when baseUrl is unset.
  private rewriteOrigin(href: string): string {
    if (!this.baseUrl) return href;
    try {
      const target = new URL(href);
      const base = new URL(this.baseUrl);
      target.protocol = base.protocol;
      target.hostname = base.hostname;
      target.port = base.port;
      return target.toString();
    } catch {
      return href;
    }
  }

  async search(request: SearchRequest): Promise<SearchFeed> {
    this.isPublicSearch = request.institutionId === undefined;
    const target = request.institutionId ?? 'public';

    let searchHref: string | undefined;

    if (this.isPublicSearch) {
      // The public catalogue omits the search rel link and also contains dev
      // fixtures that fail publication validation — skip getPublicFeed() and
      // use the known path directly.
      searchHref = this.baseUrl
        ? `${this.baseUrl}/opds/v1/public/search{?query}`
        : undefined;
    } else {
      const feed = await this.source.getHomeCatalogue(request.institutionId as string);
      searchHref = feed.searchHref;
    }

    if (searchHref === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, `search link for ${target}`);
    }

    const url = expandSearchLink(searchHref, searchParams(request.query, request.filters));
    return this.fetchFeed(url, target, this.isPublicSearch);
  }

  async next(next: string): Promise<SearchFeed> {
    return this.fetchFeed(next, next, this.isPublicSearch);
  }

  private async fetchFeed(url: string, target: string, skipAuth = false): Promise<SearchFeed> {
    const token = skipAuth ? undefined : await this.getToken();
    const headers = withAuthHeader(undefined, token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: FetchResponse;
    try {
      response = await this.fetch(this.rewriteOrigin(url), { signal: controller.signal, headers });
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
    return feed;
  }
}
