// Owner: Reader (Ahana).
//
// The WebView host. Loads the generated, self-contained assets/reader/reader.html
// and speaks the readerBridge protocol to it. Knows nothing about where bytes
// come from (readerAssets.ts owns that) and renders no chrome (ReaderScreen does).
//
// >>> WHY THIS WEBVIEW IS LOCKED DOWN AS HARD AS IT IS <<<
// Today it renders a 3.6KB plaintext fixture, so none of this is load-bearing
// yet. It is written this way now because THIS COMPONENT IS WHERE DECRYPTED,
// LICENSED BOOK CONTENT WILL BE RENDERED. Once whole-book decrypt lands, the
// HTML/CSS/JS inside a book is untrusted input running in a context that holds
// plaintext, and the failure mode is exfiltration — a book that navigates or
// beacons out. Locking navigation down after that content arrives means
// retrofitting security onto a live path; locking it down now costs nothing.
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
  /** file:// URI of the generated reader.html, from getReaderHtmlUri(). */
  sourceUri: string;
  /** Every bridge message, already parsed and narrowed. */
  onMessage: (message: ReaderMessage) => void;
  /** Host-side failures (see HOST_ERROR_CODES) that never came over the bridge. */
  onHostError: (code: ReaderErrorCode, message: string) => void;
  /** Called once the bridge is up; hand back a sender for RN -> WebView commands. */
  onReady: (send: (command: ReaderCommand) => void) => void;
}

export function ReaderWebView({
  sourceUri,
  onMessage,
  onHostError,
  onReady,
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
          `The bundled reader.html may be missing or failed to execute.`,
      );
    }, READY_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isReady]);

  /**
   * NOTE: this handler is intentionally SYNCHRONOUS and does no async work.
   *
   * Type-aware ESLint is off repo-wide (a deliberate choice recorded in
   * eslint.config.js), so `@typescript-eslint/no-floating-promises` is NOT
   * available to catch a dropped promise here. A floating rejection in this
   * handler would surface as a reader that silently stops responding. Keeping it
   * sync removes the hazard rather than relying on a rule that cannot run.
   */
  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const raw = event.nativeEvent.data;
      const message = parseReaderMessage(raw);

      if (!message) {
        // Unparseable payload: almost always a drift between readerBridge.ts and
        // the hand-synced JS in reader.template.html. Truncated so a huge payload
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
   * reader.html. epub.js renders chapters into same-document iframes with blob:
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
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: sourceUri }}
        // Local file, so the origin is the file scheme. NOT '*' — see the header.
        //
        // `about:*`, NOT `about:blank`: epub.js renders each chapter by assigning
        // `iframe.srcdoc` (epub.js dist, View.prototype.create -> `this.iframe.srcdoc
        // = contents`), and WKWebView surfaces that to RN as a navigation to
        // `about:srcdoc`. react-native-webview checks originWhitelist BEFORE it ever
        // calls onShouldStartLoadWithRequest (see createOnShouldStartLoadWithRequest
        // in WebViewShared.js), so a too-narrow list here silently kills the chapter
        // iframe: `rendition.display()` never resolves, no 'rendered' is posted, and
        // the screen sits on "Opening book…" forever with NO error, because our own
        // handler — the thing that would have raised BLOCKED_NAVIGATION — was never
        // reached. The whitelist is a coarse pre-filter, not the security boundary;
        // handleShouldStartLoad below is still the real allow-list.
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
        // Android WebView local-file exfiltration primitive. reader.html is
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
        // Pagination is driven by the bridge, not by dragging the document.
        scrollEnabled={false}
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
