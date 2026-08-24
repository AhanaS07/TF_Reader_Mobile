// Owner: Download (Abhinav).
//
// Wraps downloadBook()'s onProgress callback (downloadManager.ts's DownloadOptions, itself
// forwarded from chunkedAssetFetcher.ts) in React state for a UI consumer.
//
// One-shot per start() call, not a persistent subscription like useTtsSession — there is nothing
// to listen to before start() is called and nothing left running once downloadBook() settles. A
// generation counter still guards against a superseded start() (a second call before the first
// settles) landing after a later call already owns the state, and a `torn` flag guards against
// any of it landing after unmount — the same two hazards useTtsSession's effect guards against,
// just without needing an effect at all here since there's no external subscription to hold open.
//
// Percent is deliberately NOT part of this state — it's `expectedLength ? bytesReceived /
// expectedLength : null`, one derivation, computed by whoever renders it, so there's a single
// source of truth for the byte counts and no risk of the two drifting apart.
//
// KNOWN GAP, not closed here: the generation counter stops a superseded call's callbacks from
// touching state, it does NOT cancel the superseded downloadBook() call itself — there is no
// AbortController threaded from this hook down through downloadManager.ts/
// chunkedAssetFetcher.ts's own per-chunk AbortControllers. A start() for book B while book A's
// download is still in flight lets A keep running to completion in the background (still
// writing to contentStore/downloadTable, consuming a real book-limit slot) with no UI trace.
// Callers MUST prevent overlapping start() calls themselves until this is closed — see
// `src/navigation/BookListScreen.tsx`'s disabled-while-downloading guard on each fixture row's own
// Download button (one `useDownloadProgress()` instance per row, so this only prevents overlap
// WITHIN a single row's own start() calls, not across rows — moved here from App.tsx's single
// button when RootNavigator replaced its picker).

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookId, ContentFormat } from '@/shared/contracts';

import { downloadBook } from './downloadManager';
import { DownloadFailure } from './errors';

export type DownloadProgressStatus = 'idle' | 'downloading' | 'completed' | 'error';

export interface DownloadProgressState {
  status: DownloadProgressStatus;
  bytesReceived: number;
  /** Null until the fetcher learns the asset's total length (first chunk, or immediately on a
   * resume) — see chunkedAssetFetcher.ts. */
  expectedLength: number | null;
  errorMessage: string | null;
}

export interface UseDownloadProgress extends DownloadProgressState {
  start: (bookId: BookId, format?: ContentFormat) => void;
}

const IDLE_STATE: DownloadProgressState = {
  status: 'idle',
  bytesReceived: 0,
  expectedLength: null,
  errorMessage: null,
};

function describeFailure(cause: unknown): string {
  if (cause instanceof DownloadFailure) {
    return `${cause.code}${cause.cause ? ` (${String(cause.cause)})` : ''}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export function useDownloadProgress(): UseDownloadProgress {
  const [state, setState] = useState<DownloadProgressState>(IDLE_STATE);

  const tornRef = useRef(false);
  // Bumped on every start() — a callback or resolution from a superseded call checks this before
  // touching state, so an earlier, still-in-flight downloadBook() can't clobber a later one's
  // progress after this hook has already moved on.
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      tornRef.current = true;
    };
  }, []);

  const start = useCallback((bookId: BookId, format: ContentFormat = 'EPUB') => {
    const myGeneration = ++generationRef.current;
    const isCurrent = (): boolean => !tornRef.current && generationRef.current === myGeneration;

    setState({ status: 'downloading', bytesReceived: 0, expectedLength: null, errorMessage: null });

    void downloadBook(bookId, format, {
      onProgress: (bytesReceived, expectedLength) => {
        if (!isCurrent()) return;
        setState((prev) => ({ ...prev, bytesReceived, expectedLength }));
      },
    })
      .then(() => {
        if (!isCurrent()) return;
        setState((prev) => ({ ...prev, status: 'completed' }));
      })
      .catch((cause: unknown) => {
        if (!isCurrent()) return;
        setState((prev) => ({ ...prev, status: 'error', errorMessage: describeFailure(cause) }));
      });
  }, []);

  return { ...state, start };
}
