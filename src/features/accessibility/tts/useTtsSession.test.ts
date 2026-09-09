// Owner: Accessibility (Hruthik).
//
// Drives useTtsSession against TestReaderTextProvider (this directory's own test double, forked
// from Reader's original — see TTS_PROVIDER.md) and a hand-rolled mock of the native TTS module,
// firing native events the way the real engine would. The native module is mocked at `./ttsEngine`, not
// `@iternio/react-native-tts` directly, so this test exercises exactly the surface
// useTtsSession actually imports.
//
// EVERY `act(...)` CALL IS AWAITED, including the ones that look synchronous. This RNTL
// version's `act()` always wraps its callback in an async function internally (see
// node_modules/@testing-library/react-native/dist/act.js), so it always returns a thenable —
// an un-awaited `act(() => ...)` schedules the update but returns before React commits it, and
// the next assertion reads stale state.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createFakePdfReaderTextProvider } from './testSupport/fakePdfReaderTextProvider';
import { createTestReaderTextProvider } from './testSupport/testReaderTextProvider';
import { readSharedPrefs, writeSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS, DEFAULT_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs, SharedPrefs } from '@/shared/contracts';
import {
  _resetAudioTtsCoordinatorForTests,
  registerAudioPauseHandler,
  stopActiveTts,
} from '@/features/reader/audio/audioTtsCoordinator';

import { useTtsSession } from './useTtsSession';

type NativeListener = (event?: unknown) => void;

jest.mock('./ttsEngine', () => {
  const listeners = new Map<string, Set<NativeListener>>();
  const mockTts = {
    addListener: jest.fn((event: string, handler: NativeListener) => {
      const set = listeners.get(event) ?? new Set<NativeListener>();
      set.add(handler);
      listeners.set(event, set);
      return { remove: jest.fn(() => set.delete(handler)) };
    }),
    speak: jest.fn(() => Promise.resolve('utterance-1')),
    stop: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve(true)),
    resume: jest.fn(() => Promise.resolve(true)),
    setDefaultRate: jest.fn(() => Promise.resolve(true)),
    setDefaultPitch: jest.fn(() => Promise.resolve(true)),
    setDefaultVoice: jest.fn(() => Promise.resolve(true)),
    setIgnoreSilentSwitch: jest.fn(() => Promise.resolve(true)),
    voices: jest.fn(() => Promise.resolve([])),
  };
  return {
    __esModule: true,
    default: mockTts,
    // Test-only: fires every handler registered for `event`, exactly as the native side would.
    __fire: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };
});

jest.mock('@/features/sync/sharedPrefs', () => ({
  readSharedPrefs: jest.fn(),
  writeSharedPrefs: jest.fn(() => Promise.resolve()),
}));

// Pulling the test-only __fire helper off the mock; it deliberately isn't part of ttsEngine's
// real, typed surface, which is why this needs a cast rather than a normal import.
const { default: mockTts, __fire: fireTtsEvent } = jest.requireMock('./ttsEngine') as {
  default: {
    addListener: jest.Mock;
    speak: jest.Mock;
    stop: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
    setDefaultRate: jest.Mock;
    setDefaultPitch: jest.Mock;
    setDefaultVoice: jest.Mock;
    setIgnoreSilentSwitch: jest.Mock;
  };
  __fire: (event: string, payload?: unknown) => void;
};

const readSharedPrefsMock = readSharedPrefs as jest.Mock;
const writeSharedPrefsMock = writeSharedPrefs as jest.Mock;

function makeSharedPrefs(tts: Partial<A11yTtsPrefs> = {}): SharedPrefs {
  return {
    id: 'a11y-test',
    userId: 'test-user',
    updatedAt: 0,
    isDeleted: false,
    synced: true,
    ...structuredClone(DEFAULT_PREFS),
    accessibility: {
      ...structuredClone(DEFAULT_ACCESSIBILITY_PREFS),
      tts: {
        ...DEFAULT_ACCESSIBILITY_PREFS.tts,
        enabled: true,
        autoContinueChapter: true,
        ...tts,
      },
    },
  };
}

/** Fires tts-start then tts-finish, as the native engine would for one utterance. */
async function finishCurrentUtterance(): Promise<void> {
  await act(() => fireTtsEvent('tts-start'));
  await act(() => fireTtsEvent('tts-finish'));
}

// The RN jest preset's AppState mock (@react-native/jest-preset/jest/mocks/AppState.js) has no
// real emitter — addEventListener just records the handler. Grabbing the most recently
// registered 'change' handler and invoking it directly is the only way to simulate a transition.
function fireAppStateChange(next: 'active' | 'background' | 'inactive'): Promise<void> {
  const addEventListenerMock = AppState.addEventListener as jest.Mock;
  const handler = addEventListenerMock.mock.calls
    .filter(([type]: [string, unknown]) => type === 'change')
    .at(-1)?.[1] as ((state: string) => void) | undefined;
  return act(() => handler?.(next));
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAudioTtsCoordinatorForTests();
  readSharedPrefsMock.mockResolvedValue(makeSharedPrefs());
});

describe('useTtsSession', () => {
  it('speaks sentences in order, painting the highlight only once the utterance starts', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.play());
    expect(mockTts.speak).toHaveBeenCalledWith(provider.sentences[0].text);

    // Highlight is not painted until tts-start — the fetch alone must not move it.
    expect(provider.spokenRanges).toHaveLength(0);

    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');
    expect(provider.spokenRanges).toEqual([provider.sentences[0].cfi]);

    await act(() => fireTtsEvent('tts-finish'));
    expect(mockTts.speak).toHaveBeenLastCalledWith(provider.sentences[1].text);
  });

  it("ignores tts-progress when highlightMode is 'sentence' (the default)", async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.highlightMode).toBe('sentence'));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));

    await act(() => fireTtsEvent('tts-progress', { location: 0, length: 5 }));

    // 'sentence' mode never consumes tts-progress — Reader's own setSpokenRange handler
    // auto-follows on its coarser, once-per-sentence cadence instead (TTS_PROVIDER.md item 2).
    expect(provider.spokenWordRanges).toHaveLength(0);
  });

  it("forwards tts-progress to setSpokenWordRange when highlightMode is 'word'", async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ highlightMode: 'word' }));
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.highlightMode).toBe('word'));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));

    // iOS-shaped payload (location/length) — the default test environment here is iOS, per the
    // PAUSE_RESUME_SUPPORTED note above.
    await act(() => fireTtsEvent('tts-progress', { location: 4, length: 3 }));

    expect(provider.spokenWordRanges.at(-1)).toEqual({
      cfi: provider.sentences[0].cfi,
      start: 4,
      end: 7,
    });
  });

  it('ignores tts-progress while idle — nothing has ever been spoken', async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ highlightMode: 'word' }));
    const provider = createTestReaderTextProvider();
    await renderHook(() => useTtsSession(provider));

    // No play() at all — awaitingUtterance is false, the same guard handleTtsStart itself uses.
    await act(() => fireTtsEvent('tts-progress', { location: 0, length: 3 }));

    expect(provider.spokenWordRanges).toHaveLength(0);
  });

  it('stops at the end of a section when autoContinueChapter is off, and clears the highlight', async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ autoContinueChapter: false }));
    // DEFAULT_TEST_BOOK's spine item 0 has 3 sentences; sentence index 2 is lastInSection.
    const provider = createTestReaderTextProvider({ startIndex: 2 });
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.autoContinueChapter).toBe(false));

    await act(() => result.current.play());
    await finishCurrentUtterance();

    expect(result.current.status).toBe('idle');
    expect(mockTts.speak).toHaveBeenCalledTimes(1); // never advanced past the section boundary.
    expect(provider.spokenRanges.at(-1)).toBeNull(); // cleared on stop.
  });

  it('crosses an empty spine item when autoContinueChapter is on', async () => {
    // Sentence index 2 (0-based across the flattened book) is spine item 0's last sentence;
    // spine item 1 is empty, so the next real sentence is spine item 2's first.
    const provider = createTestReaderTextProvider({ startIndex: 2 });
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await finishCurrentUtterance();

    const spoken = provider.sentences[3];
    expect(spoken.spineIndex).toBe(2); // confirms the jump from spine 0 to spine 2.
    expect(mockTts.speak).toHaveBeenLastCalledWith(spoken.text);
  });

  it('stops on a closed interruption and tries to clear the highlight', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(provider.spokenRanges).toEqual([provider.sentences[0].cfi]);

    await act(() => provider.interrupt('closed'));

    expect(result.current.status).toBe('idle');
    // The fake marks itself terminated before firing 'closed', so setSpokenRange(null) here is a
    // no-op on its side — matching the seam's own contract ("fire-and-forget... must not be able
    // to interrupt speech"). What this session controls, and what's worth asserting, is that it
    // still tries: calling stop() doesn't skip the clear just because the provider is going away.
    expect(mockTts.stop).toHaveBeenCalled();
  });

  it('does not stop on a navigated interruption', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await act(() => provider.navigate(3));

    // Reader clears the highlight itself on navigation — this session must not also stop.
    expect(result.current.status).toBe('speaking');
  });

  // This file's default test environment is iOS (jest-expo's RN mock; ttsRate.test.ts confirms
  // the same default), so PAUSE_RESUME_SUPPORTED — computed once from Platform.OS at module load
  // — is already true here. The Android no-op branch needs Platform.OS === 'android' BEFORE
  // useTtsSession.ts is first imported, which a same-file mutation can't reach; see
  // useTtsSession.android.test.ts for that case instead.
  it("pause() calls Tts.pause() on iOS, and status only flips to 'paused' on the native event", async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await act(() => result.current.pause());
    expect(mockTts.pause).toHaveBeenCalled();
    // Status is event-driven, not action-driven — calling pause() alone must not flip it.
    expect(result.current.status).toBe('speaking');

    await act(() => fireTtsEvent('tts-pause'));
    expect(result.current.status).toBe('paused');
  });

  it('play() while paused on iOS resumes the native engine rather than issuing a fresh fetch', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    await act(() => fireTtsEvent('tts-pause'));
    expect(result.current.status).toBe('paused');

    mockTts.speak.mockClear();
    await act(() => result.current.play());

    expect(mockTts.resume).toHaveBeenCalled();
    expect(mockTts.speak).not.toHaveBeenCalled(); // resumed, not re-fetched.
  });

  it('play() after the reader navigates away WHILE PAUSED re-resolves fresh, not the native resume', async () => {
    // The bug this guards against: Tts.resume() on iOS is a genuine native resume of the SUSPENDED
    // utterance — calling it blindly continues content from wherever the reader WAS, ignoring that
    // they scrolled/swiped somewhere else while paused. Reported on-device: pause, scroll to a new
    // area, press play — TTS picked back up the OLD content instead of the new page.
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    await act(() => fireTtsEvent('tts-pause'));
    expect(result.current.status).toBe('paused');

    // The reader scrolls/swipes to a different part of the book while still paused.
    await act(() => provider.navigate(2));

    mockTts.speak.mockClear();
    mockTts.resume.mockClear();
    mockTts.stop.mockClear();
    await act(() => result.current.play());

    // The suspended native utterance is stopped, not resumed — it is holding the wrong content.
    expect(mockTts.resume).not.toHaveBeenCalled();
    expect(mockTts.stop).toHaveBeenCalled();
    // And a fresh sentence is fetched from wherever the reader actually is now, same as a first
    // play() from idle would — not the sentence that was paused.
    expect(mockTts.speak).toHaveBeenCalledWith(provider.sentences[2].text);
  });

  it('play() after pausing with NO navigation still resumes normally — the fix is scoped to the navigated case', async () => {
    // A regression check on the sibling test above: pausing and pressing play with nothing else
    // happening in between must be completely unaffected by pausedPositionInvalidated.
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    await act(() => fireTtsEvent('tts-pause'));

    mockTts.speak.mockClear();
    mockTts.resume.mockClear();
    await act(() => result.current.play());

    expect(mockTts.resume).toHaveBeenCalled();
    expect(mockTts.speak).not.toHaveBeenCalled();
  });

  it('backgrounding while speaking stops speech, clears the highlight, and resets to idle', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await fireAppStateChange('background');

    expect(result.current.status).toBe('idle');
    expect(provider.spokenRanges.at(-1)).toBeNull();
    expect(mockTts.stop).toHaveBeenCalled();
  });

  it('backgrounding while paused resets to idle rather than preserving the paused state', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    await act(() => fireTtsEvent('tts-pause'));
    expect(result.current.status).toBe('paused');

    await fireAppStateChange('background');

    expect(result.current.status).toBe('idle');
  });

  it('backgrounding while idle is a harmless no-op', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    expect(result.current.status).toBe('idle');

    await fireAppStateChange('background');

    expect(result.current.status).toBe('idle');
  });

  it('a stale tts-pause/tts-resume arriving after a background-triggered reset does not resurrect status', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await fireAppStateChange('background');
    expect(result.current.status).toBe('idle');

    await act(() => fireTtsEvent('tts-pause'));
    expect(result.current.status).toBe('idle');

    await act(() => fireTtsEvent('tts-resume'));
    expect(result.current.status).toBe('idle');

    await act(() => fireTtsEvent('tts-finish'));
    expect(result.current.status).toBe('idle');
    expect(mockTts.speak).toHaveBeenCalledTimes(1); // no fresh sentence fetched off the stale finish.
  });

  it('going inactive (without backgrounding) does not interrupt speech', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await fireAppStateChange('inactive');

    expect(result.current.status).toBe('speaking');
  });

  it('setRate applies the mapped native rate and persists the multiplier', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setRate(2.0));

    expect(result.current.prefs.rate).toBe(2.0);
    expect(mockTts.setDefaultRate).toHaveBeenLastCalledWith(expect.any(Number));
    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalled());
    const written = writeSharedPrefsMock.mock.calls.at(-1)?.[0];
    expect(written.accessibility.tts.rate).toBe(2.0);
  });

  it('setPitch applies the native pitch and persists it', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setPitch(1.5));

    expect(result.current.prefs.pitch).toBe(1.5);
    expect(mockTts.setDefaultPitch).toHaveBeenLastCalledWith(1.5);
    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalled());
    const written = writeSharedPrefsMock.mock.calls.at(-1)?.[0];
    expect(written.accessibility.tts.pitch).toBe(1.5);
  });

  it('setVoice applies the native voice and persists it', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setVoice('com.test.voice'));

    expect(result.current.prefs.voiceId).toBe('com.test.voice');
    expect(mockTts.setDefaultVoice).toHaveBeenLastCalledWith('com.test.voice');
    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalled());
    const written = writeSharedPrefsMock.mock.calls.at(-1)?.[0];
    expect(written.accessibility.tts.voiceId).toBe('com.test.voice');
  });

  it('setVoice(null) persists the platform default without calling the native engine', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setVoice(null));

    expect(result.current.prefs.voiceId).toBeNull();
    expect(mockTts.setDefaultVoice).not.toHaveBeenCalled();
    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalled());
    const written = writeSharedPrefsMock.mock.calls.at(-1)?.[0];
    expect(written.accessibility.tts.voiceId).toBeNull();
  });

  it('coalesces a rate press immediately followed by a pitch press into one persisted write', async () => {
    // Regression guard for a lost-update race: persistTtsPatch used to fire an unserialized
    // read-modify-write per press, so a second press's readSharedPrefs() could complete before
    // the first press's writeSharedPrefs() did, and the second write would silently drop the
    // first change. Debouncing coalesces both presses into one write carrying both fields.
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setRate(2.0));
    await act(() => result.current.setPitch(1.5));

    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalledTimes(1));
    const written = writeSharedPrefsMock.mock.calls[0][0];
    expect(written.accessibility.tts.rate).toBe(2.0);
    expect(written.accessibility.tts.pitch).toBe(1.5);
  });

  it('flushes a pending patch immediately on teardown, before the debounce would have fired', async () => {
    const provider = createTestReaderTextProvider();
    const { result, unmount } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setRate(1.75));
    // No time has passed — the 300ms debounce has not fired on its own yet.
    expect(writeSharedPrefsMock).not.toHaveBeenCalled();

    await act(() => unmount());

    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalledTimes(1));
    const written = writeSharedPrefsMock.mock.calls[0][0];
    expect(written.accessibility.tts.rate).toBe(1.75);
  });

  it('on mount, applies stored non-default pitch and voiceId to the native engine', async () => {
    readSharedPrefsMock.mockResolvedValue(
      makeSharedPrefs({ pitch: 1.5, voiceId: 'com.test.voice' }),
    );
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.pitch).toBe(1.5));
    expect(result.current.prefs.voiceId).toBe('com.test.voice');
    expect(mockTts.setDefaultPitch).toHaveBeenCalledWith(1.5);
    expect(mockTts.setDefaultVoice).toHaveBeenCalledWith('com.test.voice');
  });

  // Pins the iOS side of the platform gap: @iternio/react-native-tts's iOS `supportedEvents`
  // (TextToSpeech.m) never declares 'tts-error', and RCTEventEmitter.addListener throws
  // synchronously for an undeclared event name. This file already runs at the default (iOS)
  // Platform.OS — see the pause() test above — so never calling addListener('tts-error', ...)
  // here is exactly the guard in useTtsSession.ts being exercised, not assumed.
  // useTtsSession.android.test.ts pins the other side: Android still subscribes and still
  // reaches handleTtsError.
  it('never subscribes to tts-error on iOS, so it cannot throw against the real native module', async () => {
    const provider = createTestReaderTextProvider();
    await renderHook(() => useTtsSession(provider));

    expect(mockTts.addListener).not.toHaveBeenCalledWith('tts-error', expect.any(Function));
  });
});

// PDF_TTS_HANDOFF.md's central claim is that this session needs no code change to speak a PDF
// once Reader ships a conforming provider, because `sentence.cfi` is opaque here — never parsed,
// only ever passed back to the provider. This block pins that empirically: the same classes of
// scenario the EPUB fake exercises above (ordering, a section-boundary stop, crossing an empty
// section, an interruption), run instead against `createFakePdfReaderTextProvider`, whose anchors
// are deliberately NOT CFI-shaped. If this session ever starts assuming CFI structure, these fail
// exactly like the EPUB versions do, and say so before a real PDF provider ships.
describe('a PDF-shaped provider (non-CFI opaque anchor)', () => {
  it('speaks sentences in order, painting the highlight only once the utterance starts', async () => {
    const provider = createFakePdfReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.play());
    expect(mockTts.speak).toHaveBeenCalledWith(provider.sentences[0].text);
    expect(provider.spokenRanges).toHaveLength(0);

    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');
    expect(provider.spokenRanges).toEqual([provider.sentences[0].cfi]);
    expect(provider.sentences[0].cfi).not.toMatch(/^epubcfi\(/);

    await act(() => fireTtsEvent('tts-finish'));
    expect(mockTts.speak).toHaveBeenLastCalledWith(provider.sentences[1].text);
  });

  it("forwards tts-progress to setSpokenWordRange when highlightMode is 'word', with a non-CFI cfi field", async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ highlightMode: 'word' }));
    const provider = createFakePdfReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.highlightMode).toBe('word'));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));

    await act(() => fireTtsEvent('tts-progress', { location: 4, length: 3 }));

    expect(provider.spokenWordRanges.at(-1)).toEqual({
      cfi: provider.sentences[0].cfi,
      start: 4,
      end: 7,
    });
    expect(provider.spokenWordRanges.at(-1)?.cfi).not.toMatch(/^epubcfi\(/);
  });

  it('stops at the end of a page when autoContinueChapter is off, and clears the highlight', async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ autoContinueChapter: false }));
    // DEFAULT_FAKE_PDF_BOOK's page 0 has 2 sentences; sentence index 1 is lastInSection.
    const provider = createFakePdfReaderTextProvider({ startIndex: 1 });
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.autoContinueChapter).toBe(false));

    await act(() => result.current.play());
    await finishCurrentUtterance();

    expect(result.current.status).toBe('idle');
    expect(mockTts.speak).toHaveBeenCalledTimes(1);
    expect(provider.spokenRanges.at(-1)).toBeNull();
  });

  it('crosses an empty page when autoContinueChapter is on', async () => {
    // Sentence index 1 (flattened) is page 0's last sentence; page 1 is empty, so the next real
    // sentence is page 2's first.
    const provider = createFakePdfReaderTextProvider({ startIndex: 1 });
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await finishCurrentUtterance();

    const spoken = provider.sentences[2];
    expect(spoken.spineIndex).toBe(2); // confirms the jump from page 0 to page 2.
    expect(mockTts.speak).toHaveBeenLastCalledWith(spoken.text);
  });

  it('stops on a closed interruption and tries to clear the highlight', async () => {
    const provider = createFakePdfReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(provider.spokenRanges).toEqual([provider.sentences[0].cfi]);

    await act(() => provider.interrupt('closed'));

    expect(result.current.status).toBe('idle');
    expect(mockTts.stop).toHaveBeenCalled();
  });

  it('does not stop on a navigated interruption', async () => {
    const provider = createFakePdfReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await act(() => provider.navigate(2));

    expect(result.current.status).toBe('speaking');
  });
});

describe('a null provider — there is no book to read yet', () => {
  // ReaderScreen passes null while TTS is switched off, the book is a PDF, or the bridge is not up.
  // The hook cannot be called conditionally, so "do nothing" has to be a state it supports. It used
  // to be handed an inert stand-in provider instead, which built a full session that could never
  // speak and then replaced it the moment the real provider arrived.
  it('sets nothing up at all', async () => {
    const { result } = await renderHook(() => useTtsSession(null));

    expect(mockTts.addListener).not.toHaveBeenCalled();
    expect(mockTts.setIgnoreSilentSwitch).not.toHaveBeenCalled();
    expect(readSharedPrefsMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('subscribes exactly once when the provider arrives, not twice', async () => {
    const provider = createTestReaderTextProvider();
    const { rerender } = await renderHook(
      ({ p }: { p: ReturnType<typeof createTestReaderTextProvider> | null }) => useTtsSession(p),
      { initialProps: { p: null as ReturnType<typeof createTestReaderTextProvider> | null } },
    );

    await act(async () => {
      rerender({ p: provider });
    });

    const startSubscriptions = mockTts.addListener.mock.calls.filter(
      ([event]: [string, unknown]) => event === 'tts-start',
    );
    expect(startSubscriptions).toHaveLength(1);
  });

  it('returns to idle when the provider goes away mid-read, not just silent', async () => {
    // THE BUG THIS PINS: the cleanup stopped the engine but left `status` at 'speaking'. Anything
    // rendering a "reading aloud" indicator off this hook — ReaderScreen paints one on the page —
    // would keep showing it over a book that had been cut off mid-sentence.
    const provider = createTestReaderTextProvider();
    const { result, rerender } = await renderHook(
      ({ p }: { p: ReturnType<typeof createTestReaderTextProvider> | null }) => useTtsSession(p),
      { initialProps: { p: provider as ReturnType<typeof createTestReaderTextProvider> | null } },
    );

    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await act(async () => {
      rerender({ p: null });
    });

    expect(mockTts.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.currentSentence).toBeNull();
  });

  it('ignores a play() that arrives after the provider went away', async () => {
    const provider = createTestReaderTextProvider();
    const { result, rerender } = await renderHook(
      ({ p }: { p: ReturnType<typeof createTestReaderTextProvider> | null }) => useTtsSession(p),
      { initialProps: { p: provider as ReturnType<typeof createTestReaderTextProvider> | null } },
    );

    await act(async () => {
      rerender({ p: null });
    });
    mockTts.speak.mockClear();

    // The returned actions are stable trampolines, so a caller can still hold and call one.
    await act(() => result.current.play());

    expect(mockTts.speak).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});

describe('useTtsSession — concurrency with audio playback', () => {
  it('does not pause audio merely when TTS is enabled or mounted; pauses only when play() is pressed', async () => {
    const pauseAudioMock = jest.fn();
    registerAudioPauseHandler(pauseAudioMock);

    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    // TTS is ON and idle — audiobook must NOT be paused
    expect(result.current.status).toBe('idle');
    expect(pauseAudioMock).not.toHaveBeenCalled();

    // Only when TTS actually begins playing does it pause the audiobook
    await act(() => result.current.play());
    expect(pauseAudioMock).toHaveBeenCalled();
  });

  it('stops active TTS speech when stopActiveTts is invoked by the coordinator', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');
    expect(provider.spokenRanges).toEqual([provider.sentences[0].cfi]);

    // An audiobook begins playback and calls stopActiveTts()
    await act(() => {
      stopActiveTts();
    });

    expect(result.current.status).toBe('idle');
    expect(mockTts.stop).toHaveBeenCalled();
    expect(provider.spokenRanges.at(-1)).toBeNull();
  });
});
