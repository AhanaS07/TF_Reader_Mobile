// Owner: Reader (Ahana).
//
// Covers ReaderRouteScreen's own contract — wiring route params into ReaderScreen's `bookId` and
// the progressStore-backed resume/write props — not ReaderScreen's or DevPreferencesMenu's own
// behaviour, which have their own test files. Both are mocked to inert stubs so this only exercises
// the glue, same pattern AudioPlayerRouteScreen.test.tsx uses.
//
// progressStore itself is mocked rather than exercised against real SQLite: this file tests
// ReaderRouteScreen's wiring (does it call currentLocator/savePosition with the right arguments),
// not progressStore's own correctness — that lives in src/features/sync/contractConformance.test.ts.
// syncEngine.run() is mocked too, for the same reason — this file checks that it is awaited BEFORE
// the local read, not that a real sync actually does anything.
//
// There is no in-session cache to test here any more — every resume read goes through
// progressStore, including the caller-supplied-target case, which is why every test below awaits
// the resolved state rather than asserting synchronously. See ReaderRouteScreen.tsx's header for
// why an earlier, faster-looking version of this file's subject was wrong to keep one.

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { Locator } from '@/shared/contracts';

import { ReaderRouteScreen } from './ReaderRouteScreen';

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

// `mock`-prefixed, per babel-plugin-jest-hoist's naming exception: jest.mock() factories may not
// otherwise close over an out-of-scope variable, since the mock call is hoisted above this file's
// other top-level statements.
const mockReceivedProps: { bookId?: string; initialTarget?: unknown }[] = [];

jest.mock('@/features/reader/ReaderScreen', () => ({
  ReaderScreen: (props: {
    bookId: string;
    initialTarget?: unknown;
    onRelocated?: (p: unknown) => void;
  }) => {
    mockReceivedProps.push({ bookId: props.bookId, initialTarget: props.initialTarget });
    // require(), not a top-level import: babel-plugin-jest-hoist forbids a jest.mock() factory
    // from closing over any out-of-scope import binding (only `mock`-prefixed variables and a
    // handful of globals are allowed) — same reasoning as mockReceivedProps's naming above.
    /* eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above */
    const { View, Text: RNText } = require('react-native');
    return (
      <View>
        <RNText>{`reading ${props.bookId}`}</RNText>
        <RNText onPress={() => props.onRelocated?.({ kind: 'page', page: 7, pageCount: 20 })}>
          relocate
        </RNText>
      </View>
    );
  },
}));

jest.mock('../../DevPreferencesMenu', () => ({
  DevPreferencesMenu: () => null,
}));

// `render` is ASYNC in @testing-library/react-native v14 — see App.test.tsx's own note.
function renderReaderRoute(bookId: string, initialTarget?: unknown) {
  return render(
    <ReaderRouteScreen
      navigation={{ setOptions: jest.fn() } as never}
      route={
        { key: 'Reader', name: 'Reader', params: { bookId, format: 'EPUB', initialTarget } } as never
      }
    />,
  );
}

describe('ReaderRouteScreen', () => {
  beforeEach(() => {
    mockReceivedProps.length = 0;
    callOrder.length = 0;
    mockCurrentLocator.mockReset();
    mockSavePosition.mockReset();
    mockSyncRun.mockReset();
    mockCurrentLocator.mockResolvedValue(null);
    mockSyncRun.mockResolvedValue(undefined);
  });

  it('resumes at the locator stored in progressStore, after awaiting a sync run first', async () => {
    mockCurrentLocator.mockResolvedValue({ type: 'PDF', page: 12 });

    const { getByText } = await renderReaderRoute('dev-sample-epub-durable');

    await waitFor(() => expect(getByText('reading dev-sample-epub-durable')).toBeTruthy());
    expect(mockCurrentLocator).toHaveBeenCalledWith(undefined, 'dev-sample-epub-durable');
    // ORDER MATTERS: a local read before the sync lands would resume from a position another
    // device may have already advanced past while this device was merely backgrounded, not
    // relaunched — see ReaderRouteScreen.tsx's header for the full account of that gap.
    expect(callOrder).toEqual(['run', 'currentLocator']);
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-epub-durable',
      initialTarget: { kind: 'page', page: 12 },
    });
  });

  it('prefers a route-supplied initial target and skips both the sync run and the progressStore read', async () => {
    const { getByText } = await renderReaderRoute('dev-sample-epub-bookmark', {
      kind: 'href',
      href: 'epubcfi(/6/10)',
    });

    await waitFor(() => expect(getByText('reading dev-sample-epub-bookmark')).toBeTruthy());
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-epub-bookmark',
      initialTarget: { kind: 'href', href: 'epubcfi(/6/10)' },
    });
    expect(mockCurrentLocator).not.toHaveBeenCalled();
    expect(mockSyncRun).not.toHaveBeenCalled();
  });

  it('opens with no initial target for a book with nothing stored', async () => {
    const { getByText } = await renderReaderRoute('dev-sample-epub-fresh');

    await waitFor(() => expect(getByText('reading dev-sample-epub-fresh')).toBeTruthy());
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-epub-fresh',
      initialTarget: undefined,
    });
  });

  it('ignores a stored locator that belongs to an AUDIO book', async () => {
    mockCurrentLocator.mockResolvedValue({ type: 'AUDIO', positionMs: 90_000 });

    const { getByText } = await renderReaderRoute('dev-sample-epub-audio-locator');

    await waitFor(() => expect(getByText('reading dev-sample-epub-audio-locator')).toBeTruthy());
    expect(mockReceivedProps[0]?.initialTarget).toBeUndefined();
  });

  it('writes a relocated position into progressStore as a PDF-shaped locator', async () => {
    const { getByText } = await renderReaderRoute('dev-sample-epub-mirror');
    await waitFor(() => expect(getByText('relocate')).toBeTruthy());

    // AWAITED, AND THAT IS LOAD-BEARING. `fireEvent` is awaitable in @testing-library/react-native
    // v14 and does its own `act()` wrapping (same note ReaderScreen.test.tsx carries). Dropped, the
    // act scope never closes, and every test that runs AFTER this one renders NOTHING — the mocked
    // screen is simply never called, so the failures read as "unable to find text" rather than as
    // anything to do with this line. Invisible in declaration order because this is the last test
    // in the file, and `jest --randomize` is what surfaced it. Type-aware `no-floating-promises`
    // would have caught it, but it is scoped to `src/features/reader/**` (eslint.config.js) and
    // this file is `src/navigation/`.
    await fireEvent.press(getByText('relocate'));

    expect(mockSavePosition).toHaveBeenCalledWith(
      { type: 'PDF', page: 7 },
      'dev-sample-epub-mirror',
    );
  });

  it('drops a relocated write inside the throttle window, but still flushes it on unmount', async () => {
    const { getByText, unmount } = await renderReaderRoute('dev-sample-epub-throttle');
    await waitFor(() => expect(getByText('relocate')).toBeTruthy());

    await fireEvent.press(getByText('relocate'));
    expect(mockSavePosition).toHaveBeenCalledTimes(1);
    mockSavePosition.mockClear();

    // A second relocate inside the throttle window is dropped...
    await fireEvent.press(getByText('relocate'));
    expect(mockSavePosition).not.toHaveBeenCalled();

    // ...but unmounting (e.g. navigating back) flushes the latest position through regardless.
    await act(async () => {
      unmount();
    });
    expect(mockSavePosition).toHaveBeenCalledWith(
      { type: 'PDF', page: 7 },
      'dev-sample-epub-throttle',
    );
  });
});
