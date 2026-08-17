// src/search/FixtureSearchPipeline.ts
// The Week-1 stand-in for wokay's catalogue search endpoint (R3c, Week 4).
//
// IT IS A STUB SERVER, NOT A SEARCH IMPLEMENTATION, and the difference is the
// whole point. It takes an expanded URL and returns a canned response chosen by
// that URL's query parameters — a LOOKUP. It never reads a title, never tokenises
// a query, never scores or orders anything. Nothing in this file is search logic,
// so nothing in this file is logic that has to be thrown away in Week 4: the file
// is deleted whole and `ApiSearchPipeline` takes its place behind the same
// interface, with no change above it.
//
// THE PARTS THAT ARE REAL, on purpose, because these are the parts that must
// still work in Week 4:
//   • templated-link discovery — the search href comes off the actual catalogue
//     via `CatalogueSource`, not from a constant in this file
//   • templated-link expansion — through the real `expandSearchLink`
//   • parsing — through the real `normalizeSearchFeed` and `assertPublication`,
//     exactly as MockAdapter parses the frozen samples rather than hand-authoring
//     domain objects
// So if the normalizer mishandles a search response, or the template expands
// wrongly, or a fixture violates a cross-field invariant, it surfaces today.
import { getCatalogueSource } from '@config/catalogue';
import type { CatalogueSource } from '@adapters/CatalogueSource';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import { normalizeSearchFeed } from '@model/opds/normalize';
import type { SearchFeed } from '@model/types';
import { assertPublication } from '@model/validate';

import type { CatalogueSearchPipeline, SearchRequest } from './pipeline';
import { SEARCH_PARAM, expandSearchLink, searchParams } from './searchLink';

import audioFixture from './fixtures/search-audio.json';
import browseInsteadFixture from './fixtures/search-browse-instead.json';
import resultsPage2Fixture from './fixtures/search-results-page-2.json';
import resultsFixture from './fixtures/search-results.json';

// ─── The scenario table ──────────────────────────────────────────────────────

// Which canned response answers which request. `when` is matched by exact
// equality on every key it names, and the MOST SPECIFIC match wins — so ordering
// this array cannot change the outcome, which is one less thing to get wrong when
// a scenario is added.
//
// Anything unmatched falls through to the browse-instead response. That default
// is deliberate rather than incidental: it means the zero-result path — the one
// with no `publications` key at all — is what you get by typing almost anything,
// so it is impossible to build this screen without having seen it.
//
// See fixtures/README.md for why `climate` and not something more meaningful: the
// pairing is arbitrary because the lookup is arbitrary.
interface Scenario {
  readonly when: Readonly<Record<string, string>>;
  readonly feed: unknown;
}

const SCENARIOS: readonly Scenario[] = [
  { when: { query: 'climate' }, feed: resultsFixture },
  // The `next` href page 1 carries. Reached by following that value, never by
  // this pipeline constructing a page number.
  { when: { query: 'climate', page: '1' }, feed: resultsPage2Fixture },
  // PROVES THE FILTER REACHED THE SERVER. A different response, not a narrowed
  // one — the stub does not filter page 1's results, it answers a different
  // request. That is the shape the real endpoint has, and the shape the client
  // must not simulate for itself.
  { when: { query: 'climate', contentType: 'AUDIO' }, feed: audioFixture },
];

// Which parameters are free text a human typed, and are therefore compared
// case-insensitively.
//
// WHY THIS IS NOT PEDANTRY. A real search endpoint does not care whether the
// reader capitalised, so a stub that did would turn an ordinary typing habit into
// a zero-result response that is INDISTINGUISHABLE FROM AN EMPTY CATALOGUE — the
// reader sees "No publications found", concludes the fixtures are empty, and there
// is nothing on screen to suggest the only problem was a capital letter. That is
// the silent-failure class this file's header says the stub exists to surface
// early, so it must not be the stub that introduces one.
//
// Machine-valued parameters are still compared VERBATIM. `contentType` is a wire
// enum ('AUDIO', never 'audio') and `page` is a cursor value copied out of a
// server-issued href; folding their case would hide a genuine mismatch between
// what the client sent and what the server declared.
const FREE_TEXT_PARAMS: ReadonlySet<string> = new Set([SEARCH_PARAM.query]);

function comparable(name: string, value: string): string {
  return FREE_TEXT_PARAMS.has(name) ? value.toLowerCase() : value;
}

function pickFeed(params: Readonly<Record<string, string>>): unknown {
  let matched: unknown;
  let matchedKeys = -1;

  for (const scenario of SCENARIOS) {
    const keys = Object.keys(scenario.when);
    if (keys.length <= matchedKeys) continue;
    // `undefined` is checked explicitly rather than folded into the comparison:
    // a parameter the request never sent must not match a scenario that names it.
    if (
      !keys.every((key) => {
        const actual = params[key];
        return (
          actual !== undefined && comparable(key, actual) === comparable(key, scenario.when[key])
        );
      })
    ) {
      continue;
    }

    matched = scenario.feed;
    matchedKeys = keys.length;
  }

  return matched ?? browseInsteadFixture;
}

// Query string → parameters. Hand-parsed rather than via `URLSearchParams`, whose
// React Native polyfill is partial enough that relying on it here would make the
// stub behave differently under Jest and on a device.
function paramsOf(url: string): Record<string, string> {
  const start = url.indexOf('?');
  if (start === -1) return {};

  const params: Record<string, string> = {};
  for (const part of url.slice(start + 1).split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    const name = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
    params[name] = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
  }
  return params;
}

// ─── The pipeline ────────────────────────────────────────────────────────────

export interface FixtureSearchPipelineOptions {
  // Where the templated search link is discovered. Defaults to the configured
  // catalogue source, so the pipeline follows the same Mock-vs-Api switch
  // everything else does rather than reaching for fixtures behind its back.
  source?: CatalogueSource;
  // Artificial delay before every resolve OR reject — the same contract
  // MockAdapter's option has, so a loading state can actually be seen.
  latencyMs?: number;
  // When set, every method rejects with this code. The only way to build and
  // review the error state before a real request can fail.
  failWith?: CatalogueError;
}

export class FixtureSearchPipeline implements CatalogueSearchPipeline {
  private readonly source: CatalogueSource;
  private readonly latencyMs: number;
  private readonly failWith?: CatalogueError;

  constructor(options: FixtureSearchPipelineOptions = {}) {
    this.source = options.source ?? getCatalogueSource();
    this.latencyMs = options.latencyMs ?? 0;
    this.failWith = options.failWith;
  }

  async search(request: SearchRequest): Promise<SearchFeed> {
    await this.simulate(request.institutionId);

    // DISCOVERED, NOT HARDCODED. The link comes off the institution's own
    // catalogue, so a catalogue with no `search` link is correctly not searchable
    // rather than being searched at a URL we made up.
    const catalogue = await this.source.getHomeCatalogue(request.institutionId);
    if (catalogue.searchHref === undefined) {
      throw new CatalogueFailure(CatalogueError.NOT_FOUND, `search link for ${request.institutionId}`);
    }

    return this.respondTo(
      expandSearchLink(catalogue.searchHref, searchParams(request.query, request.filters)),
    );
  }

  async next(next: string): Promise<SearchFeed> {
    await this.simulate(next);

    // The value verbatim. No re-expansion, no re-appending of filters — whatever
    // context the server put in its own `next` is the context that gets used.
    return this.respondTo(next);
  }

  // Parsed through the same normalizer and the same cross-field assertions the
  // adapters use, so a fixture cannot pass here and fail against the real code.
  private respondTo(url: string): SearchFeed {
    const feed = normalizeSearchFeed(pickFeed(paramsOf(url)));
    feed.publications.forEach(assertPublication);
    return feed;
  }

  // Latency first, so an injected failure still takes time to arrive — an instant
  // error cannot exercise the loading-then-error transition.
  private async simulate(target: string): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (this.failWith !== undefined) {
      throw new CatalogueFailure(this.failWith, target);
    }
  }
}
