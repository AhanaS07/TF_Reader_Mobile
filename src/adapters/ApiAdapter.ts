// src/adapters/ApiAdapter.ts
// CatalogueSource backed by the real OPDS API over HTTP.
//
// DELIBERATELY THIN, and honest about why: api.tf does not exist yet. Endpoint
// paths are derived from the self-hrefs inside the frozen fixtures, which is the
// best evidence available — so this file is a real, tested implementation of
// URL building, status mapping and parsing, but the paths themselves are the one
// part that may churn when wokay ships. Everything speculative (auth headers,
// retry policy, ETag caching) is left out rather than guessed at.
//
// It shares normalize.ts with MockAdapter, so the two cannot disagree about the
// shape they produce — only about where the bytes came from.
import type { BookId } from '@/shared/types/primitives';
import type { Catalogue, Publication, Shelf } from '@model/types';
import type { DataSource } from '@adapters/InstitutionSource';
import { CatalogueError, CatalogueFailure, isCatalogueFailure } from '@model/errors';
import { normalizeCatalogue, normalizePublication, normalizeShelf } from '@model/opds/normalize';
import {
  type Institution,
  normalizeInstitution,
  normalizeInstitutionList,
} from '@model/institution';
import { assertPublication } from '@model/validate';

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
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
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

  constructor(options: ApiAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getHomeCatalogue(institutionId: string): Promise<Catalogue> {
    const body = await this.getJson(`${this.institutionPath(institutionId)}/catalogue`, institutionId);

    const catalogue = normalizeCatalogue(body);
    catalogue.shelves.flatMap((shelf) => shelf.publications).forEach(assertPublication);
    return catalogue;
  }

  async getShelf(institutionId: string, shelfId: string, page?: number): Promise<Shelf> {
    // Page goes in the query string, never the path, and is omitted entirely when
    // absent so the server applies its own default rather than being told "page 0".
    const query = page === undefined ? '' : `?page=${encodeURIComponent(String(page))}`;
    const body = await this.getJson(
      `${this.institutionPath(institutionId)}/groups/${encodeURIComponent(shelfId)}${query}`,
      shelfId,
    );

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

  // ENDPOINT IS A GUESS, and a weaker one than the catalogue paths above: those
  // were derived from self-hrefs inside wokay's fixtures, whereas institutions
  // are a shape we invented, so nothing upstream has confirmed either the path or
  // the envelope. Expect this to be the first thing that changes when wokay reply.
  async getInstitutions(): Promise<Institution[]> {
    const body = await this.getJson(`${this.baseUrl}/institutions`, 'institutions');

    return normalizeInstitutionList(body);
  }

  async getInstitution(institutionId: string): Promise<Institution> {
    const body = await this.getJson(
      `${this.baseUrl}/institutions/${encodeURIComponent(institutionId)}`,
      institutionId,
    );

    return normalizeInstitution(body);
  }

  // Ids are percent-encoded on the way into the path. Without this, an id
  // containing '../' or '?' would silently rewrite which endpoint gets called.
  private institutionPath(institutionId: string): string {
    return `${this.baseUrl}/institutions/${encodeURIComponent(institutionId)}`;
  }

  // One place where transport failures become CatalogueFailures, so no caller
  // ever sees a raw TypeError, an AbortError, or an HTTP status.
  private async getJson(url: string, target: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url, { signal: controller.signal });

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
      // Already classified (including MALFORMED_FEED thrown by the normalizer's
      // caller path) — do not re-wrap and lose the specific code.
      if (isCatalogueFailure(err)) throw err;
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
}
