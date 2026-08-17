// src/search/searchLink.ts
// Templated-link expansion — THE ONLY PLACE IN THE APP THAT BUILDS A SEARCH URL.
//
// `normalize.ts` deliberately hands the search link over untouched
// ('.../search{?query}', "kept templated for the search feature to expand
// itself"), which makes expansion B1's job and this file the whole of it. Keeping
// it here rather than in the pipeline — let alone in a screen — is what lets the
// URL rules be unit-tested with nothing mounted, and is why no presentation
// component in this feature imports a host, a path or a parameter name.
//
// RFC 6570, RESTRICTED TO THE ONE OPERATOR OPDS USES. Form-style query expansion
// ('{?query}', '{?query,contentType}') is what the frozen fixtures carry and the
// only form implemented. Anything else — '{+var}', '{/var}', '{var}' — throws
// MALFORMED_FEED rather than being guessed at, the same way `rels.ts` refuses an
// unrecognised rel: a silently mangled URL fails much later, as an empty result
// list with nothing to point at.
import { CatalogueError, CatalogueFailure } from '@model/errors';

import type { SearchFilters } from './pipeline';

// One '{...}' expression. Non-greedy over a body that cannot itself contain
// braces, so an unterminated brace is left alone (and then fails as an
// unsupported expression) rather than swallowing the rest of the URL.
const EXPRESSION = /\{([^{}]*)\}/g;

// ─── Q-12 ────────────────────────────────────────────────────────────────────

// Whether '?accessTier=' is a parameter the search endpoint accepts.
//
// RESOLVED. wokay's frozen contract (wokay-api.yaml) declares `AccessTierFilter`
// (-> `accessTier`, one of `OPEN_ACCESS | SUBSCRIPTION | ELITE`) as a query
// parameter on both `getGroupFeed` and `searchCatalogue` — the same enum
// `Acquisition.licenceModel` already carries in every fixture. Q-12 asked
// whether the parameter existed at all with no tier field on a book; the answer
// is that the server derives it same as we do and still accepts it as a filter.
//
// Left as a named constant rather than inlined `true`, per the original design:
// one flag, no other edit, so a future regression in either direction is a
// one-line diff away from being found.
export const ACCESS_TIER_FILTER_CONFIRMED = true;

// ─── Parameters ──────────────────────────────────────────────────────────────

// Wire parameter names, spelled once. A rename is then one edit here rather than
// a search-and-hope through the pipeline, the fixtures and the tests.
export const SEARCH_PARAM = {
  query: 'query',
  contentType: 'contentType',
  accessTier: 'accessTier',
} as const;

/** Parameter name → value. `undefined` means "not supplied", never "empty". */
export type SearchLinkParams = Readonly<Record<string, string | undefined>>;

/**
 * The query string a search request carries, as parameters rather than a URL.
 *
 * FILTERS ARE PARAMETERS, WHICH IS WHY THEY REACH THE SERVER BEFORE PAGINATION.
 * The whole request — text and every active filter — is built here in one go and
 * sent once. Nothing downstream ever fetches a page and then narrows it locally:
 * the narrowing already happened server-side, so page 1 of a filtered search is
 * page 1 of the filtered set, not a filtered view of page 1 of everything.
 */
export function searchParams(query: string, filters: SearchFilters): SearchLinkParams {
  const trimmed = query.trim();

  return {
    // Blank is omitted rather than sent as '?query=' — an empty parameter and an
    // absent one mean different things to a server, and only one of them is true.
    ...(trimmed.length > 0 ? { [SEARCH_PARAM.query]: trimmed } : {}),
    ...(filters.contentType !== undefined
      ? { [SEARCH_PARAM.contentType]: filters.contentType }
      : {}),
    // Confirmed by contract — see ACCESS_TIER_FILTER_CONFIRMED above.
    ...(ACCESS_TIER_FILTER_CONFIRMED && filters.accessTier !== undefined
      ? { [SEARCH_PARAM.accessTier]: filters.accessTier }
      : {}),
  };
}

// ─── Expansion ───────────────────────────────────────────────────────────────

function malformed(what: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, what);
}

function pair(name: string, value: string): string {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/**
 * Expands a templated search link against a set of parameters.
 *
 * Declared-and-supplied variables expand in the template's own order. Declared
 * variables with nothing supplied are omitted, per RFC 6570 — a template of
 * '{?query,contentType}' with only a query produces '?query=x', not
 * '?query=x&contentType='.
 *
 * SUPPLIED VARIABLES THE TEMPLATE DOES NOT DECLARE ARE APPENDED, and that is a
 * decision worth stating rather than discovering. Strictly, a template declares
 * the server's whole vocabulary, so an undeclared parameter should be dropped.
 * But the frozen fixtures declare only '{?query}' while B1 is required to send
 * filters as query parameters — dropping them would leave the filter chips
 * visibly doing nothing, which is the worse failure of the two: a parameter the
 * server ignores is inert, whereas a chip that silently does nothing looks like
 * a bug in the client. So they are appended, and the day wokay publish a real
 * variable list this becomes a no-op because everything sent will be declared.
 * (Nothing unconfirmed is appended regardless — see `searchParams`.)
 */
export function expandSearchLink(template: string, params: SearchLinkParams): string {
  const supplied = new Map(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
  const declared = new Set<string>();

  let url = template.replace(EXPRESSION, (_match, body: string) => {
    // '?' is form-style query expansion. Every other operator, and the bare
    // '{var}' simple-string form, would need its own escaping and reserved-set
    // rules — none of which any surface we consume uses.
    if (!body.startsWith('?')) {
      throw malformed(`unsupported search link expression: {${body}}`);
    }

    const names = body
      .slice(1)
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (names.length === 0) throw malformed('search link expression declares no variables');

    const pairs: string[] = [];
    for (const name of names) {
      declared.add(name);
      const value = supplied.get(name);
      if (value !== undefined) pairs.push(pair(name, value));
    }

    return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
  });

  const appended = [...supplied]
    .filter(([name]) => !declared.has(name))
    .map(([name, value]) => pair(name, value));

  if (appended.length > 0) {
    // '?' only if the expansion produced no query string of its own — a template
    // may also arrive with one already baked in ('.../search?scope=all{?query}').
    url += `${url.includes('?') ? '&' : '?'}${appended.join('&')}`;
  }

  return url;
}
