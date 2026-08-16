// Owner: Reader (Ahana).
//
// Coverage for the parts of ReaderScreen a unit test can actually reach: the
// Contents panel and the chrome around it. The reader itself — epub.js,
// pagination, anything visual — only exists on a device. jest.setup.js replaces
// react-native-webview with an inert <View>, so nothing here asserts against a
// rendition, and a test that pretended otherwise would be asserting against the
// mock.
//
// What it DOES assert is that the host half handles a `toc` message the way a
// real book delivers one: dozens of entries, nested, with duplicate hrefs.
//
// NOT ASSERTED, AND DELIBERATELY: that the list scrolls. It was suspected of not
// scrolling and it does — measured on the iPhone 17 Pro simulator on 2026-08-14
// against the 22-entry fixture TOC, with no flex style on the ScrollView at all:
// frame 600pt against 1054pt of content. RN's ScrollView carries
// flexGrow/flexShrink: 1 in its own base style, so it is bounded by its parent
// already. Jest has no layout engine, so no test here could have told us that
// either way — the number came from the device, and it is recorded next to the
// ScrollView so the no-op "fix" is not reattempted.
//
// WHY THE TWO SEAMS ARE MOCKED: getReaderHtmlUri() resolves a bundled asset
// through expo-asset, and under Jest `require('*.html')` is a numeric stub that
// Asset.fromModule cannot resolve — the screen would sit on ASSET_LOAD_FAILED and
// never mount a WebView to send messages to. Mocking readerAssets also keeps the
// whole encryption stack out of a chrome test; the bytes path has its own
// coverage in wholeBookBudget.test.ts. Only the seams are mocked, never the logic
// under test.

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { getBookBase64 } from '@/features/reader/readerAssets';
import type { ReaderTocItem } from '@/features/reader/readerBridge';

jest.mock('@/features/reader/readerAssets', () => ({
  getReaderHtmlUri: jest.fn(() => Promise.resolve('file:///reader.html')),
  getBookBase64: jest.fn(() => Promise.resolve('UEsDBA==')),
}));

jest.mock('@/features/encryption/contentProvider', () => ({
  closeBook: jest.fn(() => Promise.resolve()),
}));

/**
 * Deliver a bridge message the way the device does: as a raw JSON string through
 * the WebView's onMessage. That routes through the real ReaderWebView handler and
 * the real parseReaderMessage, so a payload this test can build but the parser
 * would reject fails here rather than passing on a hand-made object.
 */
async function deliver(message: unknown): Promise<void> {
  const webView = screen.getByTestId('reader-webview');
  await act(async () => {
    webView.props.onMessage({ nativeEvent: { data: JSON.stringify(message) } });
  });
}

/**
 * Report `ready` the way the WebView does once its IIFE has defined window.TFReader.
 *
 * REQUIRED BEFORE ANYTHING TOUCHES THE BYTE PATH: `getBookBase64` is called from
 * `onReady`, so without this the open never starts at all — and a test that asserts
 * "no timeout fired" would pass for the wrong reason.
 */
async function reportReady(): Promise<void> {
  await deliver({ type: 'ready' });
}

async function mountReader(): Promise<void> {
  await render(<ReaderScreen bookId="test-book" />);
  // The WebView only mounts once getReaderHtmlUri() resolves.
  await screen.findByTestId('reader-webview');
}

/**
 * Press the Contents button. Targets the Pressable by role rather than its inner
 * Text: `press` needs the element that owns the touch responder, and the label is
 * a child of it.
 */
async function openContents(count: number): Promise<void> {
  // `fireEvent` is awaitable in @testing-library/react-native v14 — it does its own
  // act() wrapping and returns a promise, so dropping the await is a lint error
  // here (no-floating-promises is on for this directory) as well as a race.
  await fireEvent.press(screen.getByRole('button', { name: `Contents (${count})` }));
}

function flatToc(count: number): ReaderTocItem[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `Chapter ${i + 1}`,
    href: `ch${i + 1}.xhtml`,
    depth: 0,
  }));
}

describe('the bounded wait on the byte path', () => {
  // Fake timers, because the real bound is 20s and no test should take 20s. Set up
  // per-test rather than for the file: the panel tests above rely on real
  // microtask/timer behaviour through @testing-library's async helpers.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.mocked(getBookBase64).mockResolvedValue('UEsDBA==');
  });

  it('surfaces a timeout as its own code once the wait elapses', async () => {
    // A byte path that never settles is exactly what a reachable-but-unresponsive
    // backend produces: verifyReadingAccess's fetch has no AbortSignal, so it hangs
    // on the socket rather than rejecting. Before the bound, this presented as
    // "Opening book…" forever with no error at all.
    jest.mocked(getBookBase64).mockReturnValue(new Promise<string>(() => {}));

    await mountReader();
    await reportReady();

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });

    expect(screen.getByText('CONTENT_LOAD_TIMEOUT')).toBeTruthy();
    // NOT the generic failure code: "could not open this book" would send a reader
    // looking at the book when the problem is the network.
    expect(screen.queryByText('CONTENT_LOAD_FAILED')).toBeNull();
  });

  it('does not fire once the bytes have arrived', async () => {
    // The timer has to be cleared on success. If it is not, every successful open
    // raises a timeout banner over an already-rendered book 20s later.
    await mountReader();
    await reportReady();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.queryByText('CONTENT_LOAD_TIMEOUT')).toBeNull();
  });

  it('reports a real failure as a failure, not as a timeout', async () => {
    // The bound must not swallow the distinction it was added to preserve: a byte
    // path that settles with an error is a different problem from one that never
    // settles, and only the second is about the network.
    jest.mocked(getBookBase64).mockRejectedValue(new Error('ciphertext is corrupt'));

    await mountReader();
    await reportReady();
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });

    expect(screen.getByText('CONTENT_LOAD_FAILED')).toBeTruthy();
    expect(screen.queryByText('CONTENT_LOAD_TIMEOUT')).toBeNull();
  });
});

describe('ReaderScreen Contents panel', () => {
  it('opens on the Contents button and lists every entry the book sent', async () => {
    await mountReader();
    await deliver({ type: 'toc', items: flatToc(40) });

    // The count in the label is the only signal that the TOC arrived at all.
    await openContents(40);

    // The LAST entry, not the first: a clipped list still renders its head.
    expect(screen.getByText('Chapter 40')).toBeTruthy();
  });

  it('indents nested chapters by depth and still lists them', async () => {
    // A real book's nav document is a tree: the top level is often just parts, and
    // the chapters hang off it. Until the template flattened `subitems`, everything
    // below the top level was absent from this panel — not below the fold, absent.
    await mountReader();
    await deliver({
      type: 'toc',
      items: [
        { label: 'Part One', href: 'part1.xhtml', depth: 0 },
        { label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 },
        { label: 'Section 1.1', href: 'ch1.xhtml#s1', depth: 2 },
      ],
    });
    await openContents(3);

    // Present at all — the point of the flatten.
    expect(screen.getByText('Section 1.1')).toBeTruthy();

    // And visibly nested. paddingLeft, not marginLeft: the row stays fully
    // tappable at depth.
    const rowFor = (label: string) => screen.getByText(label).parent;
    expect(rowFor('Part One')?.props.style).toMatchObject([{}, { paddingLeft: 0 }]);
    expect(rowFor('Chapter 1')?.props.style).toMatchObject([{}, { paddingLeft: 16 }]);
    expect(rowFor('Section 1.1')?.props.style).toMatchObject([{}, { paddingLeft: 32 }]);
  });

  it('fades only the edges the list actually continues past', async () => {
    // The numbers are the ones measured on the device with this fixture's 22-entry
    // TOC (frame 600pt, content 1054pt), so this test describes a real geometry rather
    // than a convenient one.
    await mountReader();
    await deliver({ type: 'toc', items: flatToc(40) });
    await openContents(40);

    const list = screen.getByTestId('reader-toc-list');
    // Awaited individually rather than batched inside act(): fireEvent does its own
    // act() wrapping in v14, so nesting them logs "overlapping act() calls".
    await fireEvent(list, 'layout', { nativeEvent: { layout: { height: 600 } } });
    await fireEvent(list, 'contentSizeChange', 0, 1054);

    // At the top: entries continue below, nothing is hidden above.
    expect(screen.queryByTestId('reader-toc-fade-bottom')).toBeTruthy();
    expect(screen.queryByTestId('reader-toc-fade-top')).toBeNull();

    // Scrolled to the very end: the mirror image. Getting this wrong leaves a white
    // veil over the last entry, which is the same defect the fade exists to fix.
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 454 } } });
    expect(screen.queryByTestId('reader-toc-fade-bottom')).toBeNull();
    expect(screen.queryByTestId('reader-toc-fade-top')).toBeTruthy();
  });

  it('fades neither edge when the whole list fits', async () => {
    // A short TOC emits no scroll event at all, so this case is only reachable through
    // onLayout/onContentSizeChange — and it is the common one: most books' TOCs fit.
    await mountReader();
    await deliver({ type: 'toc', items: flatToc(3) });
    await openContents(3);

    const list = screen.getByTestId('reader-toc-list');
    await fireEvent(list, 'layout', { nativeEvent: { layout: { height: 600 } } });
    await fireEvent(list, 'contentSizeChange', 0, 180);

    expect(screen.queryByTestId('reader-toc-fade-top')).toBeNull();
    expect(screen.queryByTestId('reader-toc-fade-bottom')).toBeNull();
  });

  it('keeps the Contents button disabled until a TOC arrives', async () => {
    await mountReader();

    // A book with no navigation document is legitimate; the panel must not be
    // openable onto an empty list.
    expect(
      screen.getByRole('button', { name: 'Contents (0)' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });
});
