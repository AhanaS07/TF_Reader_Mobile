// Owner: Reader (Ahana).
//
// PORTED, per TTS_PROVIDER.md's own instruction: every applicable case from
// fakeReaderTextProvider.test.ts pins a property of the SEAM (never-reject, abort resolves rather
// than rejects, teardown starves in-flight requests, onInterrupted's subscriber semantics), not of
// the fake, so they survive the swap to the real provider unchanged in intent — only "how a sentence
// gets served" (Content-shape/segmentation cases) is gone, because that lives in `epubTtsResolver.ts`/
// `ttsSegmentation.ts` now (DOM-touching, exercised on-device per WEBVIEW_BRIDGE.md's own checklist,
// not here).
//
// This tests the HOST-SIDE CORRELATION LAYER — requestId bookkeeping, generation-on-terminate,
// abort/teardown racing a reply — against a harness that stubs `send` and manually drives
// `handleReply`, standing in for the WebView.

import { createEpubReaderTextProvider, type EpubReaderTextProvider } from './realReaderTextProvider';
import type { ReaderCommand } from '@/features/reader/readerBridge';
import type { TtsFetchResult, TtsSentence } from './readerTextProvider';

function sentence(overrides: Partial<TtsSentence> = {}): TtsSentence {
  return {
    text: 'A sentence.',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:11)',
    spineIndex: 0,
    sentenceIndex: 0,
    lastInSection: false,
    ...overrides,
  };
}

function createHarness(): { provider: EpubReaderTextProvider; sent: ReaderCommand[] } {
  const sent: ReaderCommand[] = [];
  const provider = createEpubReaderTextProvider('book-1', (command) => sent.push(command));
  return { provider, sent };
}

/** The requestId of the most recently sent `requestTtsSentence` command. */
function lastRequestId(sent: ReaderCommand[]): number {
  const requests = sent.filter(
    (command): command is Extract<ReaderCommand, { type: 'requestTtsSentence' }> =>
      command.type === 'requestTtsSentence',
  );
  const last = requests[requests.length - 1];
  if (!last) throw new Error('no requestTtsSentence command was sent');
  return last.request.requestId;
}

function replyOk(provider: EpubReaderTextProvider, requestId: number, ttsSentence: TtsSentence): void {
  provider.handleReply({ type: 'ttsSentence', requestId, result: { status: 'ok', sentence: ttsSentence } });
}

function reply(provider: EpubReaderTextProvider, requestId: number, result: TtsFetchResult): void {
  provider.handleReply({ type: 'ttsSentence', requestId, result });
}

describe('realReaderTextProvider — request/reply correlation', () => {
  it('sends requestTtsSentence and resolves current() from the matching reply', async () => {
    const { provider, sent } = createHarness();

    const pending = provider.current(null);
    expect(sent).toEqual([
      { type: 'requestTtsSentence', request: { requestId: expect.any(Number), from: null, mode: 'current' } },
    ]);

    replyOk(provider, lastRequestId(sent), sentence());
    await expect(pending).resolves.toEqual({ status: 'ok', sentence: sentence() });
  });

  it('sends next() with mode "next" and the given anchor', async () => {
    const { provider, sent } = createHarness();

    const pending = provider.next('epubcfi(/6/2!/4/2,/1:0,/1:11)');
    const [command] = sent;
    expect(command).toEqual({
      type: 'requestTtsSentence',
      request: { requestId: expect.any(Number), from: 'epubcfi(/6/2!/4/2,/1:0,/1:11)', mode: 'next' },
    });

    reply(provider, lastRequestId(sent), { status: 'endOfBook' });
    await expect(pending).resolves.toEqual({ status: 'endOfBook' });
  });

  it('gives overlapping in-flight requests distinct requestIds, resolved independently', async () => {
    const { provider, sent } = createHarness();

    const first = provider.current(null);
    const second = provider.next('epubcfi(/6/2!/4/2,/1:0,/1:11)');
    expect(sent).toHaveLength(2);

    const [firstId, secondId] = sent.map((command) => {
      if (command.type !== 'requestTtsSentence') throw new Error('unexpected command');
      return command.request.requestId;
    });
    expect(firstId).not.toBe(secondId);

    // Resolved out of send order, on purpose: correlation is by id, not by queue position.
    reply(provider, secondId, { status: 'endOfBook' });
    replyOk(provider, firstId, sentence({ sentenceIndex: 1 }));

    await expect(second).resolves.toEqual({ status: 'endOfBook' });
    await expect(first).resolves.toEqual({ status: 'ok', sentence: sentence({ sentenceIndex: 1 }) });
  });

  it('silently drops a reply for an unknown or already-settled requestId', async () => {
    const { provider, sent } = createHarness();

    const pending = provider.current(null);
    const requestId = lastRequestId(sent);

    expect(() => reply(provider, 9999, { status: 'endOfBook' })).not.toThrow();

    replyOk(provider, requestId, sentence());
    await expect(pending).resolves.toEqual({ status: 'ok', sentence: sentence() });

    // Second reply for the same, now-settled requestId: dropped, not a second resolve (the promise
    // already settled, so a re-resolve would be a no-op even if this threw — asserting it doesn't
    // throw is the property that matters here).
    expect(() => reply(provider, requestId, { status: 'endOfBook' })).not.toThrow();
  });
});

describe('realReaderTextProvider — cancellation', () => {
  it('resolves unavailable instead of rejecting when the signal is already aborted', async () => {
    const { provider, sent } = createHarness();
    const controller = new AbortController();
    controller.abort();

    await expect(provider.current(null, controller.signal)).resolves.toEqual({ status: 'unavailable' });
    expect(sent).toEqual([]); // never even sent — nothing to correlate a reply against
  });

  it('resolves unavailable when aborted mid-flight, and never rejects', async () => {
    const { provider, sent } = createHarness();
    const controller = new AbortController();

    const pending = provider.next('epubcfi(/6/2!/4/2,/1:0,/1:11)', controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({ status: 'unavailable' });

    // A reply that arrives after the abort is dropped rather than erroring — the abort listener
    // already removed this requestId from the pending map.
    expect(() => reply(provider, lastRequestId(sent), { status: 'endOfBook' })).not.toThrow();
  });
});

describe('realReaderTextProvider — interruption and teardown', () => {
  it('starves an in-flight request when notifyClosed arrives before the reply', async () => {
    const { provider } = createHarness();

    // THE ONE THAT MATTERS FOR DATA MINIMISATION: a fetch issued before teardown must not deliver
    // text after it — enforced here by the generation bump discarding the pending resolver itself,
    // no reply from the WebView required.
    const pending = provider.current(null);
    provider.notifyClosed();

    await expect(pending).resolves.toEqual({ status: 'unavailable' });
  });

  it('is terminal after notifyClosed — every later call resolves unavailable without sending', async () => {
    const { provider, sent } = createHarness();
    provider.notifyClosed();

    await expect(provider.current(null)).resolves.toEqual({ status: 'unavailable' });
    await expect(provider.next('epubcfi(/6/2!/4/2,/1:0,/1:11)')).resolves.toEqual({
      status: 'unavailable',
    });
    expect(sent).toEqual([]); // never sends into a torn-down WebView
  });

  it('a reply arriving after notifyClosed is dropped, not double-resolved', async () => {
    const { provider, sent } = createHarness();
    const pending = provider.current(null);
    const requestId = lastRequestId(sent);

    provider.notifyClosed();
    await expect(pending).resolves.toEqual({ status: 'unavailable' });

    expect(() => replyOk(provider, requestId, sentence())).not.toThrow();
  });

  it('setSpokenRange is a no-op after notifyClosed, without throwing', () => {
    const { provider, sent } = createHarness();
    provider.notifyClosed();

    expect(() => provider.setSpokenRange('epubcfi(/6/2!/4/2,/1:0,/1:11)')).not.toThrow();
    expect(sent).toEqual([]);
  });

  it('sees unavailable from inside the interruption handler', async () => {
    const { provider } = createHarness();
    let fromHandler: string | null = null;

    provider.onInterrupted(() => {
      void provider.current(null).then((result) => {
        fromHandler = result.status;
      });
    });

    provider.notifyClosed();
    await Promise.resolve();

    // generation is bumped BEFORE handlers fire, so a handler that reacts by fetching gets what it
    // would get in production rather than one last sentence.
    expect(fromHandler).toBe('unavailable');
  });

  it('is idempotent — a second notifyClosed fires nothing', () => {
    const { provider } = createHarness();
    const seen: string[] = [];
    provider.onInterrupted((reason) => seen.push(reason));

    provider.notifyClosed();
    provider.notifyClosed();

    expect(seen).toEqual(['closed']);
  });

  it('stops delivering to an unsubscribed handler', () => {
    const { provider } = createHarness();
    const seen: string[] = [];
    const unsubscribe = provider.onInterrupted((reason) => seen.push(reason));

    provider.notifyRelocated();
    unsubscribe();
    provider.notifyClosed();

    expect(seen).toEqual(['navigated']);
  });

  it('still notifies the other subscribers when one throws', () => {
    const { provider } = createHarness();
    const seen: string[] = [];

    provider.onInterrupted(() => {
      throw new Error('subscriber bug');
    });
    provider.onInterrupted((reason) => seen.push(reason));

    expect(() => provider.notifyClosed()).not.toThrow();
    expect(seen).toEqual(['closed']);
  });
});

describe('realReaderTextProvider — navigated is not a teardown', () => {
  it('keeps serving after notifyRelocated, without bumping generation', async () => {
    const { provider, sent } = createHarness();
    const seen: string[] = [];
    provider.onInterrupted((reason) => seen.push(reason));

    // A request issued just before the navigation signal still resolves normally when its reply
    // arrives — this is the property that makes `generation` unchanged, not a stale-drop, correct.
    const pending = provider.current(null);
    provider.notifyRelocated();

    expect(seen).toEqual(['navigated']);
    replyOk(provider, lastRequestId(sent), sentence());
    await expect(pending).resolves.toEqual({ status: 'ok', sentence: sentence() });
  });

  it('clears the highlight by sending setSpokenRange(null)', () => {
    const { provider, sent } = createHarness();

    provider.notifyRelocated();

    expect(sent).toEqual([{ type: 'setSpokenRange', cfi: null }]);
  });
});

describe('realReaderTextProvider — highlighting', () => {
  it('sends setSpokenRange with the given cfi, and again with null to clear', () => {
    const { provider, sent } = createHarness();

    provider.setSpokenRange('epubcfi(/6/2!/4/2,/1:0,/1:11)');
    provider.setSpokenRange(null);

    expect(sent).toEqual([
      { type: 'setSpokenRange', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:11)' },
      { type: 'setSpokenRange', cfi: null },
    ]);
  });
});
