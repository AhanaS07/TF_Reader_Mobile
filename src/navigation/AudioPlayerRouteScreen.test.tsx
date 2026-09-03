// Owner: Reader (Ahana).
//
// Covers AudioPlayerRouteScreen's own contract — wiring route params into AudioPlayerScreen's
// `bookId`/`title` and the progressStore-backed resume/commit props — not AudioPlayerScreen's own
// behaviour, which has its own test file. Mocked to an inert stub so this only exercises the glue,
// same pattern ReaderRouteScreen.test.tsx uses for ReaderScreen.
//
// progressStore itself is mocked rather than exercised against real SQLite: this file is testing
// AudioPlayerRouteScreen's wiring (does it call currentLocator/savePosition with the right
// arguments, does it gate on the async read), not progressStore's own correctness — that lives in
// src/features/sync/contractConformance.test.ts. syncEngine.run() is mocked too, for the same
// reason — this file checks that it is awaited BEFORE the local read, not that a real sync does
// anything.

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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

describe('AudioPlayerRouteScreen', () => {
  beforeEach(() => {
    mockReceivedProps.length = 0;
    callOrder.length = 0;
    mockCurrentLocator.mockReset();
    mockSavePosition.mockReset();
    mockSyncRun.mockReset();
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
});
