// Owner: Reader (Ahana).
//
// Covers the property the old "temporary fixture picker" tests in App.test.tsx used to pin, now
// re-homed here because the picker itself moved: every fixture is listed, and tapping a row
// navigates to the right route with the right params. `navigation` is a hand-rolled stub rather
// than a real NavigationContainer — this is a unit test of BookListScreen's own render/press
// wiring, not an integration test of react-navigation itself.
//
// openBook() is mocked to succeed immediately — it is the STREAM-intent licence gate that runs
// BEFORE navigation; this test verifies that navigation happens AFTER it succeeds, not that
// openBook itself works (that is licenseCheck.test.ts's job).

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { BookListScreen } from './BookListScreen';
import { openBook } from '@/features/download/openBook';

jest.mock('@/features/download/openBook', () => ({
  openBook: jest.fn().mockResolvedValue(new Uint8Array()),
}));

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
  beforeEach(() => {
    jest.mocked(openBook).mockClear();
    jest.mocked(openBook).mockResolvedValue(new Uint8Array());
  });

  it('lists all five book fixtures plus the TTS demo', async () => {
    const { getByText } = await renderBookList(jest.fn());

    expect(getByText('EPUB')).toBeTruthy();
    expect(getByText('PDF')).toBeTruthy();
    expect(getByText('Big EPUB')).toBeTruthy();
    expect(getByText('Big PDF')).toBeTruthy();
    // The one row NOT backed by a local seed — it names the backend's catalogue item.
    expect(getByText('Audiobook (Encrypted)')).toBeTruthy();
    expect(getByText('TTS Demo')).toBeTruthy();
  });

  it.each([
    ['EPUB', 'dev-sample-epub', 'EPUB'],
    ['PDF', 'dev-sample-pdf', 'PDF'],
    ['Big EPUB', 'dev-fixture-epub', 'EPUB'],
    ['Big PDF', 'dev-fixture-pdf', 'PDF'],
  ])(
    'tapping %s calls openBook then navigates to Reader with { bookId: %s, format: %s }',
    async (label, bookId, format) => {
      const navigate = jest.fn();
      const { getByText } = await renderBookList(navigate);

      fireEvent.press(getByText(label));

      await waitFor(() => {
        expect(openBook).toHaveBeenCalledWith(bookId, format);
        expect(navigate).toHaveBeenCalledWith('Reader', { bookId, format });
      });
    },
  );

  it('does not navigate when openBook rejects', async () => {
    jest.mocked(openBook).mockRejectedValueOnce(new Error('network error'));
    const navigate = jest.fn();
    const { getByText } = await renderBookList(navigate);

    fireEvent.press(getByText('EPUB'));

    // Give the async handler time to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(openBook).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // AUDIO PHASE 3: the one row that does NOT navigate to Reader — pins the open-path diversion
  // this phase added (BookListScreen.tsx's onPress), the one thing standing between an audio book
  // and the (now backstop-only) UNSUPPORTED_FORMAT banner.
  //
  // It does not call openBook() HERE, and that is no longer a gap in the licence gate: the resolver
  // calls openBook() itself on every resolve, inside the player screen. Calling it here too would be
  // undone immediately — the resolver's closeBook() is terminal for a streamed package — so the gate
  // runs once, in the place that can guarantee the bytes are still live when the file is written.
  it('tapping Audiobook navigates to AudioPlayer, not Reader, and does not call openBook here', async () => {
    const navigate = jest.fn();
    const { getByText } = await renderBookList(navigate);

    fireEvent.press(getByText('Audiobook (Encrypted)'));

    expect(navigate).toHaveBeenCalledWith('AudioPlayer', {
      bookId: 'dev-sample-audio-encrypted',
      title: 'Audiobook (Encrypted)',
    });
    expect(navigate).not.toHaveBeenCalledWith('Reader', expect.anything());
    expect(openBook).not.toHaveBeenCalled();
  });

  it('tapping TTS Demo navigates to the TtsDemo route', async () => {
    const navigate = jest.fn();
    const { getByText } = await renderBookList(navigate);

    fireEvent.press(getByText('TTS Demo'));

    expect(navigate).toHaveBeenCalledWith('TtsDemo');
  });
});
