// Owner: Reader (Ahana).
//
// The reader screen: WebView + Prev/Next/Contents controls + a visible error
// banner, reading decrypted bytes through the ContentProvider seam.
//
// Colours are inline for the same reason App.tsx's are: src/theme/ has not landed
// yet. Replace with tokens when it does.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { closeBook } from '@/features/encryption/contentProvider';
import { ReaderWebView } from '@/features/reader/ReaderWebView';
import { getBookBase64, getReaderHtmlUri } from '@/features/reader/readerAssets';
import type {
  ReaderCommand,
  ReaderErrorCode,
  ReaderMessage,
  ReaderTocItem,
} from '@/features/reader/readerBridge';
import { logEvent, logSpan, now } from '@/features/reader/readerTiming';
import { ContentFailure } from '@/shared/contracts';
import type { BookId } from '@/shared/contracts';

interface ReaderError {
  code: ReaderErrorCode;
  message: string;
}

interface ReaderScreenProps {
  /**
   * Identifies the ContentStore session `getBook(bookId)` opens and
   * `closeBook(bookId)` wipes.
   *
   * REQUIRED, deliberately: while it was optional the teardown effect below hit
   * an early return and never ran, so the "wipe on close" guarantee was dead
   * code. Making it required is what keeps that from silently regressing.
   */
  bookId: BookId;
}

export function ReaderScreen({ bookId }: ReaderScreenProps): React.JSX.Element {
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [send, setSend] = useState<((command: ReaderCommand) => void) | null>(null);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [error, setError] = useState<ReaderError | null>(null);

  // When the `open` command was handed to injectJavaScript. A ref, not state: it is written on the
  // bridge path and read in the message handler, and re-rendering on it would perturb the very
  // interval being measured. `rendered - openSentAt` is the only view we get of bridge transfer +
  // atob + the charCodeAt loop + JSZip + epub.js, and it costs no change to the bridge itself.
  const openSentAtRef = useRef<number | null>(null);

  /**
   * Covers the rendered book while the app is not frontmost.
   *
   * NOT cosmetic — this closes a measured leak. iOS writes a full-screen capture of the app into
   * Library/SplashBoard/Snapshots/ when it backgrounds, to animate the app switcher. Verified on
   * 2026-08-13 by backgrounding with a 20 MB book open and decoding the resulting .ktx: it
   * contained fully legible body text, the page number and two figures. That is decrypted licensed
   * content at rest on disk, which is the one thing this feature must never produce — and it
   * bypasses every other control, because ContentStore is careful, the WebView is `incognito`, and
   * none of that matters when the window server photographs the screen.
   *
   * `inactive` matters as much as `background`: iOS snapshots during the inactive transition, so
   * gating on 'background' alone covers too late to be useful.
   *
   * Honest limitation: this is a race we usually win, not a guarantee. The real guarantee is
   * platform-level — Android has FLAG_SECURE (already a T4 dependency); iOS has no equivalent for
   * the switcher snapshot, so an opaque cover driven by AppState is the accepted mitigation.
   */
  const [isObscured, setIsObscured] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsObscured(nextState !== 'active');
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const raiseError = useCallback((code: ReaderErrorCode, message: string): void => {
    setError({ code, message });
  }, []);

  // Resolve the bundled reader.html before mounting the WebView.
  //
  // The `cancelled` flag is the standard unmount guard: without it, navigating
  // away mid-resolve sets state on an unmounted component. The `void` is now
  // REQUIRED, not stylistic — no-floating-promises is enabled for this directory
  // (see eslint.config.js) and removing it is a lint error. It marks "this
  // rejection is handled below" rather than "this promise was forgotten", and the
  // catch() is the only thing standing between an asset failure and a
  // permanently blank screen.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const uri = await getReaderHtmlUri();
        if (!cancelled) setHtmlUri(uri);
      } catch (cause) {
        if (!cancelled) {
          raiseError(
            'ASSET_LOAD_FAILED',
            `Could not resolve the bundled reader.html. Run \`npm run reader:build-html\`. ` +
              `(${cause instanceof Error ? cause.message : String(cause)})`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [raiseError]);

  // LIFECYCLE, not optional — contentProvider.ts states it outright: closeBook()
  // MUST run when the reader view for a book closes, or the whole decrypted book
  // stays in RAM indefinitely.
  //
  // Its OWN effect keyed on [bookId], not folded into the htmlUri effect above,
  // so it also fires when the screen SWITCHES books rather than only on unmount.
  // Sharing that effect would tie teardown to `raiseError` and re-run it for
  // reasons unrelated to the session.
  //
  // Fire-and-forget with an explicit catch: React cleanups cannot be async, and a
  // rejected teardown must not surface as an unhandled rejection. There is also
  // nothing useful to show the user — the screen is already gone.
  useEffect(() => {
    return () => {
      void (async () => {
        try {
          await closeBook(bookId);
        } catch {
          // Teardown is best-effort: close() zeroes the session buffer itself, and
          // the screen has already unmounted, so there is no error state left to
          // render into.
        }
      })();
    };
  }, [bookId]);

  /**
   * Fires when the WebView reports `ready`. Only now is it safe to inject —
   * window.TFReader does not exist before this.
   *
   * setSend takes a FUNCTION because useState treats a function argument as a
   * lazy initialiser and would call it instead of storing it. Storing a callback
   * in state is exactly the case that trips on that.
   */
  const handleReady = useCallback(
    (sender: (command: ReaderCommand) => void): void => {
      setSend(() => sender);
      logEvent('ready');

      void (async () => {
        try {
          const base64 = await getBookBase64(bookId);
          openSentAtRef.current = now();
          logEvent('open sent', { chars: base64.length });
          sender({ type: 'open', base64 });
        } catch (cause) {
          // ContentFailure carries a typed ContentError discriminant (and the
          // bookId) that a bare message would throw away. Surfacing that code is
          // what lets "the licence expired" be told apart from "the ciphertext
          // was tampered with" on screen, which errors.ts requires be distinct
          // and explicit rather than one generic failure.
          raiseError(
            'CONTENT_LOAD_FAILED',
            cause instanceof ContentFailure
              ? `Could not open this book: ${cause.code}. (${String(cause.cause ?? cause.message)})`
              : `Could not open this book. ` +
                  `(${cause instanceof Error ? cause.message : String(cause)})`,
          );
        }
      })();
    },
    [bookId, raiseError],
  );

  const handleMessage = useCallback((message: ReaderMessage): void => {
    switch (message.type) {
      case 'ready':
        // Handled by onReady, which also carries the sender.
        break;
      case 'rendered':
        if (openSentAtRef.current !== null) {
          logSpan('open -> rendered', openSentAtRef.current);
        }
        setIsRendered(true);
        break;
      case 'relocated':
        // The CFI lands here. Nothing consumes it yet — persisting it belongs to
        // Personalization's Progress record, whose open question is exactly that
        // an integer offset cannot anchor a reflowable EPUB and a CFI can.
        break;
      case 'toc':
        setToc(message.items);
        break;
      case 'error':
        // Timed as well as rendered: on the large-payload smoke test a returning OPEN_FAILED is the
        // signal that the transport SURVIVED, so its elapsed time is a real measurement, not a
        // footnote to a failure.
        if (openSentAtRef.current !== null) {
          logSpan('open -> error', openSentAtRef.current, { code: message.code });
        }
        setError({ code: message.code, message: message.message });
        break;
    }
  }, []);

  // `target` is a spine href or an EPUB CFI — see ReaderCommand in readerBridge.ts.
  // A SearchHit carries a `Locator`; unwrap it to `locator.cfi` here rather than
  // sending the union across the bridge.
  const goTo = useCallback(
    (target: string): void => {
      setShowToc(false);
      send?.({ type: 'goTo', target });
    },
    [send],
  );

  const isBusy = htmlUri === null || (!isRendered && error === null);

  return (
    <View style={styles.container}>
      {error !== null && (
        <View style={styles.errorBanner} accessibilityLiveRegion="polite">
          <Text style={styles.errorCode}>{error.code}</Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
        </View>
      )}

      <View style={styles.viewer}>
        {htmlUri !== null && (
          <ReaderWebView
            sourceUri={htmlUri}
            onMessage={handleMessage}
            onHostError={raiseError}
            onReady={handleReady}
          />
        )}

        {isBusy && (
          <View style={styles.busy} pointerEvents="none">
            <ActivityIndicator />
            <Text style={styles.busyText}>Opening book…</Text>
          </View>
        )}

        {showToc && (
          <View style={styles.tocPanel}>
            <Text style={styles.tocTitle}>Contents</Text>
            <ScrollView>
              {toc.length === 0 ? (
                <Text style={styles.tocEmpty}>No table of contents in this book.</Text>
              ) : (
                // Index-composed key, NOT `item.href` alone. A real book's TOC repeats hrefs: the
                // 20 MB fixture's NCX has src="Accessed%2024" five times (malformed nav points the
                // producer emitted from citation text), which collided and raised React's
                // duplicate-key warning on device. hrefs are not unique in the wild, so they cannot
                // be identity here.
                toc.map((item, index) => (
                  <Pressable
                    key={`${index}-${item.href}`}
                    onPress={() => {
                      goTo(item.href);
                    }}
                    style={styles.tocItem}
                  >
                    <Text style={styles.tocItemText}>{item.label}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {/* LAST child of `viewer`, deliberately: it must paint over the WebView, the busy overlay
            and the TOC panel, all of which can be showing book-derived content. */}
        {isObscured && (
          <View
            style={styles.privacyCover}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.privacyCoverText}>TF Reader</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          disabled={send === null}
          onPress={() => send?.({ type: 'prev' })}
          style={[styles.button, send === null && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>‹ Prev</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={toc.length === 0}
          onPress={() => {
            setShowToc((open) => !open);
          }}
          style={[styles.button, toc.length === 0 && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{showToc ? 'Close' : `Contents (${toc.length})`}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={send === null}
          onPress={() => send?.({ type: 'next' })}
          style={[styles.button, send === null && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Next ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Overlay fill. See the note on `busy` below for why this is not absoluteFillObject. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  // flex:1 down to the WebView. See the note in ReaderWebView.tsx — epub.js
  // renders nothing at all into a zero-height container.
  container: { flex: 1, backgroundColor: '#ffffff' },
  viewer: { flex: 1 },

  // Explicit inset rather than StyleSheet.absoluteFillObject: RN 0.86's types
  // export only `absoluteFill`, so the *Object form is a typecheck error here.
  busy: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  busyText: { marginTop: 8, fontSize: 13, color: '#555555' },

  errorBanner: {
    backgroundColor: '#fdf2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#f0c8c8',
    padding: 12,
  },
  errorCode: { fontSize: 12, fontWeight: '700', color: '#8a1c1c' },
  errorMessage: { marginTop: 4, fontSize: 13, color: '#8a1c1c' },

  tocPanel: {
    ...FILL,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e2e2',
    padding: 16,
  },
  tocTitle: { fontSize: 18, fontWeight: '600', color: '#111111', marginBottom: 12 },
  tocEmpty: { fontSize: 14, color: '#777777' },
  tocItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tocItemText: { fontSize: 15, color: '#111111' },

  // FULLY OPAQUE is the whole point — a translucent cover still photographs the text underneath.
  privacyCover: {
    ...FILL,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyCoverText: { fontSize: 17, fontWeight: '600', color: '#8a8a8a' },

  controls: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e2e2e2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111111' },
});
