// src/adapters/ApiAdapter.ts
// CatalogueSource backed by the real OPDS API over HTTP.
//
// DELIBERATELY THIN, and honest about why: api.tf does not exist yet. Endpoint
// paths are derived from the self-hrefs inside the frozen fixtures, which is the
// best evidence available — so this file is a real, tested implementation of
// URL building, status mapping and parsing, but the paths themselves are the one
// part that may churn when wokay ships. Auth headers and retry policy are still
// left out rather than guessed at.
//
// It shares normalize.ts with MockAdapter, so the two cannot disagree about the
// shape they produce — only about where the bytes came from.
//
// HOME-FEED ETAG CACHING. `getHomeCatalogue` is the one method that sends
// `If-None-Match` and can get a 304 back — a real cost saver here specifically,
// since a home feed is fetched on every tab visit and, unlike a shelf listing
// or a search, is rarely different between two fetches a session apart. The
// cache is in-memory and per-adapter-instance: it is "what this process has
// already downloaded," not a persisted store, so a cold start always fetches
// fresh — the same behaviour as before this existed, just with a chance to
// skip the download on a warm one.
import type { BookId } from '@/shared/types/primitives';
import type { BatchItemsResult, Catalogue, Publication, Shelf } from '@model/types';
import type { DataSource, InstitutionQueryParams } from '@adapters/InstitutionSource';
import type { ShelfQuery } from '@adapters/CatalogueSource';
import { CatalogueError, CatalogueFailure, isCatalogueFailure } from '@model/errors';
import { normalizeCatalogue, normalizePublication, normalizeShelf } from '@model/opds/normalize';
import { MAX_BATCH_IDS, normalizeBatchItemsResponse } from '@model/batchItems';
import {
  type Institution,
  normalizeInstitution,
  normalizeInstitutionList,
} from '@model/institution';
import { assertPublication } from '@model/validate';
import { browseParams } from '@search/browseLink';
import { expandSearchLink } from '@search/searchLink';

// Strip combining diacritical marks so "Zurich" matches "Zürich" — same rule
// MockAdapter.ts uses, kept in step here since both must agree on what a
// search match means.
function fold(str: string): string {
  return str.normalize('NFD').replace(/\p{M}/gu, '');
}

// Only the two members of Response this adapter actually uses.
//
// Structural, rather than the DOM `Response`, so tests can hand over a plain
// object instead of constructing a real Response — and so nothing here depends on
// which fetch implementation React Native ships. Narrow types also make it
// obvious that no code path reads `.body`, `.headers` or `.text()`.
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  // Optional so every existing fixture/stub response literal (tests, mostly)
  // keeps compiling unchanged — only getHomeCatalogue's ETag check reads this.
  headers?: { get(name: string): string | null };
}

export type FetchLike = (
  url: string,
  // method/body optional so every existing GET call site keeps compiling
  // unchanged — only getItemsBatch's POST reads them.
  init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string },
) => Promise<FetchResponse>;

export interface ApiAdapterOptions {
  // e.g. 'https://api.tf/opds/v1'. No trailing slash required either way.
  baseUrl: string;
  // Injected so tests can serve fixtures. Defaults to global fetch.
  fetch?: FetchLike;
  // Per-request deadline. A mobile client hanging on a stalled socket is
  // indistinguishable from a broken app, so there is always a deadline.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiAdapter implements DataSource {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  // ETag + the catalogue it was served with, keyed by URL (so per institution
  // — each has its own `/catalogue` endpoint). See the file header.
  private readonly homeCatalogueCache = new Map<string, { etag: string; catalogue: Catalogue }>();

  constructor(options: ApiAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getHomeCatalogue(institutionId: string): Promise<Catalogue> {
    const url = `${this.institutionPath(institutionId)}/catalogue`;
    const cached = this.homeCatalogueCache.get(url);

    const response = await this.fetchWithTimeout(
      url,
      institutionId,
      cached === undefined ? undefined : { 'If-None-Match': cached.etag },
    );

    // 304 is the server confirming the cached body is still current. Handled
    // before the ok-check below: only 200–299 counts as `ok`, so a 304 would
    // otherwise fall into the generic non-ok branch and be reported as
    // NETWORK_UNAVAILABLE — wrong for the one status code that means success.
    if (response.status === 304 && cached !== undefined) {
      return cached.catalogue;
    }

    if (!response.ok) {
      // 404 is a normal empty-state; anything else non-ok is the server having
      // a bad time, which a retry may well fix.
      throw new CatalogueFailure(
        response.status === 404 ? CatalogueError.NOT_FOUND : CatalogueError.NETWORK_UNAVAILABLE,
        institutionId,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      // 200 with a body that is not JSON usually means a captive portal or an
      // error page — the request "succeeded" but the payload is unusable.
      throw new CatalogueFailure(CatalogueError.MALFORMED_FEED, institutionId, cause);
    }

    const catalogue = normalizeCatalogue(body);
    catalogue.shelves.flatMap((shelf) => shelf.publications).forEach(assertPublication);

    // Cached only when the server actually sent one — no ETag, no future
    // If-None-Match, and every call after this one downloads fresh, same as
    // before this cache existed.
    const etag = response.headers?.get('ETag') ?? undefined;
    if (etag !== undefined) {
      this.homeCatalogueCache.set(url, { etag, catalogue });
    }

    return catalogue;
  }

  // `query` is screen 12's filter/sort dimensions. Built through `browseParams`
  // (src/search/browseLink.ts) — the shared query helper — rather than spelled
  // out here, so this adapter and the search feature cannot disagree about
  // wire parameter names or about sort being dropped for anything but 'all'.
  // `page` rides along in the same params bag: neither it nor a filter is a
  // template variable on a shelf's own href (never templated — see
  // browseLink.ts), so `expandSearchLink` only ever exercises its
  // append-what-was-supplied path here, same as it does for an undeclared
  // search filter.
  async getShelf(
    institutionId: string,
    shelfId: string,
    page?: number,
    query?: ShelfQuery,
  ): Promise<Shelf> {
    const base = `${this.institutionPath(institutionId)}/groups/${encodeURIComponent(shelfId)}`;
    const params = {
      ...browseParams(shelfId, { contentType: query?.contentType, accessTier: query?.accessTier }, query?.sort),
      // Omitted entirely when absent, so the server applies its own default
      // rather than being told "page 0".
      ...(page === undefined ? {} : { page: String(page) }),
    };

    const body = await this.getJson(expandSearchLink(base, params), shelfId);

    const shelf = normalizeShelf(body);
    shelf.publications.forEach(assertPublication);
    return shelf;
  }

  async getPublication(institutionId: string, bookId: BookId): Promise<Publication> {
    const body = await this.getJson(
      `${this.institutionPath(institutionId)}/publications/${encodeURIComponent(bookId)}`,
      bookId,
    );

    const publication = normalizePublication(body);
    assertPublication(publication);
    return publication;
  }

  // A1 — GET /opds/v1/public/catalogue. The one catalogue path in this file that
  // is NOT a guess: the contract declares it `x-stability: FROZEN` with
  // `security: []`, so both the path and the absence of a token are pinned.
  //
  // No institution in the path and no auth header, which is the feature rather
  // than an omission. Not ETag-cached either: `Cache-Control: public, max-age=300`
  // is the contract's answer for this feed, and a second caching strategy beside
  // the home feed's would be two things to reason about for no gain.
  async getPublicFeed(page?: number): Promise<Shelf> {
    const base = `${this.baseUrl}/public/catalogue`;
    // Omitted entirely when absent, so the server applies its own default rather
    // than being told "page 0".
    const url = page === undefined ? base : `${base}?page=${page}`;

    const body = await this.getJson(url, 'public catalogue');

    const feed = normalizeShelf(body);
    feed.publications.forEach(assertPublication);
    return feed;
  }

  async getPublicPublication(bookId: BookId): Promise<Publication> {
    const body = await this.getJson(
      `${this.baseUrl}/public/publications/${encodeURIComponent(bookId)}`,
      bookId,
    );

    const publication = normalizePublication(body);
    assertPublication(publication);
    return publication;
  }

  // ENDPOINT IS A GUESS, and a weaker one than the catalogue paths above: those
  // were derived from self-hrefs inside wokay's fixtures, whereas institutions
  // are a shape we invented, so nothing upstream has confirmed either the path or
  // the envelope. Expect this to be the first thing that changes when wokay reply.
  // The endpoint has no search or paging of its own — it always returns the
  // full list — so those params are applied here in JS instead, the same way
  // MockAdapter.getInstitutions does against its fixture. Keeps the
  // DataSource contract (params actually filter/page) true for every caller,
  // even though the real API can't do it server-side yet.
  async getInstitutions(params?: InstitutionQueryParams): Promise<Institution[]> {
    const body = await this.getJson(`${this.baseUrl}/institutions`, 'institutions');
    let results = normalizeInstitutionList(body);

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
    return results.slice(page * size, page * size + size);
  }




  async getInstitution(institutionId: string): Promise<Institution> {
    const body = await this.getJson(
      `${this.baseUrl}/institutions/${encodeURIComponent(institutionId)}`,
      institutionId,
    );

    return normalizeInstitution(body);
  }

  // Turns a list of item ids into thin summaries in one call. batchGetItems
  // lives at the API host's root (/api/v1/...), a sibling namespace to the
  // OPDS routes every other method here builds off `baseUrl` — so this uses
  // apiOrigin() instead.
  async getItemsBatch(ids: BookId[]): Promise<BatchItemsResult> {
    if (ids.length > MAX_BATCH_IDS) {
      throw new CatalogueFailure(CatalogueError.TOO_MANY_IDS, `${ids.length} ids`);
    }

    const url = `${this.apiOrigin()}/api/v1/catalogue/items:batch`;
    const body = await this.postJson(url, 'items:batch', { ids });
    return normalizeBatchItemsResponse(body);
  }

  // Ids are percent-encoded on the way into the path. Without this, an id
  // containing '../' or '?' would silently rewrite which endpoint gets called.
  private institutionPath(institutionId: string): string {
    return `${this.baseUrl}/institutions/${encodeURIComponent(institutionId)}`;
  }

  // baseUrl is OPDS-rooted ('.../opds/v1'), but items:batch is pinned by the
  // frozen contract at the host root ('/api/v1/...'), a sibling path — so this
  // takes the scheme+host only, not baseUrl's OPDS suffix.
  private apiOrigin(): string {
    const afterScheme = this.baseUrl.indexOf('://') + 3;
    const pathStart = this.baseUrl.indexOf('/', afterScheme);
    return pathStart === -1 ? this.baseUrl : this.baseUrl.slice(0, pathStart);
  }

  // POST counterpart to getJson. Kept separate rather than widening getJson,
  // because the status mapping differs: a 400 here means TOO_MANY_IDS, a
  // meaningful code, not getJson's generic "server having a bad time" bucket.
  private async postJson(url: string, target: string, requestBody: unknown): Promise<unknown> {
    try {
      const response = await this.fetchWithTimeout(
        url,
        target,
        { 'Content-Type': 'application/json' },
        'POST',
        JSON.stringify(requestBody),
      );

      if (!response.ok) {
        if (response.status === 400) {
          throw new CatalogueFailure(CatalogueError.TOO_MANY_IDS, target);
        }
        throw new CatalogueFailure(
          response.status === 404 ? CatalogueError.NOT_FOUND : CatalogueError.NETWORK_UNAVAILABLE,
          target,
        );
      }

      try {
        return await response.json();
      } catch (cause) {
        throw new CatalogueFailure(CatalogueError.MALFORMED_FEED, target, cause);
      }
    } catch (err) {
      if (isCatalogueFailure(err)) throw err;
      throw new CatalogueFailure(CatalogueError.NETWORK_UNAVAILABLE, target, err);
    }
  }

  // The transport step alone: issues the request under a deadline and maps a
  // stalled or unreachable socket to a CatalogueFailure. Split out from
  // `getJson` so `getHomeCatalogue` can inspect the raw response (status 304,
  // the ETag header) before `getJson`'s ok-check and JSON parsing would
  // otherwise force a decision on it.
  private async fetchWithTimeout(
    url: string,
    target: string,
    headers?: Record<string, string>,
    method?: string,
    body?: string,
  ): Promise<FetchResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetch(url, { signal: controller.signal, headers, method, body });
    } catch (err) {
      // The deadline fired, or the caller aborted.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CatalogueFailure(CatalogueError.TIMEOUT, target, err);
      }
      // fetch rejects with TypeError for DNS failure, no route, TLS refusal.
      throw new CatalogueFailure(CatalogueError.NETWORK_UNAVAILABLE, target, err);
    } finally {
      // Always cleared: a pending timer would keep the JS timer queue alive and
      // abort a controller nobody is listening to any more.
      clearTimeout(timer);
    }
  }

  // One place where a fetched response becomes parsed JSON or a
  // CatalogueFailure, so no caller ever sees a raw HTTP status or a JSON
  // parse error. Every method except getHomeCatalogue goes through this —
  // none of the others has a reason to inspect status or headers first.
  private async getJson(url: string, target: string): Promise<unknown> {
    try {
      const response = await this.fetchWithTimeout(url, target);

      if (!response.ok) {
        // 404 is a normal empty-state; anything else non-ok is the server having
        // a bad time, which a retry may well fix.
        throw new CatalogueFailure(
          response.status === 404 ? CatalogueError.NOT_FOUND : CatalogueError.NETWORK_UNAVAILABLE,
          target,
        );
      }

      try {
        return await response.json();
      } catch (cause) {
        // 200 with a body that is not JSON usually means a captive portal or an
        // error page — the request "succeeded" but the payload is unusable.
        throw new CatalogueFailure(CatalogueError.MALFORMED_FEED, target, cause);
      }
    } catch (err) {
      // Already classified — fetchWithTimeout only ever throws a
      // CatalogueFailure, and the branches above throw nothing else.
      if (isCatalogueFailure(err)) throw err;
      throw new CatalogueFailure(CatalogueError.NETWORK_UNAVAILABLE, target, err);
    }
  }
}
