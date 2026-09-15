// Owner: Accessibility (Hruthik).
//
// Dedicated file for the Android-specific pause/resume branch: pause()/resume() are documented
// no-ops in @iternio/react-native-tts on Android, so useTtsSession.ts stops the engine itself and
// remembers the interrupted sentence (in-memory only) so play() can re-speak it, rather than
// relying on a native pause/resume round trip. PAUSE_RESUME_SUPPORTED (useTtsSession.ts) is
// computed once at module load from Platform.OS — so this needs Platform.OS === 'android' BEFORE
// useTtsSession.ts is first imported, not after. useTtsSession.test.ts's same-file Platform.OS
// mutation (the pattern ttsRate.test.ts uses) can't reach an import-time constant; only
// intercepting the 'react-native' module before that import resolves can, which is why this one
// file uses jest.mock('react-native', ...) despite the "wholesale replace" tradeoff
// ttsRate.test.ts's header warns against — there's nothing else in this dedicated file for it to
// disturb.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createTestReaderTextProvider } from './testSupport/testReaderTextProvider';

import { useTtsSession } from './useTtsSession';

// jest.mock() calls are hoisted above these imports by babel-plugin-jest-hoist regardless of
// source order, so writing imports first (matching useTtsSession.test.ts's structure) still
// applies every mock below before useTtsSession.ts — and its import-time PAUSE_RESUME_SUPPORTED
// constant — ever evaluates.

// Mutates Platform.OS on the real module in place and returns it unchanged otherwise — spreading
// `{...jest.requireActual('react-native')}` (a new object) eagerly evaluates the module's lazy
// getters (FlatList, DevMenu, ...) outside jest-expo's controlled setup and throws a
// TurboModuleRegistry invariant. Returning the actual module object, only mutated, doesn't.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.Platform.OS = 'android';
  return actual;
});

type NativeListener = (event?: unknown) => void;

jest.mock('./ttsEngine', () => {
  const listeners = new Map<string, Set<NativeListener>>();
  return {
    __esModule: true,
    default: {
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
    },
    // Test-only, mirrors useTtsSession.test.ts's mock: fires every handler registered for `event`.
    __fire: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };
});

jest.mock('@/features/sync/sharedPrefs', () => {
  const { DEFAULT_PREFS, DEFAULT_ACCESSIBILITY_PREFS } = jest.requireActual('@/shared/contracts');
  return {
    readSharedPrefs: jest.fn(() =>
      Promise.resolve({
        ...DEFAULT_PREFS,
        accessibility: {
          ...DEFAULT_ACCESSIBILITY_PREFS,
          tts: { ...DEFAULT_ACCESSIBILITY_PREFS.tts, enabled: true },
        },
      }),
    ),
    writeSharedPrefs: jest.fn(() => Promise.resolve()),
  };
});

const { default: mockTts, __fire: fireTtsEvent } = jest.requireMock('./ttsEngine') as {
  default: { addListener: jest.Mock; speak: jest.Mock; pause: jest.Mock; resume: jest.Mock; stop: jest.Mock };
  __fire: (event: string, payload?: unknown) => void;
};

// Same no-real-emitter situation as useTtsSession.test.ts — grab the registered handler directly.
function fireAppStateChange(next: 'active' | 'background' | 'inactive'): Promise<void> {
  const addEventListenerMock = AppState.addEventListener as jest.Mock;
  const handler = addEventListenerMock.mock.calls
    .filter(([type]: [string, unknown]) => type === 'change')
    .at(-1)?.[1] as ((state: string) => void) | undefined;
  return act(() => handler?.(next));
}

describe('useTtsSession on Android', () => {
  it("pause() never calls the native pause — it stops the engine and flips to 'paused' directly, since no tts-pause event will ever arrive", async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await act(() => result.current.pause());

    expect(mockTts.pause).not.toHaveBeenCalled();
    expect(mockTts.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('paused');
    // Unlike a real stop, pause keeps the interrupted sentence around for play() to resume.
    expect(result.current.currentSentence).toEqual(provider.sentences[0]);
  });

  it('play() while paused re-speaks the paused sentence instead of re-resolving the reader position', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    expect(result.current.status).toBe('paused');

    mockTts.speak.mockClear();
    await act(() => result.current.play());

    expect(mockTts.resume).not.toHaveBeenCalled(); // no native resume on Android.
    expect(mockTts.speak).toHaveBeenCalledWith(provider.sentences[0].text);
    // Status is still driven off tts-start, same as a fresh play() — pause/resume doesn't skip it.
    expect(result.current.status).toBe('paused');
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');
  });

  it('play() after the reader navigates away while paused re-resolves fresh, not the stale pausedSentence snapshot', async () => {
    // Android's own 'navigated' handler already nulls pausedSentence, and playRef's fallback
    // already re-resolves when it's null — this pins that the shared pausedPositionInvalidated
    // fix (added for iOS) does not fight or duplicate that, and the end result is still correct.
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => result.current.pause());
    expect(result.current.status).toBe('paused');

    await act(() => provider.navigate(2));

    mockTts.speak.mockClear();
    await act(() => result.current.play());

    expect(mockTts.speak).toHaveBeenCalledWith(provider.sentences[2].text);
  });

  it('backgrounding while speaking resets to idle — the reset itself is not platform-gated', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    expect(result.current.status).toBe('speaking');

    await fireAppStateChange('background');

    expect(result.current.status).toBe('idle');
    expect(mockTts.stop).toHaveBeenCalled();
  });

  // The other side of the platform gap: unlike iOS (useTtsSession.test.ts's mirrored test),
  // Android's supportedEvents genuinely include 'tts-error' (TextToSpeechModule.java emits it
  // from UtteranceProgressListener.onError), so useTtsSession.ts's iOS-only guard must not
  // suppress it here — this was previously untested on either platform.
  it('subscribes to tts-error and surfaces it as status "error"', async () => {
    const provider = createTestReaderTextProvider();
    const { result } = await renderHook(() => useTtsSession(provider));

    await waitFor(() => expect(result.current.prefs.enabled).toBe(true));
    expect(mockTts.addListener).toHaveBeenCalledWith('tts-error', expect.any(Function));

    await act(() => result.current.play());
    await act(() => fireTtsEvent('tts-start'));
    await act(() => fireTtsEvent('tts-error', { message: 'engine busy' }));

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('engine busy');
  });
});
