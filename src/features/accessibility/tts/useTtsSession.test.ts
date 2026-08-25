// Owner: Accessibility (Hruthik).
//
// Drives useTtsSession against the real FakeReaderTextProvider (Reader's own fake — see
// TTS_PROVIDER.md) and a hand-rolled mock of the native TTS module, firing native events the
// way the real engine would. The native module is mocked at `./ttsEngine`, not
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

import { createFakeReaderTextProvider } from '@/features/reader/tts/fakeReaderTextProvider';
import { readSharedPrefs, writeSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS, DEFAULT_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs, SharedPrefs } from '@/shared/contracts';

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
  readSharedPrefsMock.mockResolvedValue(makeSharedPrefs());
});

describe('useTtsSession', () => {
  it('speaks sentences in order, painting the highlight only once the utterance starts', async () => {
    const provider = createFakeReaderTextProvider();
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

  it('stops at the end of a section when autoContinueChapter is off, and clears the highlight', async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs({ autoContinueChapter: false }));
    // DEFAULT_FAKE_BOOK's spine item 0 has 3 sentences; sentence index 2 is lastInSection.
    const provider = createFakeReaderTextProvider({ startIndex: 2 });
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
    const provider = createFakeReaderTextProvider({ startIndex: 2 });
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await finishCurrentUtterance();

    const spoken = provider.sentences[3];
    expect(spoken.spineIndex).toBe(2); // confirms the jump from spine 0 to spine 2.
    expect(mockTts.speak).toHaveBeenLastCalledWith(spoken.text);
  });

  it('stops on a closed interruption and tries to clear the highlight', async () => {
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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

  it('backgrounding while speaking stops speech, clears the highlight, and resets to idle', async () => {
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    expect(result.current.status).toBe('idle');

    await fireAppStateChange('background');

    expect(result.current.status).toBe('idle');
  });

  it('a stale tts-pause/tts-resume arriving after a background-triggered reset does not resurrect status', async () => {
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await fireAppStateChange('inactive');

    expect(result.current.status).toBe('speaking');
  });

  it('setRate applies the mapped native rate and persists the multiplier', async () => {
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));

    await act(() => result.current.setVoice(null));

    expect(result.current.prefs.voiceId).toBeNull();
    expect(mockTts.setDefaultVoice).not.toHaveBeenCalled();
    await waitFor(() => expect(writeSharedPrefsMock).toHaveBeenCalled());
    const written = writeSharedPrefsMock.mock.calls.at(-1)?.[0];
    expect(written.accessibility.tts.voiceId).toBeNull();
  });

  it('on mount, applies stored non-default pitch and voiceId to the native engine', async () => {
    readSharedPrefsMock.mockResolvedValue(
      makeSharedPrefs({ pitch: 1.5, voiceId: 'com.test.voice' }),
    );
    const provider = createFakeReaderTextProvider();
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
    const provider = createFakeReaderTextProvider();
    await renderHook(() => useTtsSession(provider));

    expect(mockTts.addListener).not.toHaveBeenCalledWith('tts-error', expect.any(Function));
  });
});
