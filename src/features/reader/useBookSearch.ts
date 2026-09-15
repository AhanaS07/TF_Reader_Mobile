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

import { getIndex } from '@/features/encryption/contentProvider';
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
  /**
   * The last search came back empty BECAUSE THIS BOOK SHIPS NO SEARCH INDEX, not because the word
   * is absent. Only ever true alongside `status === 'done'` and no hits.
   *
   * >>> THE TWO EMPTY ANSWERS ARE DIFFERENT ANSWERS, AND CONFLATING THEM COSTS HOURS. <<<
   * `queryBookIndex` returns `[]` for both (`queryBookIndex.ts`'s own note calls that deliberate),
   * so the panel could only ever say "no matches" — which for an unindexed book asserts something
   * false about the text and sends the reader looking for a word that was never searched for.
   * `SearchPanel` already carried a comment admitting the copy "would sometimes be a lie"; this is
   * what stops it being one.
   *
   * Reachable today: both `Big EPUB` and `Big PDF` are seeded with `searchIndex: null`, and a book
   * stored by an older `SEED_VERSION` has no `.index.bin` either.
   */
  indexMissing: boolean;
}

/**
 * Whether this book has an index at all — asked ONLY after an empty result, never on open.
 *
 * `queryBookIndex` already fetched it and threw the answer away, and asking again is nearly free:
 * `getIndex` re-enters the same bookId-keyed session, where the decrypted bytes are cached
 * (`decryptSearchIndex`'s `indexPlaintext`) and the missing case never decrypts anything.
 *
 * TRUE ON ERROR, deliberately. This flag exists to explain an empty list, and only "definitely no
 * index" is worth saying. Anything that throws here has already surfaced through `queryBookIndex` as
 * a real failure, and guessing "no index" on top of it would replace a precise error with a vaguer
 * one.
 */
async function bookHasIndex(bookId: BookId): Promise<boolean> {
  try {
    return (await getIndex(bookId)) !== null;
  } catch {
    return true;
  }
}

/**
 * A hit's location as something the reader can navigate to — and the ONLY function that should
 * ever be used to decide whether a hit is navigable. An earlier unwrap only handled the EPUB case
 * (returning null for every PDF locator, since only EPUB has a `.cfi`) and PDF hits were dead rows
 * as a result — not a decision that PDF results shouldn't be navigable, just a limitation of `goTo`
 * taking a bare string, since a page number and a spine href could not be told apart in one.
 * `ReaderTarget` is discriminated, so both fit. That EPUB-only unwrap is gone now; do not recreate
 * it under a new name — see `hasNavigableFrom`'s note for how a second one survived past it.
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
  const locator = hit.locator;
  if (locator.type === 'EPUB') return locator.cfi;
  if (locator.type === 'PDF') return `p${locator.page}:${locator.offset ?? 0}`;
  // AUDIO is unreachable here today - BookSearchIndex.format never includes it (nothing is
  // indexed, so no SearchHit ever carries one) - but the key still has to be total.
  return `a${locator.positionMs}`;
}

/**
 * Whether stepping `delta` from `activeIndex` would reach a hit this reader can open.
 *
 * Shared by the stepper's disabled state and the step itself (`ReaderScreen.tsx`'s `stepHit`), so
 * the arrow cannot be enabled for a move that then does nothing (or vice versa) — the two would
 * drift the moment one learned about PDF hits and the other did not.
 *
 * THIS ALREADY HAPPENED ONCE. This used to check an EPUB-only unwrap (an earlier, narrower version
 * of what `targetOf` now is) that returned null for every PDF locator. `SearchPanel`'s row-disabling
 * and `stepHit` were both moved onto the general `targetOf` when PDF hits became navigable; this
 * call site was missed. The bug was invisible in a mixed EPUB+PDF hit list (a loop over several hits
 * still finds an EPUB one and returns true) and total in an all-PDF book: every hit failed the
 * EPUB-only check, so the match bar's arrows were permanently disabled there — exactly the report
 * that found this. Use `targetOf` for any "can this reader open it" check; do not reintroduce a
 * format-specific unwrap for navigability under a new name.
 */
export function hasNavigableFrom(
  hits: readonly SearchHit[],
  activeIndex: number,
  delta: 1 | -1,
): boolean {
  const from = activeIndex < 0 ? (delta === 1 ? 0 : hits.length - 1) : activeIndex + delta;
  for (let i = from; i >= 0 && i < hits.length; i += delta) {
    if (targetOf(hits[i]) !== null) return true;
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
  const [indexMissing, setIndexMissing] = useState(false);

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
    setIndexMissing(false);
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

        // Only when the answer was empty: a hit proves the index exists, and the check costs a
        // session round-trip that a successful search has no reason to pay. Re-guarded on `seq`
        // because this awaits again — a newer search may have landed in between, and its own
        // answer must not be overwritten by this one's footnote.
        if (found.length === 0) {
          const present = await bookHasIndex(bookId);
          if (!mountedRef.current || seq !== requestSeqRef.current) return;
          setIndexMissing(!present);
        } else {
          setIndexMissing(false);
        }
      } catch (cause) {
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        setHits([]);
        setActiveIndex(-1);
        setFailure(describeSearchFailure(cause));
        // A thrown search says nothing about whether an index exists, and the failure box explains
        // itself — leaving this set from a previous search would stack two contradictory reasons.
        setIndexMissing(false);
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
    indexMissing,
  };
}
