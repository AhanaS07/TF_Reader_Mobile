// Owner: Reader (Ahana).
//
// Covers AudioPlayerRouteScreen's own contract — wiring route params into AudioPlayerScreen's
// `bookId`/`title` and the session-progress props — not AudioPlayerScreen's own behaviour, which
// has its own test file. Mocked to an inert stub so this only exercises the glue, same pattern
// ReaderRouteScreen.test.tsx uses for ReaderScreen.

import { fireEvent, render } from '@testing-library/react-native';

import { setAudioSessionPosition } from '@/features/reader/audio/audioSessionProgress';

import { AudioPlayerRouteScreen } from './AudioPlayerRouteScreen';

// `mock`-prefixed, per babel-plugin-jest-hoist's naming exception — see ReaderRouteScreen.test.tsx's
// own comment on why this can't just be a plain top-level array.
const mockReceivedProps: { bookId?: string; title?: string; initialPosition?: number }[] = [];

jest.mock('@/features/reader/audio/AudioPlayerScreen', () => ({
  AudioPlayerScreen: (props: {
    bookId: string;
    title: string;
    initialPosition?: number;
    onPositionChange?: (p: number) => void;
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
  });

  it('passes the route bookId and title through to AudioPlayerScreen', async () => {
    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio', 'Audiobook');
    expect(getByText('playing dev-sample-audio')).toBeTruthy();
    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-audio',
      title: 'Audiobook',
      initialPosition: undefined,
    });
  });

  it('resumes at the session position recorded for that book', async () => {
    setAudioSessionPosition('dev-sample-audio-resume', 90);

    await renderAudioPlayerRoute('dev-sample-audio-resume');

    expect(mockReceivedProps[0]).toEqual({
      bookId: 'dev-sample-audio-resume',
      title: 'Audiobook',
      initialPosition: 90,
    });
  });

  it('mirrors a position change back into the session cache', async () => {
    const { getByText } = await renderAudioPlayerRoute('dev-sample-audio-mirror');

    fireEvent.press(getByText('advance'));

    await renderAudioPlayerRoute('dev-sample-audio-mirror');

    expect(mockReceivedProps[1]).toEqual({
      bookId: 'dev-sample-audio-mirror',
      title: 'Audiobook',
      initialPosition: 42,
    });
  });
});
