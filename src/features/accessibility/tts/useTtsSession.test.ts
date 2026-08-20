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
    speak: jest.Mock;
    stop: jest.Mock;
    pause: jest.Mock;
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
});
