// Owner: Reader (Ahana).
//
// First test file for this component. It renders ReaderWebView standalone — no ReaderScreen
// harness needed, since this component takes sourceUri directly (no async book-open resolution)
// and its dependencies are five simple callback props. Mocks react-native-webview the same way
// ReaderScreen.test.tsx does (a usable ref for injectJavaScript, overriding jest.setup.js's inert
// <View>), because ReaderWebView calls webViewRef.current?.injectJavaScript for its own `send`.
//
// Covers TALKBACK_GESTURE_FIX_PROPOSAL.md's page-turn action: the accessibilityActions/
// onAccessibilityAction pair lives on a DEDICATED sibling node, never on the container — the
// regression guard below pins exactly that, since putting it on the container reintroduces the
// accessibilityLabel container-leaf trap this file's own `accessibilityLabel` prop doc describes.

import { act, render, screen } from '@testing-library/react-native';

import { ReaderWebView } from '@/features/reader/ReaderWebView';
import type { ReaderWebViewProps } from '@/features/reader/ReaderWebView';

jest.mock('react-native-webview', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const injectJavaScript = jest.fn();

  const WebView = ReactModule.forwardRef(function MockWebView(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ injectJavaScript, stopLoading: jest.fn() }));
    return ReactModule.createElement(View, { testID: 'reader-webview', ...props });
  });

  return { WebView, __injectJavaScript: injectJavaScript };
});

const { __injectJavaScript } = jest.requireMock('react-native-webview') as {
  __injectJavaScript: jest.Mock;
};

// `render` is async in this version of @testing-library/react-native — `screen` isn't bound until
// its promise resolves, so every call site below awaits this helper.
async function renderWebView(props?: Partial<ReaderWebViewProps>) {
  return render(
    <ReaderWebView
      sourceUri="file:///fake.html"
      onMessage={jest.fn()}
      onHostError={jest.fn()}
      onReady={jest.fn()}
      onHighlightRequested={jest.fn()}
      onDeleteHighlightRequested={jest.fn()}
      {...props}
    />,
  );
}

/** Delivers `ready` the way the device does — a raw JSON string through onMessage — so it routes
 * through the real handler and flips the real `isReady` state, not a hand-set flag. Calls the prop
 * directly inside `act`, mirroring ReaderScreen.test.tsx's own `deliver` helper, rather than
 * `fireEvent`: `isReady`'s state update needs to be flushed before the next line runs, and an
 * un-awaited `fireEvent` on this library version leaves it mid-flight. */
async function reportReady(): Promise<void> {
  // includeHiddenElements: this is the BRIDGE, not a user traversal — same reasoning as
  // ReaderScreen.test.tsx's own `deliver` helper.
  const webView = screen.getByTestId('reader-webview', { includeHiddenElements: true });
  await act(async () => {
    webView.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  });
}

async function firePageTurnAction(actionName: 'increment' | 'decrement'): Promise<void> {
  const pageTurn = screen.getByTestId('reader-webview-a11y-pageturn');
  await act(async () => {
    pageTurn.props.onAccessibilityAction({ nativeEvent: { actionName } });
  });
}

beforeEach(() => {
  __injectJavaScript.mockClear();
});

describe('page-turn accessibility action', () => {
  it('exposes increment/decrement on a dedicated sibling, never on the container', async () => {
    await renderWebView();

    const pageTurn = screen.getByTestId('reader-webview-a11y-pageturn');
    expect(pageTurn.props.accessibilityRole).toBe('adjustable');
    expect(pageTurn.props.accessibilityActions).toEqual([
      { name: 'increment', label: 'Next page' },
      { name: 'decrement', label: 'Previous page' },
    ]);

    // THE REGRESSION GUARD: this is the exact defect TALKBACK_GESTURE_FIX_PROPOSAL.md's Resolution
    // addendum found in the original sketch. If these props ever migrate back onto the container,
    // TalkBack stops descending into the WebView's tree — see ReaderWebView.tsx's own
    // accessibilityLabel doc and CLAUDE.md's reader-accessibility rule #5 for the mechanism.
    const container = screen.getByTestId('reader-webview-container');
    expect(container.props.accessibilityActions).toBeUndefined();
    expect(container.props.accessibilityRole).toBeUndefined();
    expect(container.props.accessibilityLabel).toBeUndefined();
  });

  it('does not disturb the existing a11y-stop node', async () => {
    await renderWebView({ accessibilityLabel: 'Book content' });

    const stop = screen.getByTestId('reader-webview-a11y-stop');
    expect(stop.props.accessibilityRole).toBe('header');
    expect(stop.props.accessibilityLabel).toBe('Book content');
  });

  it('is present even when the accessibilityLabel prop is undefined, unlike the named stop', async () => {
    await renderWebView({ accessibilityLabel: undefined });

    expect(screen.queryByTestId('reader-webview-a11y-stop')).toBeNull();
    expect(screen.getByTestId('reader-webview-a11y-pageturn')).toBeTruthy();
  });

  it('does nothing before ready', async () => {
    const onPageTurnRequested = jest.fn();
    await renderWebView({ onPageTurnRequested });

    await firePageTurnAction('increment');
    await firePageTurnAction('decrement');

    expect(onPageTurnRequested).not.toHaveBeenCalled();
    expect(__injectJavaScript).not.toHaveBeenCalled();
  });

  it('calls onPageTurnRequested("next") for increment once ready', async () => {
    const onPageTurnRequested = jest.fn();
    await renderWebView({ onPageTurnRequested });

    await reportReady();
    await firePageTurnAction('increment');

    expect(onPageTurnRequested).toHaveBeenCalledWith('next');
  });

  it('calls onPageTurnRequested("prev") for decrement once ready', async () => {
    const onPageTurnRequested = jest.fn();
    await renderWebView({ onPageTurnRequested });

    await reportReady();
    await firePageTurnAction('decrement');

    expect(onPageTurnRequested).toHaveBeenCalledWith('prev');
  });

  it('tolerates a missing onPageTurnRequested (optional prop)', async () => {
    await renderWebView();

    await reportReady();
    await expect(firePageTurnAction('increment')).resolves.not.toThrow();
  });
});
