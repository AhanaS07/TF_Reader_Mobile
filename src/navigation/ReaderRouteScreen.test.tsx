// Owner: Reader (Ahana).
//
// Covers ReaderRouteScreen's own contract — wiring route params into ReaderScreen's `bookId` and
// the session-progress props — not ReaderScreen's or DevPreferencesMenu's own behaviour, which
// have their own test files. Both are mocked to inert stubs so this only exercises the glue.

import { fireEvent, render } from '@testing-library/react-native';

import { setSessionPosition } from '@/features/reader/sessionProgress';

import { ReaderRouteScreen } from './ReaderRouteScreen';

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
function renderReaderRoute(bookId: string) {
  return render(
    <ReaderRouteScreen
      navigation={{ setOptions: jest.fn() } as never}
      route={{ key: 'Reader', name: 'Reader', params: { bookId, format: 'EPUB' } } as never}
    />,
  );
}

describe('ReaderRouteScreen', () => {
  beforeEach(() => {
    mockReceivedProps.length = 0;
  });

  it('passes the route bookId through to ReaderScreen', async () => {
    const { getByText } = await renderReaderRoute('dev-sample-epub');
    expect(getByText('reading dev-sample-epub')).toBeTruthy();
  });

  it('resumes at the session position recorded for that book, and mirrors new positions back', async () => {
    setSessionPosition('dev-sample-epub-resume', { kind: 'page', page: 5, pageCount: 20 });

    await renderReaderRoute('dev-sample-epub-resume');

    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-epub-resume',
      initialTarget: { kind: 'page', page: 5 },
    });
  });

  it('opens with no initial target for a book with no recorded session position', async () => {
    await renderReaderRoute('dev-sample-epub-fresh');

    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-epub-fresh',
      initialTarget: undefined,
    });
  });

  it('mirrors a relocated position back into the session cache', async () => {
    const { getByText } = await renderReaderRoute('dev-sample-epub-mirror');

    fireEvent.press(getByText('relocate'));

    await renderReaderRoute('dev-sample-epub-mirror');

    expect(mockReceivedProps[1]).toEqual({
      bookId: 'dev-sample-epub-mirror',
      initialTarget: { kind: 'page', page: 7 },
    });
  });
});
