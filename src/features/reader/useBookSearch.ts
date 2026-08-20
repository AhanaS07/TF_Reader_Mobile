// Owner: Reader (Ahana).
//
// The async half of in-book search: everything between the user pressing "Search"
// and a list of hits existing. Split out of ReaderScreen because this is ~100 lines
// of race handling, and race handling that lives inside a 650-line component is
// race handling nobody re-reads.
//
// Search itself (`queryBookIndex`, owned by Vaishnavi) is a single async call. What
// this adds around it is the three things that call does NOT do: it takes no
// AbortSignal, it caches nothing, and it can throw. See the notes on each below.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderTarget } from '@/features/reader/readerBridge';

import { queryBookIndex } from '@/features/search/queryBookIndex';
import { ContentFailure } from '@/shared/contracts';
import type { BookId, SearchHit } from '@/shared/contracts';

/**
 * ONE ENUM, not `isLoading` + `hasSearched` booleans. The empty result has to say
 * something different before the first search ("type a word") than after one ("no
 * matches for X"), and two booleans model that as four states of which two are
 * unreachable — which is how the unreachable ones end up rendered.
 */
export type SearchStatus = 'idle' | 'searching' | 'done' | 'failed';

export interface BookSearch {
  query: string;
  setQuery: (next: string) => void;
  /** Runs the query for the current `query`. Synchronous by design — see `submit`. */
  submit: () => void;
  clear: () => void;
  status: SearchStatus;
  hits: readonly SearchHit[];
  /** The term `hits` are for. NOT `query` — see the note in `submit`. */
  submittedTerm: string;
  failure: string | null;
  /** Index into `hits`, or -1 when a search has run but nothing is selected yet. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
}

/**
 * The bare CFI `goTo` takes, or null when this hit is not addressable by this reader.
 *
 * THE UNWRAP HAPPENS HERE AND NOWHERE ELSE. The bridge command carries a bare string;
 * handing it `SearchHit.locator` — a frozen contract type, and a discriminated union
 * at that — would put a shared contract inside untypechecked WebView JS. That is
 * trigger 3 in WEBVIEW_BRIDGE.md, and tripping it makes converting the WebView to a
 * typechecked build the task rather than a follow-up. Keeping the union on this side
 * of the boundary is the whole reason search needed no bridge change.
 *
 * PDF hits return null rather than throwing: `Locator` covers both formats because
 * Search indexes both, but this reader is epub.js and has nowhere to send a page
 * number. Callers list such a hit and disable it — see SearchPanel.
 */
export function cfiOf(hit: SearchHit): string | null {
  return hit.locator.type === 'EPUB' ? hit.locator.cfi : null;
}

/**
 * A hit's location as something the reader can navigate to.
 *
 * >>> THIS IS WHAT `cfiOf` COULD NOT DO, AND WHY PDF HITS USED TO BE DEAD ROWS. <<<
 * `cfiOf` unwraps `locator.cfi`, which only an EPUB locator has, so it returned null for every PDF
 * hit and the reader had nowhere to send it. That was never a decision about whether a PDF result
 * should be navigable — it was a limitation of `goTo` taking a bare string, since a page number and a
 * spine href could not be told apart in one. `ReaderTarget` is discriminated, so both fit.
 *
 * `Locator` is the FROZEN contract and `ReaderTarget` is bridge-local: this function is the seam
 * between them, and it is the only place `locator.type` is read for navigation. That is deliberate —
 * the frozen union must not travel to the WebView, so it is unwrapped exactly once, here.
 *
 * Returns null only for a locator shape the reader has no renderer for, which is unreachable today.
 */
export function targetOf(hit: SearchHit): ReaderTarget | null {
  const locator = hit.locator;
  if (locator.type === 'EPUB') return { kind: 'href', href: locator.cfi };
  if (locator.type === 'PDF') return { kind: 'page', page: locator.page };
  return null;
}

/**
 * A stable key for a hit, for React's list reconciliation.
 *
 * Composed with the index at the call site for the reason the Contents list already
 * documents: strings that come out of a real book are not unique. `chapterId` repeats
 * by design (many hits per chapter), so it cannot be identity on its own.
 */
export function locatorKey(hit: SearchHit): string {
  return hit.locator.type === 'EPUB' ? hit.locator.cfi : `p${hit.locator.page}:${hit.locator.offset ?? 0}`;
}

/**
 * Whether stepping `delta` from `activeIndex` would reach a hit this reader can open.
 *
 * Shared by the stepper's disabled state and the step itself, so the arrow cannot be
 * enabled for a move that then does nothing (or vice versa) — the two would drift the
 * moment one learned about PDF hits and the other did not.
 */
export function hasNavigableFrom(
  hits: readonly SearchHit[],
  activeIndex: number,
  delta: 1 | -1,
): boolean {
  const from = activeIndex < 0 ? (delta === 1 ? 0 : hits.length - 1) : activeIndex + delta;
  for (let i = from; i >= 0 && i < hits.length; i += delta) {
    if (cfiOf(hits[i]) !== null) return true;
  }
  return false;
}

/**
 * Turn a thrown query into something worth putting on screen.
 *
 * ContentFailure carries a typed code (INTEGRITY_FAILED / LICENCE_EXPIRED /
 * KEYSTORE_UNAVAILABLE) that a bare `.message` throws away, and "the licence expired"
 * is a different conversation from "the index is corrupt".
 *
 * The raw message is shown deliberately at this stage rather than mapped to friendly
 * copy: queryBookIndex's own throws name the wiring bug ("failed to decode search
 * index for <id>", "does not match requested"), and this is a dev-facing app today.
 */
function describeSearchFailure(cause: unknown): string {
  if (cause instanceof ContentFailure) {
    return `${cause.code}. (${String(cause.cause ?? cause.message)})`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export function useBookSearch(bookId: BookId): BookSearch {
  const [query, setQuery] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Monotonic id of the most recent request anyone is allowed to write from.
   *
   * THE PROBLEM IT SOLVES: `queryBookIndex` takes no AbortSignal, and its cost is
   * dominated by a full `JSON.parse` of the book's index. So a slow first search can
   * still be parsing when a second, narrower one has already finished — and land
   * afterwards, replacing the results the user is looking at with stale ones.
   *
   * Nothing here can cancel the work. The only thing under our control is who is
   * allowed to WRITE, which is what this gates.
   */
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Set on mount as well as cleared on unmount. A remount of the same fibre (React
    // StrictMode double-invokes effects in dev) must not leave this stuck false and
    // silently swallow every result from then on.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = useCallback((): void => {
    requestSeqRef.current += 1; // invalidates anything already in flight
    setHits([]);
    setActiveIndex(-1);
    setFailure(null);
    setStatus('idle');
  }, []);

  /*
    THIS HOOK ASSUMES `bookId` IS FIXED FOR ITS LIFETIME, and there is deliberately no
    reset-on-change path. Changing it in place would leave one book's hits offering to
    navigate inside another — the state above would survive while the content under it
    did not.

    That is safe today because ReaderScreen is mounted per book. The way to keep it
    safe when RootNavigator lands is to remount rather than re-prop:

        <ReaderScreen key={bookId} bookId={bookId} />

    which is React's own answer to "reset all state when a prop changes" and is why no
    reset logic belongs here. Both alternatives were tried and are worse: an effect
    renders the stale results once before clearing them (and trips
    react-hooks/set-state-in-effect), and the render-phase ref comparison trips
    react-hooks/refs. A `key` costs one line at the call site and cannot be got wrong.
  */

  const clear = useCallback((): void => {
    setQuery('');
    setSubmittedTerm('');
    reset();
  }, [reset]);

  const submit = useCallback((): void => {
    const term = query.trim();

    // Don't spend a whole-index re-parse to be told []. Search's tokenizer strips
    // everything non-alphanumeric, so a blank or punctuation-only term has no tokens
    // and the answer is already knowable here.
    if (term === '') {
      setSubmittedTerm('');
      reset();
      return;
    }

    const seq = ++requestSeqRef.current;
    setStatus('searching');
    setFailure(null);
    // Set NOW, not on resolve: the empty-state copy interpolates submittedTerm, and
    // interpolating `query` instead would rewrite "No matches for X" under the user
    // as they type the next search.
    setSubmittedTerm(term);

    // `void` + an inner async IIFE rather than making submit itself async: submit is
    // handed straight to onPress/onSubmitEditing, and an async function passed where a
    // void-returning one is expected is a no-misused-promises error in this directory.
    // The rejection is handled below, so this promise is handled, not dropped.
    void (async () => {
      try {
        // Raw text, deliberately not cleaned up first. Search's termTokens already
        // lowercases, strips punctuation and splits multi-word queries; normalising
        // here as well would just be a second, divergent implementation of that.
        const found = await queryBookIndex(bookId, term);

        // `!==`, not `<`. An equal seq IS this request; anything else lost the race
        // and must drop its result rather than overwrite fresher hits.
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        setHits(found);
        setActiveIndex(-1);
        setStatus('done');
      } catch (cause) {
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        setHits([]);
        setActiveIndex(-1);
        setFailure(describeSearchFailure(cause));
        setStatus('failed');
      }
    })();
  }, [bookId, query, reset]);

  return {
    query,
    setQuery,
    submit,
    clear,
    status,
    hits,
    submittedTerm,
    failure,
    activeIndex,
    setActiveIndex,
  };
}
