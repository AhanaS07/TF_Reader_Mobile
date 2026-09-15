// src/search/searchState.ts
// Query state for the search surface. A PURE REDUCER — no React, no pipeline, no
// clock, no fetch.
//
// Why a reducer and not five `useState` calls: the query, the filters, the
// lifecycle, the results, the cursor and the error are not six independent facts.
// Submitting a query has to clear the cursor. Changing a filter has to discard the
// results. A late response has to be ignored if it is no longer the one being
// waited for. Held as separate pieces of state, each of those is a rule someone has
// to remember at every call site, and the first one missed produces a list that
// disagrees with the query above it. Here they are transitions, and they are
// testable without mounting anything.
//
// THREE OUTCOMES, NEVER CONFLATED. The whole design pressure on this file is
// keeping these apart:
//   1. results   — a page with publications in it
//   2. empty     — a SUCCESSFUL response with none, plus browse-instead targets
//   3. error     — the request or the pipeline actually failed
// (2) is not (3). See `pageArrived`.
import type { CatalogueError } from '@model/errors';
import type { NavLink, Publication, SearchFeed } from '@model/types';

import type { SearchFilters } from './pipeline';

// Lifecycle, as a union rather than a set of booleans (CONVENTIONS §4). Booleans
// would permit `loading && error`, which is not a state the surface has.
//
// `paging` is separate from `loading` because they render differently and must:
// a first search replaces the screen with skeletons, a next page keeps every
// result already read in place and appends below it.
export type SearchStatus = 'idle' | 'loading' | 'paging' | 'results' | 'empty' | 'error';

export interface SearchState {
  // What is in the field. Uncommitted.
  draft: string;
  // What was actually searched for. Trimmed, and only ever set by a submit.
  query: string;
  filters: SearchFilters;
  status: SearchStatus;
  publications: Publication[];
  // As reported by the server. Absent ⇒ it did not say; never counted locally,
  // because `publications.length` is a page and this is a result set.
  totalItems?: number;
  // The last response's `next`, verbatim. Absent ⇒ no further pages.
  next?: string;
  // Where to go instead, when there is nothing to show. Empty otherwise.
  browseInstead: NavLink[];
  errorCode?: CatalogueError;
  // Increments once per request actually started, and is echoed back by the
  // outcome that answers it. This is what makes a superseded response harmless:
  // type "clim", submit, change a filter, and the first response can still be in
  // flight — applying it would show results for a request nobody is waiting for.
  requestId: number;
}

export type SearchAction =
  // Intents — the surface asking for something.
  | { type: 'draftChanged'; draft: string }
  | { type: 'submitted' }
  | { type: 'cleared' }
  | { type: 'filterChanged'; filters: SearchFilters }
  | { type: 'nextRequested' }
  | { type: 'retried' }
  // Outcomes — the pipeline answering. Both carry the id they are answering.
  | { type: 'pageArrived'; requestId: number; feed: SearchFeed }
  | { type: 'requestFailed'; requestId: number; code: CatalogueError };

export const initialSearchState: SearchState = {
  draft: '',
  query: '',
  filters: {},
  status: 'idle',
  publications: [],
  browseInstead: [],
  requestId: 0,
};

// Drops everything a previous answer left behind. The optional keys are REMOVED
// rather than set to `undefined`, so "the server sent no total" has exactly one
// representation and a deep-equality assertion stays honest.
function withoutResults(state: SearchState): SearchState {
  const { totalItems: _totalItems, next: _next, errorCode: _errorCode, ...rest } = state;

  return { ...rest, publications: [], browseInstead: [] };
}

// Applies a change to one dimension. A dimension set back to "no constraint" is
// deleted rather than left as an explicit `undefined`, for the same reason.
function mergeFilters(current: SearchFilters, change: SearchFilters): SearchFilters {
  const contentType = 'contentType' in change ? change.contentType : current.contentType;
  const accessTier = 'accessTier' in change ? change.accessTier : current.accessTier;

  return {
    ...(contentType !== undefined ? { contentType } : {}),
    ...(accessTier !== undefined ? { accessTier } : {}),
  };
}

/**
 * Starts a search from the beginning.
 *
 * FILTERS ARE PART OF THE REQUEST, SO THEY START A NEW ONE. Every path into a
 * changed query or a changed filter comes through here, and here discards
 * `publications` and `next` together. That is what makes the banned flow —
 * fetch a page, then narrow it locally — unrepresentable rather than merely
 * discouraged: after this there is no page left to narrow, and the cursor into
 * the old result set is gone because it does not point into the new one.
 */
function beginSearch(
  state: SearchState,
  query: string,
  filters: SearchFilters,
): SearchState {
  const trimmed = query.trim();
  const base = { ...withoutResults(state), query: trimmed, filters };

  // NOTHING TO SEARCH FOR IS NOT A SEARCH THAT FOUND NOTHING. With no query the
  // surface's job is to invite one, so this goes to `idle` and starts no request —
  // reporting "no publications found" for a question nobody asked would be a lie,
  // and firing a blank query at an entitlement-scoped endpoint is worse.
  if (trimmed.length === 0) return { ...base, status: 'idle' };

  return { ...base, status: 'loading', requestId: state.requestId + 1 };
}

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    // TYPING IS NOT SEARCHING. Catalogue search is a server round trip against an
    // entitlement-scoped endpoint, so it runs on submit rather than per keystroke:
    // debounced-as-you-type would put a request behind every third character, and
    // the results would race each other on a mobile connection. The draft is the
    // field's business until the reader commits it.
    case 'draftChanged':
      return { ...state, draft: action.draft };

    case 'submitted':
      return beginSearch(state, state.draft, state.filters);

    // Emptying the field abandons the query but KEEPS THE FILTERS — the chips are
    // still visibly selected, so clearing them silently would make the surface
    // disagree with itself. The id still advances, so a response already in flight
    // cannot repopulate a surface the reader just cleared.
    case 'cleared':
      return {
        ...initialSearchState,
        filters: state.filters,
        requestId: state.requestId + 1,
      };

    case 'filterChanged':
      return beginSearch(state, state.query, mergeFilters(state.filters, action.filters));

    // Only a settled result set has a next page to ask for. Guarding here rather
    // than at the call site means a double-tap cannot queue two requests for the
    // same cursor.
    case 'nextRequested':
      if (state.status !== 'results' || state.next === undefined) return state;
      return { ...state, status: 'paging', requestId: state.requestId + 1 };

    // WHICH REQUEST TO RETRY IS DERIVABLE, so the surface does not have to
    // remember: a failed next-page attempt left its results on screen and kept
    // its cursor, a failed search had neither.
    case 'retried': {
      if (state.status !== 'error') return state;

      const wasPaging = state.next !== undefined && state.publications.length > 0;
      return {
        ...state,
        status: wasPaging ? 'paging' : 'loading',
        requestId: state.requestId + 1,
      };
    }

    case 'pageArrived': {
      // Superseded — a newer request has been started since this one left.
      if (action.requestId !== state.requestId) return state;

      const publications =
        state.status === 'paging'
          ? [...state.publications, ...action.feed.publications]
          : action.feed.publications;

      return {
        ...withoutResults(state),
        publications,
        browseInstead: action.feed.browseInstead,
        ...(action.feed.totalItems !== undefined ? { totalItems: action.feed.totalItems } : {}),
        ...(action.feed.next !== undefined ? { next: action.feed.next } : {}),
        // AN EMPTY PAGE IS A SUCCESS, NOT A FAILURE. The response arrived, it was
        // understood, and the answer is "none" — frequently with somewhere to go
        // instead. A search response may legitimately omit `publications`
        // altogether and carry only browse targets; `normalizeSearchFeed` turns
        // that into an empty array, and it lands here as `empty`. Nothing in this
        // file can reach `error` from a well-formed response.
        status: publications.length === 0 ? 'empty' : 'results',
      };
    }

    case 'requestFailed': {
      if (action.requestId !== state.requestId) return state;

      // Results already on screen are KEPT. A next page that failed to load is no
      // reason to throw away the twenty results the reader is part-way through —
      // the surface shows a retry where the next page would have gone. On a failed
      // first search there is nothing to keep, and it shows the full error state.
      return { ...state, status: 'error', errorCode: action.code };
    }
  }
}
