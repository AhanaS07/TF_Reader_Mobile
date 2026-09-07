// Owner: Reader (Ahana).
//
// Covers AudioPlayerRouteScreen's own contract — wiring route params into AudioPlayerScreen's
// `bookId`/`title` and the progressStore-backed resume/commit/play-gate props — not
// AudioPlayerScreen's own behaviour, which has its own test file. Mocked to an inert stub so this
// only exercises the glue, same pattern ReaderRouteScreen.test.tsx uses for ReaderScreen.
//
// progressStore itself is mocked rather than exercised against real SQLite: this file is testing
// AudioPlayerRouteScreen's wiring (does it call currentLocator/savePosition with the right
// arguments, does it gate on the async read), not progressStore's own correctness — that lives in
// src/features/sync/contractConformance.test.ts. syncEngine.run() is mocked too, for the same
// reason — this file checks that it is awaited BEFORE the local read, not that a real sync does
// anything.
//
// `Alert.alert` auto-presses a configured button synchronously (not a captured closure re-invoked
// later, outside any `act()` scope) — see ReaderRouteScreen.test.tsx's header for why that specific
// shape is load-bearing, not a style choice.
//
// NO progressStore.subscribe HERE, UNLIKE ReaderRouteScreen.test.tsx. AudioPlayerRouteScreen.tsx
// deliberately does not use one — see that file's header for why a background subscription is the
// wrong shape for AUDIO specifically. This file exercises the play-gate (`onBeforePlay`) instead,
// via the mocked AudioPlayerScreen's "play" button.

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { Locator } from '@/shared/contracts';

import { AudioPlayerRouteScreen } from './AudioPlayerRouteScreen';

const mockCurrentLocator = jest.fn<Promise<Locator | null>, [string?, string?]>();
const mockSavePosition = jest.fn();
const mockSyncRun = jest.fn<Promise<void>, []>();
// Records call order across both mocks, so a test can prove `run()` happened BEFORE
// `currentLocator()` rather than merely that both happened.
const callOrder: string[] = [];

jest.mock('@/features/sync/stores/progressStore', () => ({
  progressStore: {
    currentLocator: (...args: [string?, string?]) => {
      callOrder.push('currentLocator');
      return mockCurrentLocator(...args);
    },
    savePosition: (...args: unknown[]) => mockSavePosition(...args),
  },
}));

jest.mock('@/features/sync/syncEngine', () => ({
  syncEngine: {
    run: () => {
      callOrder.push('run');
      return mockSyncRun();
    },
  },
}));

// `mock`-prefixed, per babel-plugin-jest-hoist's naming exception — see ReaderRouteScreen.test.tsx's
// own comment on why this can't just be a plain top-level array.
const mockReceivedProps: { bookId?: string; title?: string; initialPosition?: number }[] = [];

jest.mock('@/features/reader/audio/AudioPlayerScreen', () => ({
  AudioPlayerScreen: (props: {
    bookId: string;
    title: string;
    initialPosition?: number;
    onPositionChange?: (p: number) => void;
    onPositionCommit?: (p: number) => void;
    onBeforePlay?: () => Promise<boolean>;
  }) => {
    mockReceivedProps.push({
      bookId: props.bookId,
      title: props.title,
      initialPosition: props.initialPosition,
    });
    /* eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above */
    const { View, Text: RNText } = require('react-native');
    return (
      <View>
        <RNText>{`playing ${props.bookId}`}</RNText>
        <RNText onPress={() => props.onPositionChange?.(42)}>advance</RNText>
        <RNText onPress={() => props.onPositionCommit?.(99)}>commit</RNText>
        <RNText onPress={() => void props.onBeforePlay?.()}>play</RNText>
      </View>
    );
  },
}));

// `render` is ASYNC in @testing-library/react-native v14 — see App.test.tsx's own note.
function renderAudioPlayerRoute(bookId: string, title = 'Audiobook') {
  return render(
    <AudioPlayerRouteScreen
      navigation={{ setOptions: jest.fn() } as never}
      route={{ key: 'AudioPlayer', name: 'AudioPlayer', params: { bookId, title } } as never}
    />,
  );
}

// Which button (by text) to auto-press the MOMENT `Alert.alert` is called — see this file's header.
let mockAlertAutoPress: string | null = null;
const mockAlert = jest
  .spyOn(Alert, 'alert')
  .mockImplementation((_title, _message, buttons) => {
    if (mockAlertAutoPress === null) return;
    const button = (buttons as { text: string; onPress?: () => void }[] | undefined)?.find(
      (candidate) => candidate.text === mockAlertAutoPress,
    );
    button?.onPress?.();
  });

describe('AudioPlayerRouteScreen', () => {
  beforeEach(() => {
    mockReceivedProps.length = 0;
    callOrder.length = 0;
    mockAlertAutoPress = null;
    mockCurrentLocator.mockReset();
    mockSavePosition.mockReset();
    mockSyncRun.mockReset();
    mockAlert.mockClear();
    mockCurrentLocator.mockResolvedValue(null);
    mockSyncRun.mockResolvedValue(undefined);
  });

  it('passes the route bookId and title through to AudioPlayerScreen once resolved, after awaiting a sync run first', async () => {
    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio', 'Audiobook');
    await waitFor(() => expect(getByText('playing dev-sample-audio')).toBeTruthy());
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-audio',
      title: 'Audiobook',
      initialPosition: undefined,
    });
    expect(mockCurrentLocator).toHaveBeenCalledWith(undefined, 'dev-sample-audio');
    // ORDER MATTERS: a local read before the sync lands would resume from a position another
    // device may have already advanced past while this device was merely backgrounded, not
    // relaunched — see AudioPlayerRouteScreen.tsx's header for the full account of that gap.
    expect(callOrder).toEqual(['run', 'currentLocator']);
  });

  it('resumes at the AUDIO position stored in progressStore, converted from ms to seconds', async () => {
    mockCurrentLocator.mockResolvedValue({ type: 'AUDIO', positionMs: 90_000 });

    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-resume');

    await waitFor(() => expect(getByText('playing dev-sample-audio-resume')).toBeTruthy());
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-audio-resume',
      title: 'Audiobook',
      initialPosition: 90,
    });
  });

  it('ignores a stored locator that is not AUDIO-shaped', async () => {
    mockCurrentLocator.mockResolvedValue({ type: 'PDF', page: 4 });

    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-pdf-locator');

    await waitFor(() => expect(getByText('playing dev-sample-audio-pdf-locator')).toBeTruthy());
    expect(mockReceivedProps[0]?.initialPosition).toBeUndefined();
  });

  it('writes a position change into progressStore as an AUDIO locator in milliseconds', async () => {
    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-mirror');
    await waitFor(() => expect(getByText('playing dev-sample-audio-mirror')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByText('advance'));
    });

    expect(mockSavePosition).toHaveBeenCalledWith(
      { type: 'AUDIO', positionMs: 42_000 },
      'dev-sample-audio-mirror',
    );
  });

  it('commit bypasses the write throttle', async () => {
    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-commit');
    await waitFor(() => expect(getByText('playing dev-sample-audio-commit')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByText('advance'));
    });
    mockSavePosition.mockClear();

    // A second onPositionChange inside the throttle window is dropped...
    await act(async () => {
      await fireEvent.press(getByText('advance'));
    });
    expect(mockSavePosition).not.toHaveBeenCalled();

    // ...but a commit at the same moment always writes through.
    await act(async () => {
      await fireEvent.press(getByText('commit'));
    });
    expect(mockSavePosition).toHaveBeenCalledWith(
      { type: 'AUDIO', positionMs: 99_000 },
      'dev-sample-audio-commit',
    );
  });

  describe('the play-gate (onBeforePlay)', () => {
    it('allows play immediately when nothing paused-and-known exists yet — a fresh book', async () => {
      mockCurrentLocator.mockResolvedValueOnce(null);
      const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-gate-fresh');
      await waitFor(() => expect(getByText('play')).toBeTruthy());
      callOrder.length = 0; // clear the resolve effect's own run/currentLocator pair

      await act(async () => {
        await fireEvent.press(getByText('play'));
      });

      // No paused position is known yet, so the gate never re-syncs or re-reads — it just allows.
      expect(callOrder).toEqual([]);
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('allows play when the fresh read is within the 5s tolerance of the paused position', async () => {
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 90_000 });
      const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-gate-close');
      await waitFor(() => expect(getByText('play')).toBeTruthy());

      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 93_000 }); // 3s off
      await act(async () => {
        await fireEvent.press(getByText('play'));
      });

      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('silently adopts a within-tolerance read as the new baseline for the NEXT check', async () => {
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 90_000 });
      const { getByText, unmount } = await renderAudioPlayerRoute('dev-sample-audio-gate-drift');
      await waitFor(() => expect(getByText('play')).toBeTruthy());

      // First press: 3s off (within tolerance) — resolved silently, no alert, but the LWW-resolved
      // 93s becomes this device's confirmed position going forward.
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 93_000 });
      await act(async () => {
        await fireEvent.press(getByText('play'));
      });
      expect(mockAlert).not.toHaveBeenCalled();

      // Second press: a real conflict, far enough from the ADOPTED 93s (not the original 90s) to
      // prompt. If the silent adoption above hadn't updated the baseline, this would still compare
      // against 90s and "Continue here" would push the stale value.
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 200_000 });
      mockAlertAutoPress = 'Continue here';
      await act(async () => {
        await fireEvent.press(getByText('play'));
      });

      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 93_000 },
        'dev-sample-audio-gate-drift',
      );
      await act(async () => {
        unmount();
      });
    });

    it('prompts when the fresh read diverges by more than 5s, and pushes the paused position through on "Continue here"', async () => {
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 90_000 });
      const { getByText, unmount } = await renderAudioPlayerRoute('dev-sample-audio-gate-continue');
      await waitFor(() => expect(getByText('play')).toBeTruthy());

      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 200_000 });
      mockAlertAutoPress = 'Continue here';
      await act(async () => {
        await fireEvent.press(getByText('play'));
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'Playback progress updated',
        expect.any(String),
        expect.any(Array),
        // Compulsory to resolve — not dismissible by tapping outside or the Android back button.
        { cancelable: false },
      );
      // Re-confirms THIS device's (paused) position — 90s, not the incoming 200s.
      expect(mockSavePosition).toHaveBeenCalledWith(
        { type: 'AUDIO', positionMs: 90_000 },
        'dev-sample-audio-gate-continue',
      );
      // No remount: the resolved position for this screen is unchanged.
      expect(mockReceivedProps[mockReceivedProps.length - 1]).toEqual({
        bookId: 'dev-sample-audio-gate-continue',
        title: 'Audiobook',
        initialPosition: 90,
      });
      await act(async () => {
        unmount();
      });
    });

    it('adopts the incoming position and remounts on "Resume from there", without writing', async () => {
      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 90_000 });
      const { getByText, unmount } = await renderAudioPlayerRoute('dev-sample-audio-gate-jump');
      await waitFor(() => expect(getByText('play')).toBeTruthy());

      mockCurrentLocator.mockResolvedValueOnce({ type: 'AUDIO', positionMs: 200_000 });
      mockAlertAutoPress = 'Resume from there';
      await act(async () => {
        await fireEvent.press(getByText('play'));
      });

      expect(mockReceivedProps[mockReceivedProps.length - 1]).toEqual({
        bookId: 'dev-sample-audio-gate-jump',
        title: 'Audiobook',
        initialPosition: 200,
      });
      // Adopting is not itself a write — it's a read the user chose to trust.
      expect(mockSavePosition).not.toHaveBeenCalled();
      await act(async () => {
        unmount();
      });
    });
  });
});
