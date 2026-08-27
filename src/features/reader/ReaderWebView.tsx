// Owner: Reader (Ahana).
//
// The WebView host. Loads a generated, self-contained reader shell
// (assets/reader/reader-epub.html or reader-pdf.html, chosen by readerAssets from
// the book's ContentFormat) and speaks the readerBridge protocol to it. FORMAT-
// AGNOSTIC by design: it is handed a URI and never learns which renderer is inside,
// which is why adding PDF needed no change here. Knows nothing about where bytes
// come from (readerAssets.ts owns that) and renders no chrome (ReaderScreen does).
//
// >>> WHY THIS WEBVIEW IS LOCKED DOWN AS HARD AS IT IS <<<
// This is where DECRYPTED, LICENSED BOOK CONTENT is rendered. Now that
// whole-book decrypt is wired, the HTML/CSS/JS inside a book is untrusted input
// running in a context that holds plaintext, and the failure mode is
// exfiltration — a book that navigates or beacons out. This is load-bearing.
//
// The load is fully local and self-contained (zero sub-resource requests), so
// there is no legitimate navigation for the deny rules below to break.

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  WebViewMessageEvent,
  WebViewNavigation,
  ShouldStartLoadRequest,
} from 'react-native-webview/lib/WebViewTypes';

import { buildCommandScript, parseReaderMessage } from '@/features/reader/readerBridge';
import type { ReaderCommand, ReaderErrorCode, ReaderMessage } from '@/features/reader/readerBridge';

/**
 * How long to wait for the WebView's `ready` before declaring the bridge dead.
 * Without this, every silent failure (asset missing, IIFE threw before its own
 * handlers were registered, postMessage unavailable) presents identically as a
 * permanently blank page. "Not a blank page" is an acceptance criterion, and
 * this timer is what enforces it for the cases nothing else can catch.
 */
const READY_TIMEOUT_MS = 10_000;

export interface ReaderWebViewProps {
  /** file:// URI of the generated shell for this book's format, from getReaderHtmlUri(). */
  sourceUri: string;
  /** Every bridge message, already parsed and narrowed. */
  onMessage: (message: ReaderMessage) => void;
  /** Host-side failures (see HOST_ERROR_CODES) that never came over the bridge. */
  onHostError: (code: ReaderErrorCode, message: string) => void;
  /** Called once the bridge is up; hand back a sender for RN -> WebView commands. */
  onReady: (send: (command: ReaderCommand) => void) => void;
  /**
   * Whether the WebView's own top-level scroll view may scroll. Defaults to `false`, preserving the
   * original "pagination is driven by the bridge, not by dragging the document" behaviour.
   *
   * Set `true` only for continuous-scroll flow: both templates' `html, body` keep `overflow: hidden`
   * regardless, so this only matters for the NESTED scroll container each format's continuous mode
   * manages internally (epub.js's own scrolled-doc container; PDF's `#pdf-scroll`) — a top-level
   * document with nothing scrollable is unaffected either way. Nested `overflow: auto` scrolling is
   * ordinarily independent of the top-level scroll view's enabled state, but that assumption is
   * unverified against this app's exact CSS chain; check on-device when exercising continuous scroll.
   */
  scrollEnabled?: boolean;
  /**
   * Take the book out of the screen-reader's focus order, for while a panel covers it.
   *
   * ON THIS COMPONENT'S OWN CONTAINER RATHER THAN A WRAPPER IN THE HOST. `ReaderScreen` renders the
   * TOC/Search/Bookmarks panels as SIBLINGS of this component inside one `viewer` View, so there is
   * no existing node that contains the book and excludes the panels — hiding the background from the
   * host side would mean reparenting, and changing the viewer's height re-paginates epub.js, which
   * makes every already-resolved CFI point somewhere else (see SearchMatchBar.tsx's header). This
   * container already exists and wraps exactly the right subtree, so the prop comes here instead.
   *
   * Only affects the NATIVE container. The DOM inside the WebView builds its own accessibility tree
   * that React Native props cannot reach — `AccessibilityPrefs.screenReaderHints` carries the same
   * warning. Hiding the container is what stops a swipe landing on the book behind an open panel;
   * it is not a claim about the document's internal semantics.
   */
  hidden?: boolean;
  /**
   * Accessible name for the container, so the book is a reachable, named stop between the toolbar
   * and the bottom controls instead of an unlabelled gap in the traversal.
   */
  accessibilityLabel?: string;
}

export function ReaderWebView({
  sourceUri,
  onMessage,
  onHostError,
  onReady,
  scrollEnabled = false,
  hidden = false,
  accessibilityLabel,
}: ReaderWebViewProps): React.JSX.Element {
  const webViewRef = useRef<WebView>(null);
  const [isReady, setIsReady] = useState(false);

  // Refs, not deps: these are called from WebView callbacks, and putting the
  // callback props in a dependency array would re-arm the ready timer (or worse,
  // reload the WebView) every time the parent re-renders with new closures.
  const onMessageRef = useRef(onMessage);
  const onHostErrorRef = useRef(onHostError);
  const onReadyRef = useRef(onReady);

  // Refreshed in an effect, not inline during render — react-hooks/refs forbids
  // writing a ref while rendering. useRef's initial values already make the first
  // render correct, so this only keeps them current on subsequent renders.
  // Intentionally NO dependency array: it must run after every render.
  useEffect(() => {
    onMessageRef.current = onMessage;
    onHostErrorRef.current = onHostError;
    onReadyRef.current = onReady;
  });

  const send = useCallback((command: ReaderCommand): void => {
    webViewRef.current?.injectJavaScript(buildCommandScript(command));
  }, []);

  // Ready-or-timeout. Cleared on unmount and as soon as `ready` lands.
  useEffect(() => {
    if (isReady) return;

    const timer = setTimeout(() => {
      onHostErrorRef.current(
        'READY_TIMEOUT',
        `The reader did not report ready within ${READY_TIMEOUT_MS / 1000}s. ` +
          `The bundled reader shell may be missing or failed to execute.`,
      );
    }, READY_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isReady]);

  /**
   * Intentionally SYNCHRONOUS: nothing on this path needs to await, and a
   * floating rejection here would surface as a reader that silently stops
   * responding rather than as an error.
   *
   * This used to be the whole defence, because type-aware ESLint was off and
   * `no-floating-promises` could not run. It is now enabled for this directory
   * (see eslint.config.js), so if this ever does need to go async, the rule —
   * not this comment — is what will hold the line.
   */
  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const raw = event.nativeEvent.data;
      const message = parseReaderMessage(raw);

      if (!message) {
        // Unparseable payload: almost always a drift between readerBridge.ts and
        // the hand-synced JS in the WebView templates. Truncated so a huge payload
        // cannot blow up the error banner.
        onHostErrorRef.current(
          'BRIDGE_PARSE_FAILED',
          `Unrecognised message from the reader WebView: ${raw.slice(0, 200)}`,
        );
        return;
      }

      if (message.type === 'ready') {
        setIsReady(true);
        onReadyRef.current(send);
      }

      onMessageRef.current(message);
    },
    [send],
  );

  /**
   * NAVIGATION ALLOW-LIST. Default is DENY.
   *
   * The only load this WebView should ever perform is the initial local
   * reader shell. epub.js renders chapters into same-document iframes with blob:
   * / about: URLs — it does not navigate the top-level document — so nothing
   * legitimate is refused here.
   *
   * Anything else (a book with an <a href="https://...">, an injected redirect,
   * a form post) is refused and reported rather than silently dropped, so an
   * attempted escape is visible instead of looking like a dead link.
   */
  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      const { url } = request;

      // The initial document, and the schemes epub.js uses internally.
      if (
        url === sourceUri ||
        url.startsWith('file://') ||
        url.startsWith('blob:') ||
        url.startsWith('about:') ||
        url === 'about:blank'
      ) {
        return true;
      }

      onHostErrorRef.current(
        'BLOCKED_NAVIGATION',
        `Blocked navigation to ${url}. The reader is offline-only and must not leave the bundled document.`,
      );
      return false;
    },
    [sourceUri],
  );

  // Belt-and-braces for platforms/paths where a navigation can slip past
  // onShouldStartLoadWithRequest (Android has historically let some redirects
  // through). If the document ever ends up somewhere it should not be, stop it.
  const handleNavigationStateChange = useCallback(
    (navigation: WebViewNavigation): void => {
      const { url } = navigation;
      if (url && !url.startsWith('file://') && !url.startsWith('about:') && url !== sourceUri) {
        webViewRef.current?.stopLoading();
        onHostErrorRef.current('BLOCKED_NAVIGATION', `Blocked navigation to ${url}.`);
      }
    },
    [sourceUri],
  );

  return (
    <View
      style={styles.container}
      testID="reader-webview-container"
      accessibilityLabel={accessibilityLabel}
      // The two-prop pair this codebase already uses for "keep assistive tech out of here" (the
      // swipe catcher, the privacy cover, the TOC fades). `importantForAccessibility` is explicitly
      // set back to 'yes' rather than left undefined: it must un-hide when the panel closes, and
      // 'auto' would let a previously-applied 'no-hide-descendants' linger on some Android versions.
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'yes'}
    >
      <WebView
        ref={webViewRef}
        source={{ uri: sourceUri }}
        // Local file, so the origin is the file scheme. NOT '*' — see the header.
        //
        // `about:*` AND NOT `about:blank`: epub.js renders each chapter by
        // assigning `iframe.srcdoc`, which WKWebView surfaces to RN as a
        // navigation to `about:srcdoc`. react-native-webview checks
        // originWhitelist BEFORE it calls onShouldStartLoadWithRequest, so a
        // too-narrow list here silently kills the chapter iframe: display() never
        // resolves, no 'rendered' is posted, and the screen sits on "Opening
        // book…" forever with NO error — our handler, the thing that would have
        // raised BLOCKED_NAVIGATION, is never reached. The whitelist is a coarse
        // pre-filter; handleShouldStartLoad below is the real allow-list.
        originWhitelist={['file://*', 'about:*']}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        // Required: the bridge and epub.js are JS.
        javaScriptEnabled
        // Required: the document itself is loaded from file://.
        allowFileAccess
        // DELIBERATELY OFF. These would let file:// content read other local
        // files and treat every file:// origin as same-origin — the classic
        // Android WebView local-file exfiltration primitive. The shell is
        // self-contained and needs neither.
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        // No downloads, no new windows, no third-party cookies, no autoplay
        // surface. Nothing in a book should be able to open anything.
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        thirdPartyCookiesEnabled={false}
        cacheEnabled={false}
        incognito
        // Pagination is driven by the bridge, not by dragging the document — EXCEPT in
        // continuous-scroll flow, where the caller opts this in. See the prop doc above.
        scrollEnabled={scrollEnabled}
        bounces={false}
        overScrollMode="never"
        // Transport-level failures. Without these, a bad URI is a white screen.
        onError={(event) => {
          const { description, code } = event.nativeEvent;
          onHostErrorRef.current(
            'WEBVIEW_LOAD_FAILED',
            `WebView failed to load (${code}): ${description}`,
          );
        }}
        onHttpError={(event) => {
          const { statusCode, url } = event.nativeEvent;
          onHostErrorRef.current('WEBVIEW_LOAD_FAILED', `HTTP ${statusCode} loading ${url}`);
        }}
        onRenderProcessGone={() => {
          onHostErrorRef.current(
            'WEBVIEW_LOAD_FAILED',
            'The WebView render process was terminated (likely out of memory).',
          );
        }}
        onContentProcessDidTerminate={() => {
          onHostErrorRef.current(
            'WEBVIEW_LOAD_FAILED',
            'The WebView content process was terminated (likely out of memory).',
          );
        }}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // flex:1 all the way down. epub.js measures its container, and a zero-height
  // ancestor anywhere in this chain renders a blank page with no error — the
  // single most common false "epub.js is broken" report.
  container: { flex: 1 },
  webView: { flex: 1, backgroundColor: '#ffffff' },
});
