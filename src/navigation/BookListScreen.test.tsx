// Owner: Reader (Ahana).
//
// Covers the property the old "temporary fixture picker" tests in App.test.tsx used to pin, now
// re-homed here because the picker itself moved: every fixture is listed, and tapping a row
// navigates to the right route with the right params. `navigation` is a hand-rolled stub rather
// than a real NavigationContainer — this is a unit test of BookListScreen's own render/press
// wiring, not an integration test of react-navigation itself.
//
// No mock needed for devContentSeed.ts's own imports (expo-asset, react-native-quick-crypto, the
// encryption stack) — none of it runs at import time, only inside ensureSeeded(), which this test
// never triggers (no row press reaches ReaderScreen here).

import { fireEvent, render } from '@testing-library/react-native';

import { BookListScreen } from './BookListScreen';

// `render` is ASYNC in @testing-library/react-native v14 — see App.test.tsx's own note.
function renderBookList(navigate: jest.Mock) {
  return render(
    <BookListScreen
      navigation={{ navigate } as never}
      route={{ key: 'BookList', name: 'BookList' } as never}
    />,
  );
}

describe('BookListScreen', () => {
  it('lists all five book fixtures plus the TTS demo', async () => {
    const { getByText } = await renderBookList(jest.fn());

    expect(getByText('EPUB')).toBeTruthy();
    expect(getByText('PDF')).toBeTruthy();
    expect(getByText('Big EPUB')).toBeTruthy();
    expect(getByText('Big PDF')).toBeTruthy();
    expect(getByText('Audiobook')).toBeTruthy();
    expect(getByText('TTS Demo')).toBeTruthy();
  });

  it.each([
    ['EPUB', 'dev-sample-epub', 'EPUB'],
    ['PDF', 'dev-sample-pdf', 'PDF'],
    ['Big EPUB', 'dev-fixture-epub', 'EPUB'],
    ['Big PDF', 'dev-fixture-pdf', 'PDF'],
  ])(
    'tapping %s navigates to Reader with { bookId: %s, format: %s }',
    async (label, bookId, format) => {
      const navigate = jest.fn();
      const { getByText } = await renderBookList(navigate);

      fireEvent.press(getByText(label));

      expect(navigate).toHaveBeenCalledWith('Reader', { bookId, format });
    },
  );

  // AUDIO PHASE 3: the one row that does NOT navigate to Reader — pins the open-path diversion
  // this phase added (BookListScreen.tsx's onPress), the one thing standing between an audio book
  // and the (now backstop-only) UNSUPPORTED_FORMAT banner.
  it('tapping Audiobook navigates to AudioPlayer, not Reader', async () => {
    const navigate = jest.fn();
    const { getByText } = await renderBookList(navigate);

    fireEvent.press(getByText('Audiobook'));

    expect(navigate).toHaveBeenCalledWith('AudioPlayer', {
      bookId: 'dev-sample-audio',
      title: 'Audiobook',
    });
    expect(navigate).not.toHaveBeenCalledWith('Reader', expect.anything());
  });

  it('tapping TTS Demo navigates to the TtsDemo route', async () => {
    const navigate = jest.fn();
    const { getByText } = await renderBookList(navigate);

    fireEvent.press(getByText('TTS Demo'));

    expect(navigate).toHaveBeenCalledWith('TtsDemo');
  });
});
