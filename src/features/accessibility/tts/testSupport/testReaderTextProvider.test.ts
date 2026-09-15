// Owner: Accessibility (Hruthik).
//
// Forked from Reader's original `src/features/reader/tts/fakeReaderTextProvider.test.ts` on
// 2026-08-28 (that original is deleted, 2026-09-09) — see `testReaderTextProvider.ts`'s header
// in this folder for why. Renamed from `fakeReaderTextProvider.test.ts` in the same change that
// renamed the file it tests.
//
// These are NOT tests of the test double for its own sake. Each one pins a property of the seam
// that `useTtsSession` is entitled to rely on against any `ReaderTextProvider`, real or test.

import { createTestReaderTextProvider, DEFAULT_TEST_BOOK } from './testReaderTextProvider';
import type { TtsSentence } from '@/features/reader/tts/readerTextProvider';
import { TTS_MAX_SENTENCE_CHARS } from '@/features/reader/tts/readerTextProvider';

/** Narrow an `ok` result, failing the test rather than returning undefined. */
function expectOk(result: { status: string }): TtsSentence {
  expect(result.status).toBe('ok');
  // Checked immediately above; the cast is what keeps every call site from re-narrowing.
  return (result as { status: 'ok'; sentence: TtsSentence }).sentence;
}

describe('testReaderTextProvider — content shape', () => {
  it('skips a spine item with nothing speakable, leaving spineIndex non-contiguous', () => {
    const provider = createTestReaderTextProvider();
    const spineIndices = [...new Set(provider.sentences.map((s) => s.spineIndex))];

    // DEFAULT_TEST_BOOK's index 1 is empty. It must not appear at all — that is the
    // "empty chapters are invisible to the caller" guarantee, not a status code.
    expect(spineIndices).toEqual([0, 2, 3]);
    expect(DEFAULT_TEST_BOOK[1]).toHaveLength(0);
  });

  it('caps every emitted sentence, splitting an unpunctuated run on a word boundary', () => {
    const provider = createTestReaderTextProvider();

    for (const sentence of provider.sentences) {
      expect(sentence.text.length).toBeLessThanOrEqual(TTS_MAX_SENTENCE_CHARS);
      expect(sentence.text).not.toMatch(/^\s|\s$/);
    }

    // Section 2 lists two strings but yields more, because the second is split. A caller
    // that assumed one sentence per source string would be wrong here and on a real book.
    const inSectionTwo = provider.sentences.filter((s) => s.spineIndex === 2);
    expect(inSectionTwo.length).toBeGreaterThan(DEFAULT_TEST_BOOK[2].length);
  });

  it('marks lastInSection on exactly the final sentence of each spine item', () => {
    const provider = createTestReaderTextProvider();
    const flagged = provider.sentences.filter((s) => s.lastInSection);

    // One per NON-EMPTY spine item, so three, not four.
    expect(flagged.map((s) => s.spineIndex)).toEqual([0, 2, 3]);
  });

  it('numbers sentenceIndex from zero within each spine item', () => {
    const provider = createTestReaderTextProvider();
    const firstOfEach = new Map<number, number>();

    for (const sentence of provider.sentences) {
      if (!firstOfEach.has(sentence.spineIndex)) {
        firstOfEach.set(sentence.spineIndex, sentence.sentenceIndex);
      }
    }

    expect([...firstOfEach.values()]).toEqual([0, 0, 0]);
  });
});

describe('testReaderTextProvider — walking the book', () => {
  it('starts at the reader position and walks to endOfBook, crossing sections', async () => {
    const provider = createTestReaderTextProvider();
    const walked: TtsSentence[] = [];

    let result = await provider.current(null);
    while (result.status === 'ok') {
      walked.push(result.sentence);
      result = await provider.next(result.sentence.cfi);
    }

    // Terminates by running out of book, not by erroring.
    expect(result.status).toBe('endOfBook');
    expect(walked).toEqual(provider.sentences);

    // The walk crossed section boundaries without a separate call — this is what makes
    // `getNextChapter` unnecessary on the interface.
    expect(new Set(walked.map((s) => s.spineIndex)).size).toBeGreaterThan(1);
  });

  it('round-trips every emitted cfi back through next()', async () => {
    const provider = createTestReaderTextProvider();

    // The opacity contract in reverse: a caller only ever hands back a cfi it was given,
    // so every one of them has to be accepted.
    for (const sentence of provider.sentences.slice(0, -1)) {
      const result = await provider.next(sentence.cfi);
      expect(result.status).toBe('ok');
    }
  });

  it('resolves the containing sentence when resuming from an emitted anchor', async () => {
    const provider = createTestReaderTextProvider();
    const target = provider.sentences[2];

    const result = await provider.current(target.cfi);

    expect(expectOk(result)).toEqual(target);
  });

  it('reports endOfBook rather than ok when the position is one past the end', async () => {
    const provider = createTestReaderTextProvider();
    provider.setPosition(provider.sentences.length);

    await expect(provider.current(null)).resolves.toEqual({ status: 'endOfBook' });
  });

  it('reports invalidAnchor for a cfi it never emitted', async () => {
    const provider = createTestReaderTextProvider();

    await expect(provider.current('epubcfi(/6/999!/4/2)')).resolves.toEqual({
      status: 'invalidAnchor',
    });
    await expect(provider.next('not-a-cfi-at-all')).resolves.toEqual({
      status: 'invalidAnchor',
    });
  });

  it('recovers from invalidAnchor via current(null), as the interface directs', async () => {
    const provider = createTestReaderTextProvider();

    expect((await provider.next('stale')).status).toBe('invalidAnchor');
    // The documented recovery is not to repair the anchor but to re-ask. It must work
    // immediately, with no reset call in between.
    expect(expectOk(await provider.current(null))).toEqual(provider.sentences[0]);
  });
});

describe('testReaderTextProvider — cancellation', () => {
  it('resolves unavailable instead of rejecting when the signal is already aborted', async () => {
    const provider = createTestReaderTextProvider({ latencyMs: 50 });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.current(null, controller.signal)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('resolves unavailable when aborted mid-flight, and never rejects', async () => {
    const provider = createTestReaderTextProvider({ latencyMs: 50 });
    const controller = new AbortController();

    const pending = provider.next(provider.sentences[0].cfi, controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('testReaderTextProvider — interruption and teardown', () => {
  it.each(['closed', 'revoked'] as const)(
    'starves an in-flight request when %s arrives before it settles',
    async (reason) => {
      const provider = createTestReaderTextProvider({ latencyMs: 20 });

      // THE ONE THAT MATTERS FOR DATA MINIMISATION: a fetch issued before teardown must
      // not deliver plaintext after it. This is the property that has to survive the swap
      // to the real provider, where it is enforced by a generation stamp on the bridge.
      const pending = provider.current(null);
      provider.interrupt(reason);

      await expect(pending).resolves.toEqual({ status: 'unavailable' });
    },
  );

  it.each(['closed', 'revoked'] as const)(
    'is terminal after %s — every later call resolves unavailable',
    async (reason) => {
      const provider = createTestReaderTextProvider();
      provider.interrupt(reason);

      await expect(provider.current(null)).resolves.toEqual({ status: 'unavailable' });
      await expect(provider.next(provider.sentences[0].cfi)).resolves.toEqual({
        status: 'unavailable',
      });
    },
  );

  it('keeps serving after navigated, resolving at the new position', async () => {
    const provider = createTestReaderTextProvider();
    const seen: string[] = [];
    provider.onInterrupted((reason) => seen.push(reason));

    provider.navigate(3);

    expect(seen).toEqual(['navigated']);
    // Not a teardown: the provider is still usable, which is the whole reason `navigated`
    // is a separate reason rather than another flavour of `closed`.
    expect(expectOk(await provider.current(null))).toEqual(provider.sentences[3]);
  });

  it('sees unavailable from inside the interruption handler', async () => {
    const provider = createTestReaderTextProvider();
    let fromHandler: string | null = null;

    provider.onInterrupted(() => {
      void provider.current(null).then((result) => {
        fromHandler = result.status;
      });
    });

    provider.interrupt('closed');
    await Promise.resolve();

    // The flag is set before handlers run, so a handler that reacts by fetching gets what
    // it would get in production rather than one last sentence.
    expect(fromHandler).toBe('unavailable');
  });

  it('is idempotent — a second interrupt fires nothing', () => {
    const provider = createTestReaderTextProvider();
    const seen: string[] = [];
    provider.onInterrupted((reason) => seen.push(reason));

    provider.interrupt('closed');
    provider.interrupt('closed');
    provider.interrupt('revoked');

    expect(seen).toEqual(['closed']);
  });

  it('stops delivering to an unsubscribed handler', () => {
    const provider = createTestReaderTextProvider();
    const seen: string[] = [];
    const unsubscribe = provider.onInterrupted((reason) => seen.push(reason));

    provider.navigate(1);
    unsubscribe();
    provider.interrupt('closed');

    expect(seen).toEqual(['navigated']);
  });

  it('still notifies the other subscribers when one throws', () => {
    const provider = createTestReaderTextProvider();
    const seen: string[] = [];

    provider.onInterrupted(() => {
      throw new Error('subscriber bug');
    });
    provider.onInterrupted((reason) => seen.push(reason));

    // Must not propagate: the real provider fires this from the closeBook effect cleanup.
    expect(() => provider.interrupt('closed')).not.toThrow();
    expect(seen).toEqual(['closed']);
  });

  it('survives a handler that unsubscribes itself during dispatch', () => {
    const provider = createTestReaderTextProvider();
    const seen: string[] = [];

    const unsubscribe = provider.onInterrupted((reason) => {
      seen.push(reason);
      unsubscribe();
    });
    provider.onInterrupted((reason) => seen.push(`second:${reason}`));

    provider.interrupt('closed');

    expect(seen).toEqual(['closed', 'second:closed']);
  });
});

describe('testReaderTextProvider — highlighting', () => {
  it('records each spoken range in call order, including clears', () => {
    const provider = createTestReaderTextProvider();
    const [first, second] = provider.sentences;

    provider.setSpokenRange(first.cfi);
    provider.setSpokenRange(second.cfi);
    provider.setSpokenRange(null);

    // One range replacing another, not a stack — nothing to clear between sentences.
    expect(provider.spokenRanges).toEqual([first.cfi, second.cfi, null]);
  });

  it('ignores a spoken range after teardown without throwing', () => {
    const provider = createTestReaderTextProvider();
    provider.interrupt('closed');

    expect(() => provider.setSpokenRange(provider.sentences[0].cfi)).not.toThrow();
    expect(provider.spokenRanges).toEqual([]);
  });

  it('accepts an unknown cfi silently rather than validating it', () => {
    const provider = createTestReaderTextProvider();

    // Best-effort by contract: the real one paints nothing and reports nothing. Throwing
    // here would let a failed highlight interrupt speech, which the interface forbids.
    expect(() => provider.setSpokenRange('epubcfi(/6/999!/4/2)')).not.toThrow();
  });

  // Ported from Reader's original fakeReaderTextProvider.test.ts (deleted 2026-09-09, per
  // TTS_PROVIDER.md's deletion table) — these four pin the test double's own contract for
  // `setSpokenWordRange`/`spokenWordRanges`, independent of `useTtsSession.test.ts`'s single
  // session-forwarding assertion against the same field.
  it('records each spoken WORD range in call order, including clears', () => {
    const provider = createTestReaderTextProvider();
    const [first] = provider.sentences;
    const one = { cfi: first.cfi, start: 0, end: 7 };
    const two = { cfi: first.cfi, start: 8, end: 12 };

    provider.setSpokenWordRange(one);
    provider.setSpokenWordRange(two);
    provider.setSpokenWordRange(null);

    expect(provider.spokenWordRanges).toEqual([one, two, null]);
  });

  it('keeps the word log independent of the sentence log', () => {
    // The real shell drops the painted word whenever the sentence moves, but it does that INSIDE
    // the WebView and produces no call. Folding that into this recorder would invent a call the
    // caller never made, and a test asserting the caller's own sequence would then be reading
    // this test double's opinion instead of the caller's behaviour.
    const provider = createTestReaderTextProvider();
    const [first, second] = provider.sentences;

    provider.setSpokenRange(first.cfi);
    provider.setSpokenWordRange({ cfi: first.cfi, start: 0, end: 7 });
    provider.setSpokenRange(second.cfi);

    expect(provider.spokenRanges).toEqual([first.cfi, second.cfi]);
    expect(provider.spokenWordRanges).toEqual([{ cfi: first.cfi, start: 0, end: 7 }]);
  });

  it('ignores a spoken word range after teardown without throwing', () => {
    const provider = createTestReaderTextProvider();
    provider.interrupt('closed');

    expect(() =>
      provider.setSpokenWordRange({ cfi: provider.sentences[0].cfi, start: 0, end: 4 }),
    ).not.toThrow();
    expect(provider.spokenWordRanges).toEqual([]);
  });

  it('accepts an unresolvable word range silently rather than validating it', () => {
    const provider = createTestReaderTextProvider();

    // Same contract as the sentence sibling above: the real one paints nothing, clears the previous
    // word, and reports nothing. Rejecting here would train a caller against a guarantee it will
    // not get on a device.
    expect(() =>
      provider.setSpokenWordRange({ cfi: 'epubcfi(/6/999!/4/2)', start: 40, end: 2 }),
    ).not.toThrow();
    expect(provider.spokenWordRanges).toHaveLength(1);
  });
});

describe('testReaderTextProvider — configuration', () => {
  it('serves a caller-supplied book', async () => {
    const provider = createTestReaderTextProvider({
      book: [['Only this.'], ['And this.']],
    });

    expect(provider.sentences).toHaveLength(2);
    expect(expectOk(await provider.current(null)).text).toBe('Only this.');
  });

  it('starts at startIndex, which is the resume path', async () => {
    const provider = createTestReaderTextProvider({ startIndex: 2 });

    expect(expectOk(await provider.current(null))).toEqual(provider.sentences[2]);
  });

  it('rejects a position outside the book', () => {
    const provider = createTestReaderTextProvider();

    expect(() => provider.setPosition(-1)).toThrow(RangeError);
    expect(() => provider.setPosition(provider.sentences.length + 1)).toThrow(RangeError);
    // One past the end is legal — it is how endOfBook is reached from current(null).
    expect(() => provider.setPosition(provider.sentences.length)).not.toThrow();
  });
});
