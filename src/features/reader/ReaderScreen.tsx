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

import { LinearGradient } from 'expo-linear-gradient';

import { closeBook } from '@/features/encryption/contentProvider';
import { DownloadFailure } from '@/features/download/errors';
import { ReaderWebView } from '@/features/reader/ReaderWebView';
import {
  getBookBase64,
  getReaderHtmlUri,
  prepareBook,
  UnsupportedFormatError,
} from '@/features/reader/readerAssets';
import type {
  ReaderCommand,
  ReaderErrorCode,
  ReaderMessage,
  ReaderTocItem,
} from '@/features/reader/readerBridge';
import { logEvent, logSpan, now } from '@/features/reader/readerTiming';
import { SearchMatchBar } from '@/features/reader/SearchMatchBar';
import { SearchPanel } from '@/features/reader/SearchPanel';
import { cfiOf, useBookSearch } from '@/features/reader/useBookSearch';
import { ContentFailure } from '@/shared/contracts';
import type { BookId, ContentFormat } from '@/shared/contracts';

interface ReaderError {
  code: ReaderErrorCode;
  message: string;
}

/**
 * How long to wait for the byte path before giving up on this open.
 *
 * WHY A BOUND IS NEEDED AT ALL. `getBookBase64` now begins with Download's per-open
 * access re-check (`verifyReadingAccess` → `POST /api/v1/reading-sessions`), and that
 * call has no timeout of its own — no `AbortSignal` anywhere in
 * `src/features/download/`. Airplane mode rejects fast, so that case is fine; a
 * reachable-but-unresponsive backend (captive portal, VPN, backend down) does not,
 * and blocks on iOS URLSession's ~60s default. Nothing else covers that window:
 * `READY_TIMEOUT` in ReaderWebView is cleared the moment the bridge reports `ready`,
 * which happens BEFORE this runs. So without this, a book whose bytes are already on
 * the device sits behind "Opening book…" for a minute with no error and no way to
 * tell it from a slow decrypt.
 *
 * 20s: comfortably above the worst measured warm open (~5s for a 20 MB book, ~93% of
 * it Encryption's decrypt) with room for a cold read and the access check, and well
 * under the platform timeout it exists to pre-empt.
 *
 * WHAT THIS DOES NOT DO, and the distinction matters: it does not CANCEL anything.
 * There is no cancellation to propagate — `fetch` here takes no signal and
 * `getBook`'s decrypt is not interruptible. This bounds what the READER WAITS FOR,
 * not what the system does. The work continues, and the consequences are recorded on
 * `withOpenTimeout` below.
 */
const OPEN_TIMEOUT_MS = 20_000;

/**
 * Raised only by `withOpenTimeout`. A distinct class rather than a flag on Error so
 * the catch below can tell "we stopped waiting" from "the open failed" without
 * matching on a message string.
 */
class OpenTimedOut extends Error {
  constructor() {
    super(`The byte path did not settle within ${OPEN_TIMEOUT_MS}ms.`);
    this.name = 'OpenTimedOut';
  }
}

/**
 * Resolve with `work`, or reject with OpenTimedOut once OPEN_TIMEOUT_MS has passed.
 *
 * `work.then(...)` IS THE POINT OF THIS SHAPE, not `Promise.race`. Handlers are
 * attached to `work` unconditionally and stay attached after the timeout has already
 * rejected, so when the abandoned open finally settles — and it will, minutes later
 * if the platform is waiting on a socket — a rejection has somewhere to go. A
 * `Promise.race` would leave that late rejection unhandled, which in React Native
 * surfaces as a redbox in dev pointing at code that gave up long ago.
 *
 * TWO CONSEQUENCES OF NOT CANCELLING, both deliberate:
 *  1. The decrypt finishes into nothing. A ~27 MB base64 string is built and dropped
 *     for a book nobody is reading. It is garbage after that; the peak, however, is
 *     real while it happens.
 *  2. The ContentStore session opens anyway, so the plaintext is resident even though
 *     the reader saw an error. `closeBook` on unmount is what reclaims it — the same
 *     teardown as a normal read. Calling closeBook here instead was considered and
 *     rejected: the decrypt may not have created the session yet, so a close would
 *     be a no-op and the session would then appear behind it, leaving the plaintext
 *     resident with nothing left to release it.
 */
function withOpenTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OpenTimedOut());
    }, OPEN_TIMEOUT_MS);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
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

  // Which renderer this book needs. Drives BOTH the shell that gets loaded and the
  // open command that gets sent, so the two can never disagree — a PDF shell asked
  // to openEpub would answer NOT_READY, which is a confusing way to learn about a
  // routing bug.
  const [format, setFormat] = useState<ContentFormat | null>(null);
  const [send, setSend] = useState<((command: ReaderCommand) => void) | null>(null);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [error, setError] = useState<ReaderError | null>(null);

  // Search state lives ABOVE the panel, so closing and reopening it keeps the results
  // and the place you had reached in them.
  const search = useBookSearch(bookId);

  /**
   * Which edges of the Contents list are currently faded.
   *
   * ONE STATE OBJECT OF TWO BOOLEANS, NOT THE SCROLL OFFSET. Keeping the offset in
   * state would re-render the whole panel — every row — on every scroll frame. These
   * flip at most twice per gesture, and setFades() below returns the previous object
   * unchanged when nothing flipped, so React bails out of the render entirely.
   */
  const [fades, setFades] = useState({ top: false, bottom: false });

  // Measurements behind the fades, in refs for the same reason: they are inputs to a
  // derived boolean, and nothing should re-render because a scroll offset moved.
  const listFrameRef = useRef(0);
  const listContentRef = useRef(0);
  const listOffsetRef = useRef(0);

  /**
   * Decide which edges get a fade from the three numbers above.
   *
   * Driven from THREE events, not just onScroll: a list too short to scroll never
   * emits a scroll event at all, so onLayout (frame) and onContentSizeChange (content)
   * are what stop a fade appearing over a list that has nothing hidden below it.
   */
  const recomputeFades = useCallback((): void => {
    const frame = listFrameRef.current;
    const content = listContentRef.current;
    const offset = listOffsetRef.current;
    const scrollable = content > frame + FADE_EPSILON_PX;

    const next = {
      top: scrollable && offset > FADE_EPSILON_PX,
      bottom: scrollable && offset + frame < content - FADE_EPSILON_PX,
    };

    setFades((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, []);

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

  // Resolve the book's format and its matching shell before mounting the WebView.
  //
  // The `cancelled` flag is the standard unmount guard: without it, navigating
  // away mid-resolve sets state on an unmounted component. The `void` is now
  // REQUIRED, not stylistic — no-floating-promises is enabled for this directory
  // (see eslint.config.js) and removing it is a lint error. It marks "this
  // rejection is handled below" rather than "this promise was forgotten", and the
  // catch() is the only thing standing between an asset failure and a
  // permanently blank screen.
  //
  // FORMAT IS RESOLVED BEFORE THE WEBVIEW MOUNTS, and that ordering is forced by
  // there being one shell per format: the URI cannot be chosen without knowing which
  // renderer the book needs. The visible consequence is that a COLD seed now happens
  // before first paint rather than alongside it, so the very first open after install
  // shows the spinner slightly longer. The compensation is that READY_TIMEOUT's clock
  // starts when the WebView actually starts loading, which is what it was always
  // meant to measure.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const resolved = await prepareBook(bookId);
        if (cancelled) return;
        setFormat(resolved);

        const uri = await getReaderHtmlUri(resolved);
        if (!cancelled) setHtmlUri(uri);
      } catch (cause) {
        if (cancelled) return;

        // A format with no renderer is not an asset failure — the asset is fine,
        // there just isn't one for this book. Reported under its own code so the
        // message can say something true instead of telling the reader to run a
        // build script.
        if (cause instanceof UnsupportedFormatError) {
          raiseError(
            'UNSUPPORTED_FORMAT',
            `This book is ${cause.format} content, which this reader cannot open yet. ` +
              `EPUB and PDF are supported.`,
          );
          return;
        }

        raiseError(
          'ASSET_LOAD_FAILED',
          `Could not prepare this book for reading. If the reader shell failed to resolve, ` +
            `run \`npm run reader:build-html\`. ` +
            `(${cause instanceof Error ? cause.message : String(cause)})`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId, raiseError]);

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
          // Cannot be null in practice: the WebView is only rendered once `format`
          // is set (it is what chose the shell), and `ready` can only arrive from a
          // rendered WebView. Checked rather than asserted because a non-null
          // assertion here would be a promise the type system cannot keep.
          if (format === null) {
            raiseError('UNSUPPORTED_FORMAT', 'The reader became ready before its format was known.');
            return;
          }

          const base64 = await withOpenTimeout(getBookBase64(bookId, format));
          openSentAtRef.current = now();
          logEvent('open sent', { chars: base64.length, format });

          // EXHAUSTIVE ON PURPOSE. This switch is the entire seam where
          // ContentFormat becomes a bridge command, and the `never` default is what
          // makes adding a fourth ContentFormat member a COMPILE error here rather
          // than a book that silently opens in the wrong renderer. Do not replace it
          // with an if/else or a lookup table that has a fallback.
          switch (format) {
            case 'EPUB':
              sender({ type: 'openEpub', base64 });
              break;
            case 'PDF':
              sender({ type: 'openPdf', base64 });
              break;
            case 'AUDIO':
              // Unreachable: getReaderHtmlUri already refused this format, so no
              // WebView exists to be ready. Handled anyway so the switch is total.
              raiseError(
                'UNSUPPORTED_FORMAT',
                `This book is ${format} content, which this reader cannot open yet.`,
              );
              break;
            default: {
              const unhandled: never = format;
              throw new Error(`Unhandled ContentFormat: ${String(unhandled)}`);
            }
          }
        } catch (cause) {
          if (cause instanceof OpenTimedOut) {
            raiseError(
              'CONTENT_LOAD_TIMEOUT',
              `Opening this book took longer than ${OPEN_TIMEOUT_MS / 1000}s and was given up on. ` +
                `The book's own bytes are already on this device, so this is usually the network: ` +
                `the per-open access check has no timeout of its own.`,
            );
            return;
          }

          // ContentFailure carries a typed ContentError discriminant (and the
          // bookId) that a bare message would throw away. Surfacing that code is
          // what lets "the licence expired" be told apart from "the ciphertext
          // was tampered with" on screen, which errors.ts requires be distinct
          // and explicit rather than one generic failure.
          // DownloadFailure (added 2026-08-14, verifyReadingAccess's per-open access re-check —
          // readerAssets.ts's getBookBase64) carries the same kind of typed `.code` ContentFailure
          // does, just from Download's own carrier (errors.ts) rather than Encryption's — checked
          // alongside it for the same reason: a bare message would throw away which access-
          // revocation code this was.
          raiseError(
            'CONTENT_LOAD_FAILED',
            cause instanceof ContentFailure
              ? `Could not open this book: ${cause.code}. (${String(cause.cause ?? cause.message)})`
              : cause instanceof DownloadFailure
                ? `Could not open this book: ${cause.code}. (${String(cause.cause ?? cause.message)})`
                : `Could not open this book. ` +
                  `(${cause instanceof Error ? cause.message : String(cause)})`,
          );
        }
      })();
    },
    [bookId, format, raiseError],
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
  // A SearchHit carries a `Locator`; it is unwrapped to `locator.cfi` by cfiOf() in
  // useBookSearch.ts rather than sent across the bridge as the union.
  const goTo = useCallback(
    (target: string): void => {
      setShowToc(false);
      send?.({ type: 'goTo', target });
    },
    [send],
  );

  /**
   * Seek to a search hit and dismiss the results, leaving the match bar behind.
   *
   * Dismissing is the point: the panel covers the page, so staying open would hide the
   * text the jump just went to. The match bar floats, so stepping continues against
   * the book itself.
   *
   * Deliberately not `goTo`: that closes the Contents panel, which is the right
   * teardown for a TOC entry and the wrong one here.
   */
  const selectHit = useCallback(
    (index: number): void => {
      const hit = search.hits[index];
      if (!hit) return;
      const cfi = cfiOf(hit);
      if (cfi === null) return; // PDF hit: listed in the panel, but nowhere to send it
      search.setActiveIndex(index);
      setShowSearch(false);
      send?.({ type: 'goTo', target: cfi });
    },
    [search, send],
  );

  const stepHit = useCallback(
    (delta: 1 | -1): void => {
      // With nothing selected, the first press lands on the first (or last) match.
      // Starting from activeIndex + delta would reach index 0 only by accident of
      // -1 + 1, and would skip the last match when stepping backwards.
      const from =
        search.activeIndex < 0
          ? delta === 1
            ? 0
            : search.hits.length - 1
          : search.activeIndex + delta;

      for (let i = from; i >= 0 && i < search.hits.length; i += delta) {
        if (cfiOf(search.hits[i]) !== null) {
          selectHit(i);
          return;
        }
      }
      // Nothing navigable that way. CLAMP rather than wrap: the arrows disable at the
      // ends, and wrapping would contradict what the UI is showing.
    },
    [search.activeIndex, search.hits, selectHit],
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

      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          // The repo's first accessibilityLabel, and required rather than stylistic: a
          // glyph child gives a screen reader nothing to say, and every existing test
          // finds buttons by accessible name.
          accessibilityLabel="Search this book"
          onPress={() => {
            // Mutual exclusion with Contents. Not cosmetic: both panels' toggles read
            // "Close" when open, and two buttons with that name make every
            // getByRole('button', { name: 'Close' }) ambiguous.
            setShowToc(false);
            setShowSearch((open) => !open);
          }}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarIcon}>🔍</Text>
        </Pressable>
      </View>

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
            {/*
              DO NOT ADD `flex: 1` HERE "so the list scrolls". It was tried, and it is a
              no-op: RN's ScrollView already carries flexGrow/flexShrink: 1 in its own
              base style (react-native/Libraries/Components/ScrollView/ScrollView.js:1881),
              so it is already bounded by this absolutely-filled panel. Measured on device
              2026-08-14 with the 22-entry fixture TOC and NO style here: frame 600pt,
              content 1054pt — i.e. already scrolling. Yoga's flexShrink: 0 default, which
              is the usual reason to reach for flex: 1, does not apply to ScrollView.
            */}
            {/*
              The fades anchor to THIS wrapper rather than to the panel, so their
              offsets are the list's own edges — no restating the panel's padding and
              no guessing the header's height. `flex: 1` IS needed here (unlike on the
              ScrollView, which brings its own base style): a plain View defaults to
              flexShrink: 0.
            */}
            <View style={styles.tocListWrap}>
              <ScrollView
                testID="reader-toc-list"
                // BOUNDING THE LIST, which is a different problem from scrolling it. The
                // panel's edge cuts whichever row happens to cross it, and a row sliced
                // by a straight edge reads as a broken layout rather than as "there is
                // more below". Four parts:
                //  - the fades below dissolve the cut instead of ending it on a line;
                //  - contentContainerStyle's paddingBottom lets the FINAL entry come
                //    fully clear of the edge rather than resting half-hidden under it;
                //  - the divider above the list closes the header off;
                //  - the scroll indicator is the affordance that says "scrollable".
                // The three handlers feed recomputeFades — see the note there for why a
                // short list needs all three and not just onScroll.
                style={styles.tocList}
                contentContainerStyle={styles.tocListContent}
                showsVerticalScrollIndicator
                scrollEventThrottle={16}
                onLayout={(event) => {
                  listFrameRef.current = event.nativeEvent.layout.height;
                  recomputeFades();
                }}
                onContentSizeChange={(_width, height) => {
                  listContentRef.current = height;
                  recomputeFades();
                }}
                onScroll={(event) => {
                  listOffsetRef.current = event.nativeEvent.contentOffset.y;
                  recomputeFades();
                }}
              >
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
                      // Indent, do not inset the row: paddingLeft keeps the whole
                      // width tappable at every depth, where marginLeft would shrink
                      // the touch target of the entries that are already hardest to
                      // hit. `depth` is clamped by parseReaderMessage, so this cannot
                      // run away.
                      style={[styles.tocItem, { paddingLeft: item.depth * TOC_INDENT_PX }]}
                    >
                      <Text style={styles.tocItemText}>{item.label}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>

              {/*
              THE FADES. Rendered as siblings AFTER the ScrollView so they paint over
              it, and `pointerEvents="none"` so they never eat a tap meant for the row
              underneath — a fade that swallows touches is worse than the sliced row it
              replaced.

              Conditional rather than always-mounted with zero opacity: at the top of
              the list there is nothing above to fade, and a permanent white veil over
              the first row would be the same visual bug in a different place.

              The colour is the panel's own background, so the gradient dissolves the
              row into the panel rather than tinting it. If the panel ever stops being
              #ffffff (src/theme/ landing, or a dark theme) these two constants move
              with it — which is why they sit next to it rather than inline.
            */}
              {fades.top && (
                <LinearGradient
                  testID="reader-toc-fade-top"
                  pointerEvents="none"
                  colors={TOC_FADE_DOWN}
                  style={[styles.tocFade, styles.tocFadeTop]}
                />
              )}
              {fades.bottom && (
                <LinearGradient
                  testID="reader-toc-fade-bottom"
                  pointerEvents="none"
                  colors={TOC_FADE_UP}
                  style={[styles.tocFade, styles.tocFadeBottom]}
                />
              )}
            </View>
          </View>
        )}

        {/*
          Both search surfaces OVERLAY the viewer rather than sharing the column with
          it, and that is load-bearing rather than cosmetic: anything that changes the
          viewer's height resizes the WebView, epub.js re-paginates on resize, and a
          CFI resolved under one pagination points at a different page under another.
          Floating them keeps the viewer a fixed size, so a hit's CFI means the same
          thing when it is tapped as when it was indexed. See SearchMatchBar.tsx.
        */}
        {showSearch && (
          <SearchPanel
            query={search.query}
            onQueryChange={search.setQuery}
            onSubmit={search.submit}
            onClose={() => {
              setShowSearch(false);
            }}
            status={search.status}
            hits={search.hits}
            submittedTerm={search.submittedTerm}
            failure={search.failure}
            activeIndex={search.activeIndex}
            onSelectHit={selectHit}
          />
        )}

        {/* The find bar you read against: only once there is something to step through,
            and only while the panel is closed, since the panel covers it anyway. */}
        {!showSearch && search.hits.length > 0 && (
          <SearchMatchBar
            hits={search.hits}
            activeIndex={search.activeIndex}
            submittedTerm={search.submittedTerm}
            onStep={stepHit}
            onOpenResults={() => {
              setShowToc(false);
              setShowSearch(true);
            }}
            onDismiss={search.clear}
          />
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
            setShowSearch(false); // mutual exclusion — see the toolbar button above
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

/**
 * Indent per TOC nesting level. A book's navigation document is a tree; the bridge
 * flattens it and carries a `depth`, so this is the only place the tree is visible.
 */
const TOC_INDENT_PX = 16;

/**
 * Slack, in points, before an edge counts as "scrolled away from".
 *
 * Not zero: contentOffset and contentSize are floats that rarely land on exactly the
 * same value (the fixture's list measures 1053.666…), so an equality test leaves the
 * bottom fade showing when the list IS at its end.
 */
const FADE_EPSILON_PX = 1;

// Transparent → panel background. Written as rgba rather than '#ffffff00' because
// Android's colour parser has historically been unreliable with 8-digit hex.
const TOC_FADE_UP = ['rgba(255, 255, 255, 0)', '#ffffff'] as const;
const TOC_FADE_DOWN = ['#ffffff', 'rgba(255, 255, 255, 0)'] as const;

/** Overlay fill. See the note on `busy` below for why this is not absoluteFillObject. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  // flex:1 down to the WebView. See the note in ReaderWebView.tsx — epub.js
  // renders nothing at all into a zero-height container.
  container: { flex: 1, backgroundColor: '#ffffff' },
  viewer: { flex: 1 },

  // Right-aligned so the icon falls under the thumb rather than next to App.tsx's
  // temporary title. 44pt is the minimum comfortable touch target.
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  toolbarButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  toolbarIcon: { fontSize: 20 },

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

  // Only a TOP hairline, to close the header off. There is deliberately no bottom
  // border any more: a hairline and a fade at the same edge fight each other — the
  // line reasserts the hard cut the fade exists to dissolve.
  tocList: { borderTopWidth: 1, borderTopColor: '#e2e2e2' },

  // Room for the last entry to scroll clear of the panel edge. One row's worth, so it
  // does not read as a gap when the list is short.
  tocListContent: { paddingBottom: 48 },

  tocListWrap: { flex: 1 },

  // Anchored to tocListWrap, so these offsets are the list's own edges. 40pt is about
  // one and a half rows: long enough that the dissolve is gradual rather than a
  // soft-edged band, short enough that it never obscures a whole entry.
  tocFade: { position: 'absolute', left: 0, right: 0, height: 40 },
  // 1, not 0: sits directly below the list's top hairline instead of washing it out.
  tocFadeTop: { top: 1 },
  tocFadeBottom: { bottom: 0 },
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
