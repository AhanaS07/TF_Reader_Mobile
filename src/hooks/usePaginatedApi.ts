// A reusable fetch-and-paginate hook, generalized over whatever async api
// function you have (same shape as searchInstitutions: `(params) => Promise<T[]>`).
// Handles query debouncing, page-0 vs loadMore, and an optional offline-cache
// fallback for page 0 — the same behavior InstitutionListScreen's fetchPage
// implements inline, pulled out here so other screens can reuse it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetworkStatus } from '@hooks/useNetworkStatus';

export interface UsePaginatedApiOptions<T> {
  fetchFn: (params: { q?: string; page: number; size: number }) => Promise<T[]>;
  pageSize?: number;
  debounceMs?: number;
  getCached?: () => T[];
  setCached?: (items: T[]) => void;
  matchesQuery?: (item: T, query: string) => boolean;
}

export interface UsePaginatedApi<T> {
  query: string;
  setQuery: (q: string) => void;
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  fetchError: boolean;
  error: unknown;
  hasMore: boolean;
  page: number;
  loadMore: () => void;
  retry: () => void;
}

// `<T>` is a deliberate, narrow exception to the "no generics" rule in
// CLAUDE.md — this hook is only useful if it can be reused across different
// item shapes (institutions, publications, ...). It is a single type
// parameter, not the mapped/conditional-type kind of gymnastics that rule
// targets.
export function usePaginatedApi<T>({
  fetchFn,
  pageSize = 20,
  debounceMs = 300,
  getCached,
  setCached,
  matchesQuery,
}: UsePaginatedApiOptions<T>): UsePaginatedApi<T> {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const isOnline = useNetworkStatus();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    (q: string, pageNum: number, replace: boolean) => {
      // Clear any previous error before deciding whether to fetch or serve
      // cache, same reasoning as InstitutionListScreen.fetchPage: this must
      // sit above the offline branch so going offline after a failed online
      // attempt clears the error and shows the cache instead of staying on
      // an error state.
      if (replace) {
        setFetchError(false);
        setError(undefined);
      }

      if (!isOnline) {
        setHasMore(false);
        setPage(0);
        setLoading(false);
        setLoadingMore(false);
        if (!replace) return;

        const cached = getCached ? getCached() : [];
        if (cached.length > 0) {
          setItems(
            q.length > 0 && matchesQuery
              ? cached.filter((item) => matchesQuery(item, q))
              : cached,
          );
        } else {
          setFetchError(true);
        }
        return;
      }

      if (replace) { setLoading(true); } else { setLoadingMore(true); }
      fetchFn({ ...(q.length > 0 ? { q } : {}), page: pageNum, size: pageSize })
        .then((results) => {
          setItems((prev) => (replace ? results : [...prev, ...results]));
          setHasMore(results.length === pageSize);
          setPage(pageNum);
          // Cache only the first page of the unfiltered list — that is the
          // list the offline path serves.
          if (pageNum === 0 && q.length === 0 && setCached) setCached(results);
        })
        .catch((err: unknown) => {
          // Mid-flight disconnect: prefer the cache over an error on initial load.
          const cached = getCached ? getCached() : [];
          if (replace && cached.length > 0) {
            setItems(cached);
            setHasMore(false);
          } else {
            setError(err);
            setFetchError(true);
          }
        })
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [fetchFn, pageSize, isOnline, getCached, setCached, matchesQuery],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchPage(query, 0, true), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, fetchPage, debounceMs]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    fetchPage(query, page + 1, false);
  }, [hasMore, loadingMore, loading, query, page, fetchPage]);

  const retry = useCallback(() => {
    fetchPage(query, 0, true);
  }, [fetchPage, query]);

  return {
    query,
    setQuery,
    items,
    loading,
    loadingMore,
    fetchError,
    error,
    hasMore,
    page,
    loadMore,
    retry,
  };
}
