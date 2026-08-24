// Owner: Accessibility (Hruthik).
//
// Mocks `./ttsEngine` and fires its native events the way useTtsSession.test.ts does, so this
// exercises the real useTtsSession + the real FakeReaderTextProvider — the only thing this file
// adds on top is asserting the sentence text renders, which is the point of this screen.

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TtsReadingScreen } from './TtsReadingScreen';

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
    __fire: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };
});

jest.mock('@/features/sync/sharedPrefs', () => {
  // jest.requireActual, not an outer-scope import — jest.mock() factories can't close over
  // module-level variables (see App.test.tsx for the same pattern).
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

const { __fire: fireTtsEvent } = jest.requireMock('./ttsEngine') as {
  __fire: (event: string, payload?: unknown) => void;
};

describe('TtsReadingScreen', () => {
  it('shows a fallback until a sentence starts speaking', async () => {
    await render(<TtsReadingScreen />);

    expect(await screen.findByText('Press play to start.')).toBeTruthy();
  });

  it('shows the fake sentence text once it starts speaking', async () => {
    await render(<TtsReadingScreen />);

    await fireEvent.press(await screen.findByText('Play'));
    await act(() => fireTtsEvent('tts-start'));

    expect(
      await screen.findByText('The reader had been open for some time before anyone noticed the silence.'),
    ).toBeTruthy();
  });
});
