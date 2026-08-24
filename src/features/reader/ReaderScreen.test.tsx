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
import { StyleSheet } from 'react-native';

import { closeBook } from '@/features/encryption/contentProvider';
import { loadFontFaceSrc } from '@/features/personalization/fontFaceLoader';
import { prefsStore } from '@/features/personalization/prefsStore';
import { toReaderAppearance } from '@/features/personalization/readerAppearance';
import type { AppearanceEnv } from '@/features/personalization/readerAppearance';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import {
  getBookBase64,
  getReaderHtmlUri,
  prepareBook,
  UnsupportedFormatError,
} from '@/features/reader/readerAssets';
import { buildCommandScript } from '@/features/reader/readerBridge';
import type { ReaderTocItem } from '@/features/reader/readerBridge';
import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';
import { queryBookIndex } from '@/features/search/queryBookIndex';
import { DEFAULT_PREFS } from '@/shared/contracts';
import type { ContentFormat, SearchHit, SharedPrefs } from '@/shared/contracts';

/**
 * The byte/asset seam. `prepareBook` decides the format, which decides BOTH the shell
 * URI and the open command, so it is the one mock a format test has to move.
 *
 * `UnsupportedFormatError` is the real class, not a stub: ReaderScreen maps it to
 * UNSUPPORTED_FORMAT with `instanceof`, so a stubbed one would never match and the
 * AUDIO test would pass through the generic ASSET_LOAD_FAILED branch instead —
 * green, and testing the wrong path.
 */
jest.mock('@/features/reader/readerAssets', () => {
  const actual = jest.requireActual<typeof import('@/features/reader/readerAssets')>(
    '@/features/reader/readerAssets',
  );
  return {
    UnsupportedFormatError: actual.UnsupportedFormatError,
    prepareBook: jest.fn(() => Promise.resolve('EPUB')),
    getReaderHtmlUri: jest.fn((format: string) =>
      Promise.resolve(`file:///reader-${format.toLowerCase()}.html`),
    ),
    getBookBase64: jest.fn(() => Promise.resolve('UEsDBA==')),
  };
});

jest.mock('@/features/encryption/contentProvider', () => ({
  closeBook: jest.fn(() => Promise.resolve()),
}));

/**
 * The TTS native-module seam. `ReaderScreen` now calls `useTtsSession` unconditionally (Rules of
 * Hooks — see its own note), and `useTtsSession` imports `@iternio/react-native-tts` via
 * `ttsEngine.ts`. That package ships ES module syntax Jest's default transform does not parse, so
 * every test here needs this mocked regardless of whether it exercises TTS — same seam
 * `useTtsSession.test.ts` mocks, at the same path, for the same reason.
 */
jest.mock('@/features/accessibility/tts/ttsEngine', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    speak: jest.fn(() => Promise.resolve('utterance-1')),
    stop: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve(true)),
    resume: jest.fn(() => Promise.resolve(true)),
    setDefaultRate: jest.fn(() => Promise.resolve(true)),
    setDefaultPitch: jest.fn(() => Promise.resolve(true)),
    setDefaultVoice: jest.fn(() => Promise.resolve(true)),
    voices: jest.fn(() => Promise.resolve([])),
  },
}));

/**
 * Mock the SEARCH SEAM, not contentProvider's getIndex behind it.
 *
 * Required, not merely convenient: the real queryBookIndex imports getIndex from
 * contentProvider, and the factory above deliberately supplies only closeBook — so an
 * unmocked search call dies with "getIndex is not a function", which reads like a
 * search bug rather than a missing mock. Widening that factory instead would drag
 * contentStore, expo-file-system and the keychain into a chrome test.
 */
jest.mock('@/features/search/queryBookIndex', () => ({
  queryBookIndex: jest.fn(() => Promise.resolve([])),
}));

/**
 * A named alias, not an inline `(prefs: SharedPrefs) => void` inside the factory below:
 * babel-plugin-jest-hoist's out-of-scope-variable check mis-parses an inline function-type
 * parameter name as a variable reference (a known quirk, not a real scope violation), and fails
 * the whole factory. Declaring it here, outside jest.mock()'s callback, avoids the parameter name
 * ever appearing inside the checked scope.
 */
type PrefsListener = (prefs: SharedPrefs) => void;

/**
 * The prefs-application seam. Mocked rather than exercised through the real (SQLite-backed)
 * store for the same reason the byte path is mocked above: this file is chrome coverage, and
 * `prefsStore`'s own contract (subscribe/notify semantics, SQLite round-tripping) has its own
 * tests in prefsStore.test.ts. `__emitPrefsChange` mirrors the `__injectJavaScript` convention
 * below — the one hook a test needs to drive the mock from outside.
 */
jest.mock('@/features/personalization/prefsStore', () => {
  const listeners = new Set<PrefsListener>();
  return {
    prefsStore: {
      getPrefs: jest.fn(),
      subscribe: jest.fn((listener: PrefsListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
    __emitPrefsChange: (prefs: SharedPrefs) => {
      for (const listener of listeners) listener(prefs);
    },
  };
});

const { __emitPrefsChange } = jest.requireMock('@/features/personalization/prefsStore') as {
  __emitPrefsChange: (prefs: SharedPrefs) => void;
};

/**
 * The OS half of `applyAppearance`'s inputs. Mocked for determinism: the real hook reads RN's
 * `Appearance`/`AccessibilityInfo`/`PixelRatio`, none of which this chrome test has any reason to
 * depend on the actual jest-preset defaults for.
 */
jest.mock('@/features/reader/useAppearanceEnv', () => ({
  useAppearanceEnv: jest.fn(),
}));

/**
 * The custom-font byte-loading seam. Mocked for the same reason `readerAssets` is: the real
 * implementation is native (expo-asset/expo-file-system), and its own contract ("null for
 * 'system'/unknown, a data: URI otherwise, never throws") is this mock's job to honour, not to
 * re-verify — that's fontFaceLoader's own concern. Defaults to `null`, matching every test's default
 * `font.family: 'system'`, so the existing `applyAppearance` assertions below (which compare against
 * `toReaderAppearance` directly) are unaffected unless a test opts into a real family.
 */
jest.mock('@/features/personalization/fontFaceLoader', () => ({
  loadFontFaceSrc: jest.fn(() => Promise.resolve(null)),
}));

const LIGHT_ENV: AppearanceEnv = {
  osColorScheme: 'light',
  osFontScale: 1,
  osReduceMotionEnabled: false,
};

/** A complete SharedPrefs, so toReaderAppearance never sees a partial record. Fresh identity
 * fields and a structuredClone of DEFAULT_PREFS per call, guarding against cross-test mutation. */
function makePrefs(overrides: Partial<SharedPrefs> = {}): SharedPrefs {
  return {
    ...structuredClone(DEFAULT_PREFS),
    id: 'prefs-1',
    userId: 'user-1',
    updatedAt: 0,
    isDeleted: false,
    synced: false,
    ...overrides,
  };
}

// Sane defaults for every test in this file, most of which have no opinion on appearance at all —
// without this, `prefsStore.getPrefs()` resolves `undefined` and `applyAppearanceWith`'s catch
// swallows the resulting throw, which happens to leave every existing assertion (all of which read
// the LAST or a RELATIVE injectJavaScript call, never an absolute count) unaffected either way. Set
// explicitly anyway so the applyAppearance-specific tests below have a real baseline to diff from.
beforeEach(() => {
  jest.mocked(useAppearanceEnv).mockReturnValue(LIGHT_ENV);
  jest.mocked(prefsStore.getPrefs).mockResolvedValue(makePrefs());
  jest.mocked(loadFontFaceSrc).mockResolvedValue(null);
});

/**
 * A WebView mock with a usable ref, overriding the inert one in jest.setup.js.
 *
 * The global mock is a bare <View>, whose host instance has no injectJavaScript — so
 * `send` optional-chains to nothing and every command vanishes silently. That is fine
 * for the Contents tests, which assert on rendered chrome, but it would make "tapping
 * a search hit navigates" untestable. This keeps the same testID and prop spreading,
 * and adds the two ref methods ReaderWebView actually calls.
 */
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
    target: { kind: 'href', href: `ch${i + 1}.xhtml` },
    depth: 0,
  }));
}

/** A PDF Contents row, for the cases that used to be unrepresentable in one shared string. */
function pdfToc(pages: number[]): ReaderTocItem[] {
  return pages.map((page) => ({
    label: `Page ${page}`,
    target: { kind: 'page', page },
    depth: 0,
  }));
}

describe('a PDF Contents row', () => {
  // THE CASE THAT USED TO BE UNREPRESENTABLE IN A SHARED STRING. A PDF outline row arrived as
  // `href: '12'` and went back as the string '12', which the PDF shell parseInt'd. The host had to
  // carry a value in a vocabulary it could not name. It now carries a `{kind:'page', page}` target end
  // to end and never has to know what PDF addressing looks like.
  it('navigates with the page target the shell sent, unmodified', async () => {
    await mountReader();
    await reportReady();
    await deliver({ type: 'toc', items: pdfToc([1, 12, 40]) });
    await openContents(3);

    await fireEvent.press(screen.getByText('Page 12'));

    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 12 } }),
    );
  });

  // A PDF outline repeats page numbers BY DESIGN — several sections legitimately open on the same
  // page, and the sample fixture has exactly that. Rows must stay distinct anyway, which is why the
  // React key is index-composed rather than target-derived.
  it('lists every row when several sections open on the same page', async () => {
    await mountReader();
    await reportReady();
    await deliver({
      type: 'toc',
      items: [
        { label: 'Section A', target: { kind: 'page', page: 2 }, depth: 0 },
        { label: 'Section B', target: { kind: 'page', page: 2 }, depth: 1 },
      ],
    });
    await openContents(2);

    expect(screen.getByText('Section A')).toBeTruthy();
    expect(screen.getByText('Section B')).toBeTruthy();
  });
});

describe('an EPUB grouping heading with no href', () => {
  // epubOutline.ts's flattenToc keeps a nav point with no href rather than dropping it (a heading
  // that only groups its subitems), emitting `{kind:'href', href:''}` so the row still appears and
  // its children keep their depth. Tapping it must not reach goTo -> epub.entry.ts's
  // `rendition.display('')`, whose behavior is unverified — the row has nothing to navigate to.
  it('does not navigate when tapped', async () => {
    await mountReader();
    await reportReady();
    await deliver({
      type: 'toc',
      items: [
        { label: 'Grouping heading', target: { kind: 'href', href: '' }, depth: 0 },
        { label: 'Chapter 1', target: { kind: 'href', href: 'ch1.xhtml' }, depth: 1 },
      ],
    });
    await openContents(2);
    const before = __injectJavaScript.mock.calls.length;

    await fireEvent.press(screen.getByText('Grouping heading'));

    expect(__injectJavaScript.mock.calls.length).toBe(before);
  });

  it('is marked disabled for assistive tech, unlike a real chapter row', async () => {
    await mountReader();
    await reportReady();
    await deliver({
      type: 'toc',
      items: [
        { label: 'Grouping heading', target: { kind: 'href', href: '' }, depth: 0 },
        { label: 'Chapter 1', target: { kind: 'href', href: 'ch1.xhtml' }, depth: 1 },
      ],
    });
    await openContents(2);

    expect(screen.getByText('Grouping heading').parent?.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.getByText('Chapter 1').parent?.props.accessibilityState).not.toMatchObject({
      disabled: true,
    });
  });
});

describe('Prev/Next navigation controls', () => {
  function prevButton() {
    return screen.getByRole('button', { name: '‹ Prev' });
  }

  function nextButton() {
    return screen.getByRole('button', { name: 'Next ›' });
  }

  async function relocate(atStart: boolean, atEnd: boolean): Promise<void> {
    await deliver({
      type: 'relocated',
      position: { kind: 'cfi', cfi: 'epubcfi(/6/4[chap01]!/4/2/2)' },
      atStart,
      atEnd,
    });
  }

  // Same reasoning as ReaderWebView's own READY_TIMEOUT window: before the first `relocated`
  // arrives, "the book opens on its first page" is what Prev being disabled already means, and
  // this is the state a fresh open sits in for however long the WebView takes to report it.
  it('disables Prev before any position has arrived, matching a book opening on its first page', async () => {
    await mountReader();
    await reportReady();

    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('disables Prev at the start and Next at the end, independently', async () => {
    await mountReader();
    await reportReady();

    await relocate(true, false);
    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: false });

    await relocate(false, true);
    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: false });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('re-enables both once neither edge applies any more', async () => {
    await mountReader();
    await reportReady();
    await relocate(true, false);

    await relocate(false, false);

    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: false });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: false });
  });

  // CONTINUOUS SCROLL IS NAVIGATED BY SCROLLING, NOT BY THESE BUTTONS — so both are disabled
  // unconditionally in that flow, independent of atStart/atEnd (which the WebView still reports,
  // scrolled by whatever "one screenful" means there — see epub.entry.ts/pdf.entry.ts).
  it('disables both in continuous scroll, regardless of position', async () => {
    await mountReader();
    await reportReady();
    await relocate(false, false); // clearly not at either edge

    await act(async () => {
      __emitPrefsChange(makePrefs({ layout: { flow: 'scrolled-doc', spread: 'single' } }));
    });

    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('re-enables on returning to paginated flow, honouring the last reported edges', async () => {
    await mountReader();
    await reportReady();
    await relocate(false, false);
    await act(async () => {
      __emitPrefsChange(makePrefs({ layout: { flow: 'scrolled-doc', spread: 'single' } }));
    });

    await act(async () => {
      __emitPrefsChange(makePrefs({ layout: { flow: 'paginated', spread: 'single' } }));
    });

    expect(prevButton().props.accessibilityState).toMatchObject({ disabled: false });
    expect(nextButton().props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('the page indicator', () => {
  // PDF-ONLY BY CONSTRUCTION, not by choice. `ReaderPosition` is discriminated by format, and an EPUB
  // reports a CFI because a reflowable book has no stable page. Showing a number derived from a CFI
  // would be a number that changes with the font size, which is worse than showing none.
  async function relocateTo(position: unknown): Promise<void> {
    await deliver({ type: 'relocated', position, atStart: false, atEnd: false });
  }

  it('shows nothing until a position arrives', async () => {
    await mountReader();
    await reportReady();

    expect(screen.queryByTestId('reader-page-indicator')).toBeNull();
  });

  it('reports the page and the page count for a PDF', async () => {
    await mountReader();
    await reportReady();
    await relocateTo({ kind: 'page', page: 4, pageCount: 50 });

    expect(screen.getByLabelText('Page 4 of 50. Go to a page.')).toBeTruthy();
    expect(screen.getByText('4 / 50')).toBeTruthy();
  });

  it('follows the position as it moves', async () => {
    await mountReader();
    await reportReady();
    await relocateTo({ kind: 'page', page: 1, pageCount: 3 });
    await relocateTo({ kind: 'page', page: 3, pageCount: 3 });

    expect(screen.getByLabelText('Page 3 of 3. Go to a page.')).toBeTruthy();
    expect(screen.queryByText('1 / 3')).toBeNull();
  });

  it('shows no indicator for an EPUB, which has no stable page', async () => {
    await mountReader();
    await reportReady();
    await relocateTo({ kind: 'cfi', cfi: 'epubcfi(/6/4[chap01]!/4/2/2)' });

    expect(screen.queryByTestId('reader-page-indicator')).toBeNull();
  });

  // AN IMPOSSIBLE POSITION IS REFUSED LOUDLY, NOT SMOOTHED OVER — and that is deliberate, so it is
  // worth saying why the harsher option is the right one here.
  //
  // "page 9 of 3" cannot come from book content. `pageCount` is `doc.numPages` and `currentPage` only
  // moves through next/prev/goTo, all of which bound it. So a position like this means OUR OWN SHELL is
  // broken, and a shell that miscounts pages is not one whose other messages should be trusted either.
  // errors.ts requires that class of thing fail loudly rather than degrade.
  //
  // Contrast the TOC hardeners, which drop one bad row and keep the panel: a mis-indented Contents entry
  // really can come from a malformed book, and losing a chapter is worse than mis-indenting one.
  it('refuses an impossible position rather than displaying it', async () => {
    await mountReader();
    await reportReady();
    await relocateTo({ kind: 'page', page: 2, pageCount: 3 });
    await relocateTo({ kind: 'page', page: 9, pageCount: 3 });

    expect(screen.getByText('BRIDGE_PARSE_FAILED')).toBeTruthy();
  });
});

describe('the page jump', () => {
  // WHAT THIS IS FOR: a PDF with no outline has no Contents to offer — and most PDFs in the wild are
  // that, including the 15 MB measurement fixture. Contents stays correctly disabled for them; this is
  // the navigation such a book CAN offer, and it is only possible because `pageCount` now reaches the
  // host.
  async function atPage(page: number, pageCount: number): Promise<void> {
    await mountReader();
    await reportReady();
    await deliver({
      type: 'relocated',
      position: { kind: 'page', page, pageCount },
      atStart: false,
      atEnd: false,
    });
  }

  async function openJump(): Promise<void> {
    await fireEvent.press(screen.getByTestId('reader-page-indicator'));
  }

  async function type(text: string): Promise<void> {
    await fireEvent.changeText(screen.getByTestId('reader-page-jump'), text);
  }

  async function submit(): Promise<void> {
    await fireEvent(screen.getByTestId('reader-page-jump'), 'submitEditing');
  }

  it('opens from the page indicator', async () => {
    await atPage(3, 50);

    expect(screen.queryByTestId('reader-page-jump')).toBeNull();
    await openJump();

    expect(screen.getByTestId('reader-page-jump')).toBeTruthy();
    // The RANGE is on the field, which is the point of the host knowing pageCount: the bound is
    // visible before you type rather than discovered by being refused.
    expect(screen.getByPlaceholderText('1–50')).toBeTruthy();
  });

  it('sends a page target for a page inside the document', async () => {
    await atPage(3, 50);
    await openJump();
    await type('42');
    await submit();

    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 42 } }),
    );
    // Closes on success, so the row goes back to reporting where you are.
    expect(screen.queryByTestId('reader-page-jump')).toBeNull();
  });

  it.each([
    ['past the last page', '51'],
    ['zero', '0'],
    ['a negative', '-4'],
    ['a fraction', '2.5'],
    ['not a number', 'abc'],
    ['empty', ''],
  ])('declines %s without navigating, and keeps the field open', async (_label, text) => {
    await atPage(3, 50);
    const before = __injectJavaScript.mock.calls.length;
    await openJump();
    await type(text);
    await submit();

    // NOT an error banner. The shell would range-check too and raise NAVIGATION_FAILED, which is the
    // right response to a corrupt book and a wildly disproportionate one to a typo — so the host
    // declines silently instead.
    expect(__injectJavaScript.mock.calls.length).toBe(before);
    expect(screen.queryByTestId('reader-error')).toBeNull();
    // Left open with the text intact: a rejection should not also lose what you typed.
    expect(screen.getByTestId('reader-page-jump')).toBeTruthy();
  });

  it('accepts the first and last page exactly', async () => {
    await atPage(3, 50);
    await openJump();
    await type('1');
    await submit();
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 1 } }),
    );

    await openJump();
    await type('50');
    await submit();
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 50 } }),
    );
  });

  // A reflowable book has no stable page, so there is nothing to jump to and no indicator to open.
  it('is unreachable for an EPUB', async () => {
    await mountReader();
    await reportReady();
    await deliver({
      type: 'relocated',
      position: { kind: 'cfi', cfi: 'epubcfi(/6/4!/2)' },
      atStart: false,
      atEnd: false,
    });

    expect(screen.queryByTestId('reader-page-indicator')).toBeNull();
    expect(screen.queryByTestId('reader-page-jump')).toBeNull();
  });

  it('is unreachable before any position has arrived', async () => {
    await mountReader();
    await reportReady();

    expect(screen.queryByTestId('reader-page-indicator')).toBeNull();
  });
});

describe('the outline timing probe', () => {
  // WHY THIS IS TIMED AT ALL: on the PDF shell every outline destination is resolved through the
  // pdf.js worker, so a large book's Contents can lag well behind `rendered`. That window is
  // invisible from the outside — a page is on screen and the Contents button is simply still
  // disabled — so it needs a number rather than an impression.
  const original = process.env.EXPO_PUBLIC_READER_TIMING;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (original === undefined) {
      delete process.env.EXPO_PUBLIC_READER_TIMING;
    } else {
      process.env.EXPO_PUBLIC_READER_TIMING = original;
    }
  });

  function tfperfLines(): string[] {
    return logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('[TFPERF]'));
  }

  it('reports how long the outline took, and how many entries it carried', async () => {
    process.env.EXPO_PUBLIC_READER_TIMING = '1';

    await mountReader();
    await reportReady();
    await deliver({ type: 'rendered' });
    await deliver({ type: 'toc', items: flatToc(22) });

    // The count is the load-bearing extra: a slow outline and a huge outline are the same
    // millisecond figure, and only one of them is a bug in this code.
    expect(tfperfLines()).toContainEqual(expect.stringMatching(/^\[TFPERF\] open -> toc \d+ms/));
    expect(tfperfLines()).toContainEqual(expect.stringContaining('items=22'));
  });

  // Off-by-default is a security property here, not a preference — these lines report payload sizes
  // from a path holding decrypted licensed content. Same guarantee readerTiming.test.ts pins for the
  // probes themselves, asserted once through a real open so a stray unconditional log would show up.
  it('emits nothing at all when timing is not switched on', async () => {
    delete process.env.EXPO_PUBLIC_READER_TIMING;

    await mountReader();
    await reportReady();
    await deliver({ type: 'rendered' });
    await deliver({ type: 'toc', items: flatToc(3) });

    expect(tfperfLines()).toEqual([]);
  });

  // An empty outline is the NORMAL case for a PDF, so the span must still land — otherwise the one
  // book whose Contents is legitimately empty is also the one with no timing for it.
  it('still reports the span for a book with no outline', async () => {
    process.env.EXPO_PUBLIC_READER_TIMING = '1';

    await mountReader();
    await reportReady();
    await deliver({ type: 'rendered' });
    await deliver({ type: 'toc', items: [] });

    expect(tfperfLines()).toContainEqual(expect.stringContaining('items=0'));
  });
});

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

describe('routing ContentFormat to a renderer', () => {
  afterEach(() => {
    jest.mocked(prepareBook).mockResolvedValue('EPUB');
    jest.mocked(getBookBase64).mockResolvedValue('UEsDBA==');
  });

  it('loads the EPUB shell and sends openEpub for an EPUB book', async () => {
    await mountReader();
    await reportReady();

    expect(jest.mocked(getReaderHtmlUri)).toHaveBeenCalledWith('EPUB');
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' }),
    );
  });

  it('loads the PDF shell and sends openPdf for a PDF book', async () => {
    // The two halves have to move together. Loading the PDF shell but sending
    // openEpub would answer NOT_READY — the shell defines only openPdf — which is a
    // confusing way to discover a routing bug, so both are asserted here.
    jest.mocked(prepareBook).mockResolvedValue('PDF');
    jest.mocked(getBookBase64).mockResolvedValue('JVBERi0xLjQK');

    await mountReader();
    await reportReady();

    expect(jest.mocked(getReaderHtmlUri)).toHaveBeenCalledWith('PDF');
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'openPdf', base64: 'JVBERi0xLjQK' }),
    );

    jest.mocked(getBookBase64).mockResolvedValue('UEsDBA==');
  });

  it('passes the resolved format to the access check, not a hardcoded EPUB', async () => {
    // readerAssets.ts:125 used to send a literal 'EPUB' to verifyReadingAccess. That
    // is finding B12, and this is the assertion that keeps it closed on Reader's side.
    jest.mocked(prepareBook).mockResolvedValue('PDF');

    await mountReader();
    await reportReady();

    expect(jest.mocked(getBookBase64)).toHaveBeenCalledWith('test-book', 'PDF');
  });

  it('re-resolves the shell and the open command when the book switches format', async () => {
    // What App.tsx's dev picker does, and what RootNavigator will do with real books:
    // change ONLY the bookId. Nothing hands the reader a format, so this is also the
    // proof that runtime format switching needs no routing change — it falls out of
    // resolving the format per book.
    jest.mocked(prepareBook).mockResolvedValue('EPUB');
    const view = await render(<ReaderScreen key="book-epub" bookId="book-epub" />);
    await screen.findByTestId('reader-webview');
    await reportReady();

    expect(jest.mocked(getReaderHtmlUri)).toHaveBeenLastCalledWith('EPUB');
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' }),
    );

    jest.mocked(prepareBook).mockResolvedValue('PDF');
    jest.mocked(getBookBase64).mockResolvedValue('JVBERi0xLjQK');

    // KEYED, exactly as App.tsx and any navigator must do — ReaderScreen's prop doc
    // requires it, so a test that rerendered without a key would be exercising a usage
    // the component does not support and would pass for the wrong reason.
    await act(async () => {
      await view.rerender(<ReaderScreen key="book-pdf" bookId="book-pdf" />);
    });
    await screen.findByTestId('reader-webview');
    await reportReady();

    expect(jest.mocked(getReaderHtmlUri)).toHaveBeenLastCalledWith('PDF');
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'openPdf', base64: 'JVBERi0xLjQK' }),
    );

    // The outgoing book's decrypted bytes must be released. Without this the reader
    // leaks a whole book per switch, which is exactly what closeBook exists to stop.
    expect(jest.mocked(closeBook)).toHaveBeenCalledWith('book-epub');
  });

  it('does not send the previous format’s open command after a switch', async () => {
    // The stale-state failure this guards: if `format` survived the bookId change,
    // handleReady would send openEpub into the PDF shell, which defines only openPdf
    // and would answer NOT_READY — a confusing way to find a routing bug.
    jest.mocked(prepareBook).mockResolvedValue('EPUB');
    const view = await render(<ReaderScreen key="book-epub" bookId="book-epub" />);
    await screen.findByTestId('reader-webview');
    await reportReady();

    jest.mocked(prepareBook).mockResolvedValue('PDF');
    __injectJavaScript.mockClear();

    // KEYED, exactly as App.tsx and any navigator must do — ReaderScreen's prop doc
    // requires it, so a test that rerendered without a key would be exercising a usage
    // the component does not support and would pass for the wrong reason.
    await act(async () => {
      await view.rerender(<ReaderScreen key="book-pdf" bookId="book-pdf" />);
    });
    await screen.findByTestId('reader-webview');
    await reportReady();

    const sent = __injectJavaScript.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sent).toContain('window.TFReader.openPdf');
    expect(sent).not.toContain('window.TFReader.openEpub');
  });

  it('never opens the previous renderer even when the caller forgets the key', async () => {
    // The prop doc REQUIRES callers to key on bookId, and both switch tests above do.
    // This one deliberately does NOT, because "the caller forgot" must fail safe rather
    // than silently opening the wrong renderer: the resolved format/shell pair is tagged
    // with its bookId, so a mismatched tag reads as "not resolved yet" instead of as the
    // previous book's answer. Without that tag this test sends openEpub into a PDF shell.
    jest.mocked(prepareBook).mockResolvedValue('EPUB');
    const view = await render(<ReaderScreen bookId="book-epub" />);
    await screen.findByTestId('reader-webview');
    await reportReady();

    // Make the new book's resolution never settle, so the ONLY thing that could be
    // rendered is whatever survived from the previous book.
    jest.mocked(prepareBook).mockReturnValue(new Promise<ContentFormat>(() => {}));
    __injectJavaScript.mockClear();

    await act(async () => {
      await view.rerender(<ReaderScreen bookId="book-pdf" />);
    });

    // Stale shell is gone rather than reused, so there is nothing to be ready.
    expect(screen.queryByTestId('reader-webview')).toBeNull();
    expect(__injectJavaScript).not.toHaveBeenCalled();
  });

  it('refuses AUDIO with its own code and never mounts a WebView', async () => {
    // AUDIO is a real member of the frozen enum and is never encrypted, so it can
    // reach this screen. There is no shell for it, and the important half of this is
    // the SECOND assertion: silently loading the EPUB shell for an audiobook would
    // fail much later, inside epub.js, as an unreadable error.
    jest
      .mocked(prepareBook)
      .mockRejectedValue(new UnsupportedFormatError('AUDIO' as ContentFormat));

    await render(<ReaderScreen bookId="test-book" />);

    expect(await screen.findByText('UNSUPPORTED_FORMAT')).toBeTruthy();
    expect(screen.queryByTestId('reader-webview')).toBeNull();
    // NOT the asset code: the shells are fine, there just isn't one for this book,
    // and telling the reader to run a build script would be a lie.
    expect(screen.queryByText('ASSET_LOAD_FAILED')).toBeNull();
  });
});

describe('applyAppearance — the prefs-application wiring', () => {
  afterEach(() => {
    jest.mocked(useAppearanceEnv).mockReturnValue(LIGHT_ENV);
    jest.mocked(prefsStore.getPrefs).mockResolvedValue(makePrefs());
  });

  it('sends applyAppearance before the open command, not alongside or after it', async () => {
    await mountReader();
    await reportReady();

    const calls = __injectJavaScript.mock.calls.map((call) => String(call[0]));
    const appearanceIndex = calls.indexOf(
      buildCommandScript({
        type: 'applyAppearance',
        appearance: toReaderAppearance(makePrefs(), LIGHT_ENV),
      }),
    );
    const openIndex = calls.indexOf(
      buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' }),
    );

    // Both must actually have been sent (index -1 would mean "never called", not "called first").
    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(openIndex).toBeGreaterThan(appearanceIndex);
  });

  it('re-sends applyAppearance when prefsStore notifies, without reopening the book', async () => {
    await mountReader();
    await reportReady();
    __injectJavaScript.mockClear();

    // NOT wrapped in act(): the listener calls `send`, a ref method call
    // (webViewRef.current.injectJavaScript), not a React state update — there is nothing for act()
    // to flush, and wrapping it anyway was found to corrupt the test-act environment for every test
    // that ran afterward in this file (an unrelated `act()` call landing while React's own internal
    // act tracking was mid-flight from the preceding reportReady()).
    const changed = makePrefs({ theme: 'dark' });
    __emitPrefsChange(changed);
    // The listener's send is now behind two microtask hops (buildAppearanceWithFont's own await of
    // loadFontFaceSrc, then the listener's await of buildAppearanceWithFont itself) — a bare double
    // await, not act(), per the note above.
    await Promise.resolve();
    await Promise.resolve();

    expect(__injectJavaScript).toHaveBeenCalledWith(
      buildCommandScript({ type: 'applyAppearance', appearance: toReaderAppearance(changed, LIGHT_ENV) }),
    );
    // NOT a reopen: `openEpub` carries the book's bytes and nothing about a theme change should
    // touch them.
    expect(__injectJavaScript).not.toHaveBeenCalledWith(
      buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' }),
    );
  });

  it('re-sends applyAppearance when the OS-level appearance changes', async () => {
    const view = await render(<ReaderScreen bookId="test-book" />);
    await screen.findByTestId('reader-webview');
    await reportReady();
    __injectJavaScript.mockClear();

    const darkEnv: AppearanceEnv = { ...LIGHT_ENV, osColorScheme: 'dark' };
    jest.mocked(useAppearanceEnv).mockReturnValue(darkEnv);
    await act(async () => {
      await view.rerender(<ReaderScreen bookId="test-book" />);
    });

    expect(__injectJavaScript).toHaveBeenCalledWith(
      buildCommandScript({
        type: 'applyAppearance',
        appearance: toReaderAppearance(makePrefs(), darkEnv),
      }),
    );

    // Explicit, rather than relying on auto-cleanup between tests: this component is the one
    // subscriber in the whole file that registers with a SHARED module-level mock registry
    // (prefsStore's `listeners` Set), so a tree left mounted here is externally observable by a
    // later test in a way nothing else in this file is — see the unmount test below for exactly
    // that failure mode.
    await view.unmount();
  });

  it('stops re-applying after unmount', async () => {
    const view = await render(<ReaderScreen bookId="test-book" />);
    await screen.findByTestId('reader-webview');
    await reportReady();
    __injectJavaScript.mockClear();

    await view.unmount();
    // Not act()-wrapped — see the note in the test above.
    __emitPrefsChange(makePrefs({ theme: 'dark' }));

    expect(__injectJavaScript).not.toHaveBeenCalled();
  });

  it('overlays the loaded font-face bytes onto customFontUri, not toReaderAppearance\'s own passthrough', async () => {
    const fontDataUri = 'data:font/ttf;base64,AAAA';
    jest.mocked(loadFontFaceSrc).mockResolvedValue(fontDataUri);
    const withInter = makePrefs({ font: { family: 'Inter' } });
    jest.mocked(prefsStore.getPrefs).mockResolvedValue(withInter);

    await mountReader();
    await reportReady();

    // toReaderAppearance's own resolveFont carries customFontUri through unresolved (undefined on
    // this prefs record) — the sent payload must have the LOADED bytes instead, not that passthrough.
    expect(__injectJavaScript).toHaveBeenCalledWith(
      buildCommandScript({
        type: 'applyAppearance',
        appearance: { ...toReaderAppearance(withInter, LIGHT_ENV), customFontUri: fontDataUri },
      }),
    );
    expect(jest.mocked(loadFontFaceSrc)).toHaveBeenCalledWith('Inter');
  });

  it('overlays the loaded font-face bytes on the prefs-subscribe re-apply too', async () => {
    await mountReader();
    await reportReady();
    __injectJavaScript.mockClear();

    const fontDataUri = 'data:font/ttf;base64,BBBB';
    jest.mocked(loadFontFaceSrc).mockResolvedValue(fontDataUri);
    const withPoppins = makePrefs({ font: { family: 'Poppins' } });

    // Not act()-wrapped — see the note on the theme-change test above; two microtask hops, same
    // reasoning as there.
    __emitPrefsChange(withPoppins);
    await Promise.resolve();
    await Promise.resolve();

    expect(__injectJavaScript).toHaveBeenCalledWith(
      buildCommandScript({
        type: 'applyAppearance',
        appearance: { ...toReaderAppearance(withPoppins, LIGHT_ENV), customFontUri: fontDataUri },
      }),
    );
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
        { label: 'Part One', target: { kind: 'href', href: 'part1.xhtml' }, depth: 0 },
        { label: 'Chapter 1', target: { kind: 'href', href: 'ch1.xhtml' }, depth: 1 },
        { label: 'Section 1.1', target: { kind: 'href', href: 'ch1.xhtml#s1' }, depth: 2 },
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

describe('ReaderScreen in-book search', () => {
  beforeEach(() => {
    jest.mocked(queryBookIndex).mockReset().mockResolvedValue([]);
    __injectJavaScript.mockClear();
  });

  function epubHit(n: number, chapterId = 'ch1'): SearchHit {
    return {
      bookId: 'test-book',
      chapterId,
      locator: { type: 'EPUB', cfi: `epubcfi(/6/2[${chapterId}]!/4/4/1:${n})` },
      snippet: `…the grey wolf number ${n} moved…`,
    };
  }

  async function openSearch(): Promise<void> {
    await fireEvent.press(screen.getByRole('button', { name: 'Search this book' }));
  }

  /** Type a term and press the panel's Search button. */
  async function runSearch(term: string): Promise<void> {
    await fireEvent.changeText(screen.getByTestId('reader-search-input'), term);
    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  }

  it('opens and closes the panel from the toolbar', async () => {
    await mountReader();

    await openSearch();
    expect(screen.getByTestId('reader-search-input')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
  });

  it('keeps Contents and Search mutually exclusive', async () => {
    // Both toggles render a "Close" affordance when open. If they could be open at
    // once, every getByRole('button', { name: 'Close' }) in this file would become
    // ambiguous — so the exclusion is load-bearing for the suite, not just for looks.
    await mountReader();
    await deliver({ type: 'toc', items: flatToc(3) });

    await openSearch();
    expect(screen.getByTestId('reader-search-input')).toBeTruthy();

    await openContents(3);
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
    expect(screen.getByTestId('reader-toc-list')).toBeTruthy();

    await openSearch();
    expect(screen.queryByTestId('reader-toc-list')).toBeNull();
  });

  it('queries only on submit, and passes the raw typed text through', async () => {
    await mountReader();
    await openSearch();

    const input = screen.getByTestId('reader-search-input');
    await fireEvent.changeText(input, 'Tur');
    await fireEvent.changeText(input, 'Turbo');
    await fireEvent.changeText(input, 'Turbocharger!');

    // Not once per keystroke: every call re-parses the whole index, and Search caches
    // nothing.
    expect(queryBookIndex).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));

    // Raw, uncleaned. Search's termTokens lowercases and strips punctuation itself;
    // normalising here would be a second, divergent implementation of that.
    expect(queryBookIndex).toHaveBeenCalledTimes(1);
    expect(queryBookIndex).toHaveBeenCalledWith('test-book', 'Turbocharger!');
  });

  it('lists a row per occurrence and reports the count', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2), epubHit(3, 'ch2')]);
    await mountReader();
    await openSearch();
    await runSearch('wolf');

    expect(screen.getByText('3 matches for “wolf”.')).toBeTruthy();
    expect(screen.getByText('…the grey wolf number 3 moved…')).toBeTruthy();
    // Chapter run headers, emitted only where the chapter changes.
    expect(screen.getByText('ch2')).toBeTruthy();
  });

  it('bounds the results list so it can scroll past the first screenful', async () => {
    // A PROXY, and worth saying so: Jest has no layout engine, so "the list scrolls"
    // cannot be asserted here any more than it can for the Contents list (see this
    // file's header). What CAN be pinned is the structure whose absence caused the
    // clipping — the ScrollView needs a parent with `flex: 1`, because a plain View
    // defaults to flexShrink: 0 and otherwise grows to its content height, letting the
    // panel clip everything past the first screenful. Note the flex belongs to the
    // WRAPPER, not the ScrollView, which brings flexGrow/flexShrink: 1 of its own.
    jest
      .mocked(queryBookIndex)
      .mockResolvedValue(Array.from({ length: 60 }, (_, i) => epubHit(i + 1)));
    await mountReader();
    await openSearch();
    await runSearch('wolf');

    const wrapper = screen.getByTestId('reader-search-results').parent;
    expect(StyleSheet.flatten(wrapper?.props.style as never)).toMatchObject({ flex: 1 });

    // And the tail of the list is rendered at all — clipping and not-rendering are
    // different bugs with the same symptom, so rule the second one out.
    expect(screen.getByText('…the grey wolf number 60 moved…')).toBeTruthy();
  });

  it('explains that a multi-word search is not a phrase search', async () => {
    // Without this the count is actively misleading. Measured against the real sample
    // index, "chapter 9" returns 91 hits — 88 of them the word "chapter" alone —
    // because Search ANDs the tokens at CHAPTER granularity and then returns every
    // posting of EVERY query word in the qualifying chapters. Adding a word makes the
    // list LONGER, which is the opposite of what typing a second word implies.
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2)]);
    await mountReader();
    await openSearch();
    await runSearch('chapter 9');

    expect(
      screen.getByText(
        'Not a phrase search: this lists every occurrence of “chapter” and “9” in chapters that contain all of them.',
      ),
    ).toBeTruthy();
  });

  it('does not claim phrase semantics for a single-word search', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1)]);
    await mountReader();
    await openSearch();
    await runSearch('chapter');

    expect(screen.queryByText(/Not a phrase search/)).toBeNull();
  });

  it('reports an empty result without making the book look broken', async () => {
    // THE STATE THE APP IS IN whenever a book ships no index: queryBookIndex returns
    // [] for that and for "no matches" alike.
    await mountReader();
    await openSearch();
    await runSearch('wolf');

    expect(screen.getByText('No matches for “wolf” in this book.')).toBeTruthy();
    // The top banner is for ReaderErrorCodes and means the BOOK failed. Search finding
    // nothing must never light it up.
    expect(screen.queryByText('CONTENT_LOAD_FAILED')).toBeNull();
    expect(screen.queryByText('BRIDGE_PARSE_FAILED')).toBeNull();
  });

  it('keeps a thrown query inside the panel, leaving the book readable', async () => {
    jest
      .mocked(queryBookIndex)
      .mockRejectedValue(
        new Error('queryBookIndex: failed to decode search index for "test-book" — Unexpected token'),
      );

    await mountReader();
    await deliver({ type: 'toc', items: flatToc(3) });
    await openSearch();
    await runSearch('wolf');

    expect(screen.getByText('Search is unavailable for this book.')).toBeTruthy();
    expect(screen.getByText(/failed to decode search index/)).toBeTruthy();
    expect(screen.queryByText('CONTENT_LOAD_FAILED')).toBeNull();

    // The book itself is untouched by a search failure.
    await openContents(3);
    expect(screen.getByTestId('reader-toc-list')).toBeTruthy();
  });

  it('sends goTo carrying a bare CFI string when a result is tapped', async () => {
    // THE LOAD-BEARING ONE. WEBVIEW_BRIDGE.md's claim that search trips no conversion
    // trigger holds only while the host unwraps SearchHit.locator to a string. Pinning
    // the injected script against buildCommandScript means widening the bridge to
    // carry the Locator union breaks this test rather than the bridge.
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2)]);
    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');

    await fireEvent.press(screen.getByText('…the grey wolf number 2 moved…'));

    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({
        type: 'goTo',
        target: { kind: 'href', href: 'epubcfi(/6/2[ch1]!/4/4/1:2)' },
      }),
    );
    // The panel DISMISSES on select — it covers the page, so staying open would hide
    // the text the jump just went to. The floating match bar is what remains.
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
    expect(screen.getByTestId('reader-search-match-bar')).toBeTruthy();
    expect(screen.getByText('Match 2 of 2')).toBeTruthy();
  });

  it('queues a tapped hit while the book is still loading, then jumps once ready', async () => {
    // THE FAILSAFE. `send` stays null until the WebView reports `ready` — but search
    // runs host-side over the decrypted index (queryBookIndex), so results can be back
    // and tapped well before that. `send?.({...})` used to silently drop the jump here:
    // the panel closed and the match bar claimed "Match 2 of 2" as if it had worked.
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2)]);
    await mountReader();
    await openSearch();
    await runSearch('wolf');

    // No reportReady() yet — send is still null.
    await fireEvent.press(screen.getByText('…the grey wolf number 2 moved…'));

    const goTo = buildCommandScript({
      type: 'goTo',
      target: { kind: 'href', href: 'epubcfi(/6/2[ch1]!/4/4/1:2)' },
    });

    // Not dropped, and not pretending it happened: the panel stays open with a visible
    // notice instead of closing onto a match bar that lied about the jump.
    expect(screen.getByTestId('reader-search-input')).toBeTruthy();
    expect(screen.getByTestId('reader-search-awaiting-seek')).toBeTruthy();
    expect(__injectJavaScript).not.toHaveBeenCalledWith(goTo);

    await reportReady();

    // Queued jump fires the moment `send` exists, alongside (not instead of) the open
    // command that `ready` also triggers.
    expect(__injectJavaScript).toHaveBeenCalledWith(goTo);
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
    expect(screen.getByTestId('reader-search-match-bar')).toBeTruthy();
    expect(screen.getByText('Match 2 of 2')).toBeTruthy();
  });

  it('cancels a queued jump when a new search is submitted before the book is ready', async () => {
    // A queued target is only meaningful against the result set it was tapped from.
    // Running a new search before the book becomes ready must not leave a stale jump
    // waiting to fire into whatever the reader shows once it is.
    jest
      .mocked(queryBookIndex)
      .mockResolvedValueOnce([epubHit(1)])
      .mockResolvedValueOnce([epubHit(5)]);
    await mountReader();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByText('…the grey wolf number 1 moved…'));

    expect(screen.getByTestId('reader-search-awaiting-seek')).toBeTruthy();

    await runSearch('bear');
    expect(screen.queryByTestId('reader-search-awaiting-seek')).toBeNull();

    await reportReady();
    expect(__injectJavaScript).not.toHaveBeenCalledWith(
      buildCommandScript({
        type: 'goTo',
        target: { kind: 'href', href: 'epubcfi(/6/2[ch1]!/4/4/1:1)' },
      }),
    );
  });

  it('cancels a queued jump when the panel is closed', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1)]);
    await mountReader();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByText('…the grey wolf number 1 moved…'));

    expect(screen.getByTestId('reader-search-awaiting-seek')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await reportReady();

    expect(__injectJavaScript).not.toHaveBeenCalledWith(
      buildCommandScript({
        type: 'goTo',
        target: { kind: 'href', href: 'epubcfi(/6/2[ch1]!/4/4/1:1)' },
      }),
    );
  });

  it('leaves the viewer mounted and unresized while searching', async () => {
    // THE REGRESSION THIS GUARDS. Both search surfaces overlay the viewer instead of
    // sharing the column with it. A sibling that occupies layout changes the viewer's
    // height, which resizes the WebView, which makes epub.js re-paginate — and a CFI
    // resolved under one pagination points at a different page under another, so every
    // jump lands off by a page. Asserting the WebView is continuously mounted with an
    // unchanged style is the closest a layout-engine-less test can get to that.
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1)]);
    await mountReader();
    await reportReady();

    const styleBefore = screen.getByTestId('reader-webview').props.style;

    await openSearch();
    expect(screen.getByTestId('reader-webview')).toBeTruthy();
    await runSearch('wolf');
    await fireEvent.press(screen.getByText('…the grey wolf number 1 moved…'));

    expect(screen.getByTestId('reader-webview').props.style).toEqual(styleBefore);
  });

  it('reopens the results from the match bar', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2)]);
    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByText('…the grey wolf number 1 moved…'));

    // The counter doubles as the way back in — it is the widest target in the bar and
    // already names what tapping it shows.
    await fireEvent.press(
      screen.getByRole('button', { name: 'Match 1 of 2 for wolf. Show all results.' }),
    );

    expect(screen.getByTestId('reader-search-input')).toBeTruthy();
    // Reopening must not re-run the query or lose the place in the results.
    expect(queryBookIndex).toHaveBeenCalledTimes(1);
    expect(screen.getByText('…the grey wolf number 2 moved…')).toBeTruthy();
  });

  it('steps through matches from the match bar and clamps at both ends', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2), epubHit(3)]);
    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');

    // Dismiss the panel to get at the match bar — stepping is something you do while
    // looking at the page, which is why the arrows live there and not in the results.
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    // Nothing selected yet, so the count reads as a total rather than a position.
    expect(screen.getByText('3 matches')).toBeTruthy();

    const next = (): Promise<void> =>
      fireEvent.press(screen.getByRole('button', { name: 'Next match' }));

    await next();
    expect(screen.getByText('Match 1 of 3')).toBeTruthy();
    await next();
    await next();
    expect(screen.getByText('Match 3 of 3')).toBeTruthy();

    // Clamp, not wrap — the arrow disables rather than looping back to the first hit.
    expect(
      screen.getByRole('button', { name: 'Next match' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  // REPLACES "lists a PDF hit but never navigates to it", which pinned a dead row.
  //
  // That was never a decision about whether PDF results should be navigable — `cfiOf` unwrapped
  // `locator.cfi`, which only an EPUB locator has, so a PDF hit had nowhere to be sent while `goTo`
  // took a bare string. A discriminated `ReaderTarget` can carry a page, so `targetOf` sends one and
  // the row stops being a dead end.
  it('seeks to a PDF hit by page, not just an EPUB hit by CFI', async () => {
    const pdfHit: SearchHit = {
      bookId: 'test-book',
      chapterId: 'ch1',
      locator: { type: 'PDF', page: 4 },
      snippet: '…a page-addressed hit…',
    };
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), pdfHit, epubHit(3)]);

    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');

    // Still LISTED rather than filtered, for the reason it always was: dropping a hit would
    // desynchronise the ordinals from "Match n of m".
    expect(screen.getByText('…a page-addressed hit…')).toBeTruthy();
    // And no longer labelled unavailable, because it is not.
    expect(screen.queryByText('Not available in this reader')).toBeNull();

    await fireEvent.press(screen.getByText('…a page-addressed hit…'));

    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 4 } }),
    );
  });

  it('steps onto a PDF hit instead of skipping past it', async () => {
    // The match bar used to step straight over every PDF hit while still counting it, so "Match 2 of
    // 3" was unreachable — the ordinals described a list the arrows could not visit.
    const pdfHit: SearchHit = {
      bookId: 'test-book',
      chapterId: 'ch1',
      locator: { type: 'PDF', page: 7 },
      snippet: '…the middle hit…',
    };
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), pdfHit, epubHit(3)]);

    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Next match' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next match' }));

    expect(screen.getByText('Match 2 of 3')).toBeTruthy();
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 7 } }),
    );
  });

  // THE MATCH BAR'S ARROWS USED TO BE PERMANENTLY DISABLED FOR AN ALL-PDF RESULT SET, even though
  // every hit was genuinely navigable. `hasNavigableFrom` (useBookSearch.ts) checked an EPUB-only
  // unwrap that returns null for every PDF locator, so a mixed EPUB+PDF list (the other tests above)
  // still found an EPUB hit and reported navigable — the bug was invisible there. A PDF-only book
  // failed every check, so `canStepBack`/`canStepForward` were false from the first render. Asserting
  // on `accessibilityState.disabled` is the point: the earlier tests only checked that pressing the
  // button worked, and RNTL's fireEvent.press does not itself respect a `disabled` prop the way a
  // real device's Pressable does — so this is the check that would actually have caught it.
  it('does not disable the match bar arrows for an all-PDF result set', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([
      { bookId: 'test-book', chapterId: 'ch1', locator: { type: 'PDF', page: 3 }, snippet: '…one…' },
      { bookId: 'test-book', chapterId: 'ch1', locator: { type: 'PDF', page: 7 }, snippet: '…two…' },
    ]);

    await mountReader();
    await reportReady();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    expect(
      screen.getByRole('button', { name: 'Next match' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });

    await fireEvent.press(screen.getByRole('button', { name: 'Next match' }));

    expect(screen.getByText('Match 1 of 2')).toBeTruthy();
    // Landed on the FIRST hit — "Previous" is correctly disabled (nothing before it), but "Next"
    // must still be enabled since there is a second PDF hit ahead of it.
    expect(
      screen.getByRole('button', { name: 'Previous match' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(
      screen.getByRole('button', { name: 'Next match' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });
    expect(__injectJavaScript).toHaveBeenLastCalledWith(
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 3 } }),
    );
  });

  it('drops a stale response that lands after a newer search', async () => {
    // Justifies the sequence guard in useBookSearch: queryBookIndex takes no
    // AbortSignal, so a slow broad search can still be parsing when a narrower one has
    // already returned.
    function deferred(): { promise: Promise<SearchHit[]>; resolve: (v: SearchHit[]) => void } {
      let resolve!: (value: SearchHit[]) => void;
      const promise = new Promise<SearchHit[]>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    const slow = deferred();
    const fast = deferred();
    jest
      .mocked(queryBookIndex)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    await mountReader();
    await openSearch();
    await runSearch('wolf');
    await runSearch('bear');

    await act(async () => {
      fast.resolve([epubHit(2)]);
    });
    await act(async () => {
      slow.resolve([epubHit(1), epubHit(3)]); // arrives late, for the abandoned term
    });

    expect(screen.getByText('…the grey wolf number 2 moved…')).toBeTruthy();
    expect(screen.queryByText('…the grey wolf number 1 moved…')).toBeNull();
    expect(screen.getByText('1 match for “bear”.')).toBeTruthy();
  });

  it('dismisses the match bar and forgets the results', async () => {
    jest.mocked(queryBookIndex).mockResolvedValue([epubHit(1), epubHit(2)]);
    await mountReader();
    await openSearch();
    await runSearch('wolf');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss search' }));

    expect(screen.queryByTestId('reader-search-match-bar')).toBeNull();
    // Reopening the panel starts clean rather than restoring the dismissed hits.
    await openSearch();
    expect(screen.queryByText('…the grey wolf number 1 moved…')).toBeNull();
  });
});
