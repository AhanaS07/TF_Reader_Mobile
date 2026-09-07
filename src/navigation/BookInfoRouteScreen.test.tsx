// Owner: Reader (Ahana) for the route glue; the mocked screen's own behaviour is
// AccessibilityInfoScreen.test.tsx's concern (Hruthik).
//
// Covers BookInfoRouteScreen's own contract — wiring the route's bookId param into
// AccessibilityInfoScreen and its onClose back into navigation.goBack() — same pattern
// AudioPlayerRouteScreen.test.tsx/ReaderRouteScreen.test.tsx use for their own route screens.

import { fireEvent, render } from '@testing-library/react-native';

import { BookInfoRouteScreen } from './BookInfoRouteScreen';

// `mock`-prefixed, per babel-plugin-jest-hoist's naming exception — see ReaderRouteScreen.test.tsx's
// own comment on why this can't just be a plain top-level array.
const mockReceivedProps: { bookId?: string }[] = [];

jest.mock('@/features/accessibility/AccessibilityInfoScreen', () => ({
  AccessibilityInfoScreen: (props: { bookId: string; onClose: () => void }) => {
    mockReceivedProps.push({ bookId: props.bookId });
    /* eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above */
    const { View, Text: RNText } = require('react-native');
    return (
      <View>
        <RNText>{`info for ${props.bookId}`}</RNText>
        <RNText onPress={props.onClose}>close</RNText>
      </View>
    );
  },
}));

function renderBookInfoRoute(bookId: string, goBack = jest.fn()) {
  return render(
    <BookInfoRouteScreen
      navigation={{ goBack } as never}
      route={{ key: 'BookInfo', name: 'BookInfo', params: { bookId } } as never}
    />,
  );
}

describe('BookInfoRouteScreen', () => {
  beforeEach(() => {
    mockReceivedProps.length = 0;
  });

  it('passes the route bookId through to AccessibilityInfoScreen', async () => {
    const { getByText } = await renderBookInfoRoute('dev-sample-epub');
    expect(getByText('info for dev-sample-epub')).toBeTruthy();
    expect(mockReceivedProps[0]).toEqual({ bookId: 'dev-sample-epub' });
  });

  it('calls navigation.goBack() when the screen requests a close', async () => {
    const goBack = jest.fn();
    const { getByText } = await renderBookInfoRoute('dev-sample-epub', goBack);

    await fireEvent.press(getByText('close'));

    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
