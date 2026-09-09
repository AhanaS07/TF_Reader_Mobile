// Owner: Reader (Ahana). Consumed by Accessibility (Hruthik) — but only through ReaderTextProvider.
// `handleReply`/`notifyRelocated`/`notifyClosed` are Reader-internal and are called only from
// ReaderScreen.tsx, which owns the bridge and the book's lifecycle; they are not part of the
// Accessibility-facing contract (see EpubReaderTextProvider's own note).
//
// The host-side half of TTS_PROVIDER.md's step 5: correlates `requestTtsSentence`/`ttsSentence`
// across the bridge (the FIRST request/reply pair on it — see WEBVIEW_BRIDGE.md), and turns
// `ReaderScreen`'s lifecycle signals into the `onInterrupted` reasons this interface promises.
//
// >>> WHY (bookId, generation) NEVER CROSSES THE WIRE. <<< readerTextProvider.ts's own doc comments
// describe a `(bookId, generation)` stamp that drops stale replies — that protects against a request
// issued against book A still being in flight when the SAME WebView switches to book B (ReaderScreen
// can reuse one WebView across a book switch; epub.entry.ts's module state just gets reset by the
// next `openEpub`). This is fully achieved HOST-SIDE, without the WebView knowing about generations:
//
//   - Each open book gets its OWN provider instance (ReaderScreen constructs one per `bookId`), with
//     its own private `pending` map — so `requestId` alone disambiguates within an instance; nothing
//     needs to disambiguate ACROSS instances because they never share state.
//   - `requestId` is a monotonic counter, unique for this instance's lifetime.
//   - `generation` is bumped, and every pending request force-resolved, on `terminate()` — so a reply
//     arriving after teardown finds nothing in `pending` and is silently dropped.
//
// So the wire payload stays minimal (`requestId` only, per readerBridge.ts), and `bookId` here is
// captured for diagnostics only — this file does not send it anywhere.

import type { ReaderCommand, ReaderMessage, TtsFetchMode } from '@/features/reader/readerBridge';
import type { BookId } from '@/shared/contracts';

import type {
  ReaderTextProvider,
  SpokenWordRange,
  TtsFetchResult,
  TtsInterruption,
} from './readerTextProvider';

type TtsSentenceMessage = Extract<ReaderMessage, { type: 'ttsSentence' }>;

/**
 * What `ReaderScreen.tsx` gets beyond the public `ReaderTextProvider` surface Accessibility codes
 * against — the same split `testReaderTextProvider.ts`'s test-only handles use, and for the same
 * reason: nothing outside Reader should be able to reach these, so a caller typed as plain
 * `ReaderTextProvider` cannot.
 */
export interface EpubReaderTextProvider extends ReaderTextProvider {
  /** Route a `ttsSentence` bridge reply to whichever `current`/`next` call is waiting on it. */
  handleReply(message: TtsSentenceMessage): void;
  /**
   * Every real `relocated` message is a navigation signal (epub.js never fires it for
   * `setSpokenRange`, which only touches annotations) — call this from `ReaderScreen`'s
   * `handleMessage` whenever one arrives with a CFI position. NOT a teardown: `generation` is
   * unchanged, so a request already in flight still resolves normally when its reply lands.
   */
  notifyRelocated(): void;
  /** Call from the SAME cleanup that calls `closeBook(bookId)`, immediately before it — see
   * `readerTextProvider.ts`'s note on why lifetime belongs to whoever owns the book. */
  notifyClosed(): void;
}

const UNAVAILABLE: TtsFetchResult = { status: 'unavailable' };

interface PendingRequest {
  resolve: (result: TtsFetchResult) => void;
  generation: number;
}

export function createEpubReaderTextProvider(
  bookId: BookId,
  send: (command: ReaderCommand) => void,
): EpubReaderTextProvider {
  void bookId; // captured for diagnostics only — see this file's header note.

  let generation = 0;
  let terminated = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  const handlers = new Set<(reason: TtsInterruption) => void>();

  function fire(reason: TtsInterruption): void {
    // Iterate a copy: a one-shot handler that unsubscribes itself during dispatch would otherwise
    // mutate `handlers` mid-iteration — same reasoning as the test double's `fire`.
    for (const handler of [...handlers]) {
      try {
        handler(reason);
      } catch {
        // Swallowed, per onInterrupted's own contract: this fires from a React effect cleanup, and
        // one subscriber's bug must not be able to stop the book being torn down.
      }
    }
  }

  function terminate(reason: 'closed' | 'revoked'): void {
    if (terminated) return; // idempotent, like ContentStore.close()
    terminated = true;
    generation += 1;
    for (const { resolve } of pending.values()) resolve(UNAVAILABLE);
    pending.clear();
    fire(reason);
  }

  function request(
    from: string | null,
    mode: TtsFetchMode,
    signal?: AbortSignal,
  ): Promise<TtsFetchResult> {
    if (terminated) return Promise.resolve(UNAVAILABLE);
    if (signal?.aborted === true) return Promise.resolve(UNAVAILABLE);

    const requestId = nextRequestId++;
    const requestGeneration = generation;

    return new Promise<TtsFetchResult>((resolve) => {
      const settle = (result: TtsFetchResult): void => {
        pending.delete(requestId);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => settle(UNAVAILABLE);

      pending.set(requestId, { resolve: settle, generation: requestGeneration });
      signal?.addEventListener('abort', onAbort, { once: true });
      send({ type: 'requestTtsSentence', request: { requestId, from, mode } });
    });
  }

  function setSpokenRange(cfi: string | null): void {
    // Fire-and-forget and best-effort, per the interface's own contract — never throws, never
    // reports failure. Silently no-op after teardown rather than sending into a torn-down WebView.
    if (terminated) return;
    send({ type: 'setSpokenRange', cfi });
  }

  function setSpokenWordRange(range: SpokenWordRange | null): void {
    // Same contract, same guard, same reasons as `setSpokenRange` above. Nothing is validated here
    // — not the CFI, not the offsets: whether they resolve is a question only the live document can
    // answer, and the shell answers it silently (clearing the previous word either way). Checking
    // here would be guessing, and a wrong guess would drop a paintable range.
    if (terminated) return;
    send({ type: 'setSpokenWordRange', range });
  }

  return {
    current: (from, signal) => request(from, 'current', signal),
    next: (after, signal) => request(after, 'next', signal),
    setSpokenRange,
    setSpokenWordRange,

    onInterrupted(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    handleReply({ requestId, result }) {
      const entry = pending.get(requestId);
      // Already settled (abort raced the reply, or teardown force-resolved it), or — belt and
      // braces — from a generation this instance has moved past: either way, nowhere to route it.
      if (!entry || entry.generation !== generation) {
        pending.delete(requestId);
        return;
      }
      entry.resolve(result);
    },

    notifyRelocated() {
      if (terminated) return;
      // ONE CALL CLEARS BOTH SPOKEN LAYERS. The word range is a sub-range of the sentence, so the
      // shell drops it whenever the sentence changes or clears (`setSpokenRange`'s handler in
      // epub.entry.ts). Sending a second `setSpokenWordRange(null)` here would be a no-op that
      // implies the two can be cleared independently, which is exactly what must not be assumed.
      setSpokenRange(null);
      fire('navigated');
    },

    notifyClosed() {
      terminate('closed');
    },
  };
}
