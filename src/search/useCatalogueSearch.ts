// src/search/useCatalogueSearch.ts
// The bridge between the pure reducer and the pipeline. Deliberately the only
// file in this feature that is both React and asynchronous, and deliberately
// thin: every rule about what a transition means lives in `searchState.ts`, and
// every rule about what a request looks like lives in `searchLink.ts`. What is
// left here is "when the state says a request is wanted, make it".
//
// THE SCREEN GETS NO PIPELINE AND NO URL. It gets a query, a lifecycle union,
// a list, and `on<Event>` callbacks — the same shape a component would get, which
// is what keeps the surface renderable and reviewable without a network.
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { CatalogueError, isCatalogueFailure } from '@model/errors';
import type { AccessTier, NavLink, Publication } from '@model/types';
import type { ContentFormat } from '@/shared/types/primitives';

import type { CatalogueSearchPipeline, SearchFilters } from './pipeline';
import { initialSearchState, searchReducer, type SearchStatus } from './searchState';

export interface UseCatalogueSearchOptions {
  // Entitlement scope for every request. A parameter, not module state — CAP-3
  // switches institutions at runtime.
  institutionId: string;
  // Injected rather than read from `src/config/search.ts` in here, so a test or a
  // gallery entry can drive this with latency, an injected failure, or a stub,
  // without touching a process-wide singleton.
  pipeline: CatalogueSearchPipeline;
}

export interface UseCatalogueSearch {
  /** What is in the field, uncommitted. */
  draft: string;
  /** What was actually searched for. */
  query: string;
  filters: SearchFilters;
  /** Lifecycle. `state`, not `status`, to match the component convention. */
  state: SearchStatus;
  publications: Publication[];
  /** Server-reported total across all pages, when it supplied one. */
  totalItems?: number;
  /** Where to go when there is nothing to show. */
  browseInstead: NavLink[];
  errorCode?: CatalogueError;
  /** Whether a further page exists AND the surface is settled enough to ask. */
  canLoadMore: boolean;
  onChangeQuery: (draft: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  /** `undefined` clears the dimension — "all", which sends no parameter. */
  onSelectContentType: (contentType: ContentFormat | undefined) => void;
  onSelectAccessTier: (accessTier: AccessTier | undefined) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function useCatalogueSearch({
  institutionId,
  pipeline,
}: UseCatalogueSearchOptions): UseCatalogueSearch {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);

  // The last request id actually sent. The effect below depends on the whole
  // state object, so it re-runs on every transition — including ones that change
  // nothing it cares about. This is what makes it idempotent: work is keyed on
  // the id, not on having been called.
  const issued = useRef(0);

  // Whether this hook is still on screen.
  //
  // NOT A PER-REQUEST CANCELLATION FLAG, which is the tempting version and the
  // wrong one: the request effect re-runs on every transition, so a flag flipped
  // in its cleanup would suppress a response that is still perfectly wanted. What
  // has to be caught is UNMOUNT — a reader leaving the tab mid-request, whose
  // answer then arrives to a screen that no longer exists. Declared before the
  // request effect so the two run in the right order.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    const { status, requestId } = state;

    if (status !== 'loading' && status !== 'paging') return;
    if (issued.current === requestId) return;
    issued.current = requestId;

    // PAGING FOLLOWS THE CURSOR; SEARCHING BUILDS A REQUEST. The two are not
    // interchangeable — a next page must not re-send the query, because the
    // server already encoded whatever context it wanted into `next`.
    const pending =
      status === 'paging' && state.next !== undefined
        ? pipeline.next(state.next)
        : pipeline.search({ institutionId, query: state.query, filters: state.filters });

    // Superseded responses need no abort — the reducer discards any outcome whose
    // id is no longer current, which is one rule covering every ordering.
    pending
      .then((feed) => {
        if (live.current) dispatch({ type: 'pageArrived', requestId, feed });
      })
      .catch((error: unknown) => {
        if (!live.current) return;
        dispatch({
          type: 'requestFailed',
          requestId,
          // A pipeline is contracted to reject with CatalogueFailure. Anything
          // else is a bug rather than a network condition, but the reader still
          // needs a state — and "something went wrong out there" is the least
          // wrong thing to say about an unclassified throw.
          code: isCatalogueFailure(error) ? error.code : CatalogueError.NETWORK_UNAVAILABLE,
        });
      });
  }, [state, institutionId, pipeline]);

  const onChangeQuery = useCallback(
    (draft: string) => dispatch({ type: 'draftChanged', draft }),
    [],
  );
  const onSubmit = useCallback(() => dispatch({ type: 'submitted' }), []);
  const onClear = useCallback(() => dispatch({ type: 'cleared' }), []);
  const onSelectContentType = useCallback(
    (contentType: ContentFormat | undefined) =>
      dispatch({ type: 'filterChanged', filters: { contentType } }),
    [],
  );
  const onSelectAccessTier = useCallback(
    (accessTier: AccessTier | undefined) =>
      dispatch({ type: 'filterChanged', filters: { accessTier } }),
    [],
  );
  const onLoadMore = useCallback(() => dispatch({ type: 'nextRequested' }), []);
  const onRetry = useCallback(() => dispatch({ type: 'retried' }), []);

  return {
    draft: state.draft,
    query: state.query,
    filters: state.filters,
    state: state.status,
    publications: state.publications,
    ...(state.totalItems !== undefined ? { totalItems: state.totalItems } : {}),
    browseInstead: state.browseInstead,
    ...(state.errorCode !== undefined ? { errorCode: state.errorCode } : {}),
    // Derived, never stored. A second copy of this fact would be one more thing
    // to keep in step with `next`.
    canLoadMore: state.status === 'results' && state.next !== undefined,
    onChangeQuery,
    onSubmit,
    onClear,
    onSelectContentType,
    onSelectAccessTier,
    onLoadMore,
    onRetry,
  };
}
