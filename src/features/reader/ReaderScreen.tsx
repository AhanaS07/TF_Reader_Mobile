// Owner: Reader (Ahana).
//
// The reader screen: WebView + Prev/Next/Contents controls + a visible error
// banner. This is the plaintext baseline for CAP-7 — it proves the shell renders
// and paginates a real EPUB end-to-end, with no crypto anywhere in the path.
//
// Colours are inline for the same reason App.tsx's are: src/theme/ has not landed
// yet. Replace with tokens when it does.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ReaderWebView } from '@/features/reader/ReaderWebView';
import { getBookBase64, getReaderHtmlUri } from '@/features/reader/readerAssets';
import type {
  ReaderCommand,
  ReaderErrorCode,
  ReaderMessage,
  ReaderTocItem,
} from '@/features/reader/readerBridge';
import type { BookId } from '@/shared/contracts';

interface ReaderError {
  code: ReaderErrorCode;
  message: string;
}

interface ReaderScreenProps {
  /**
   * The book this screen is reading. OPTIONAL only for as long as the plaintext
   * baseline lasts: today `readerAssets.getBookBase64()` reads a bundled sample
   * and never opens a ContentStore session, so there is no session to identify.
   *
   * Once the decrypted-content seam lands (see readerAssets.ts), this becomes
   * REQUIRED — `getBook(bookId)` needs it, and so does the `closeBook(bookId)`
   * teardown below.
   */
  bookId?: BookId;
}

export function ReaderScreen({ bookId }: ReaderScreenProps = {}): React.JSX.Element {
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [send, setSend] = useState<((command: ReaderCommand) => void) | null>(null);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [error, setError] = useState<ReaderError | null>(null);

  const raiseError = useCallback((code: ReaderErrorCode, message: string): void => {
    setError({ code, message });
  }, []);

  // Resolve the bundled reader.html before mounting the WebView.
  //
  // The `cancelled` flag is the standard unmount guard: without it, navigating
  // away mid-resolve sets state on an unmounted component. `void` on the IIFE is
  // explicit rather than incidental — type-aware lint is off, so nothing would
  // flag a dropped promise here, and the .catch() is the only thing standing
  // between an asset failure and a permanently blank screen.
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
  // stays in RAM indefinitely. That is the "wipe on close" guarantee behind
  // BuildPlan.md's whole-file-decrypt amendment.
  //
  // Deliberately its OWN effect keyed on [bookId], not folded into the htmlUri
  // effect above: this must also fire when the screen SWITCHES books, not just on
  // unmount. Sharing that effect would tie teardown to `raiseError` and re-run it
  // for reasons unrelated to the session.
  //
  // Safe today even though the plaintext baseline never opens a session:
  // contentStore.close() is documented idempotent — "closing a book with no open
  // session is a no-op" — so this is inert until the seam swap, then correct the
  // moment it lands. Wiring it now is what stops it being forgotten then.
  //
  // Fire-and-forget with an explicit catch: React cleanups cannot be async, and a
  // rejected teardown must not surface as an unhandled rejection. There is also
  // nothing useful to show the user — the screen is already gone.
  //
  // WHY dynamic import() AND NOT A TOP-LEVEL ONE: importing contentProvider at
  // module scope would pull this whole file's graph through contentStore ->
  // deviceKeypair -> react-native-quick-crypto (a Nitro native module), plus
  // aesGcm -> react-native-aes-gcm-crypto and keyStorage -> react-native-keychain.
  // That would load the entire crypto native stack just to mount the PLAINTEXT
  // baseline, which this file's header and readerAssets.ts both state must have no
  // crypto in its path — and would hard-crash the screen on any build where those
  // pods aren't linked yet. Deferring the import to teardown keeps the baseline's
  // module graph crypto-free: nothing here loads until a real bookId exists, which
  // only happens after the seam swap, by which point the pods are a prerequisite
  // anyway.
  useEffect(() => {
    if (bookId === undefined) return;

    return () => {
      void (async () => {
        try {
          const { closeBook } = await import('@/features/encryption/contentProvider');
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

      void (async () => {
        try {
          const base64 = await getBookBase64();
          sender({ type: 'open', base64 });
        } catch (cause) {
          raiseError(
            'ASSET_LOAD_FAILED',
            `Could not read the bundled sample EPUB. Run \`npm run reader:build-sample\`. ` +
              `(${cause instanceof Error ? cause.message : String(cause)})`,
          );
        }
      })();
    },
    [raiseError],
  );

  const handleMessage = useCallback((message: ReaderMessage): void => {
    switch (message.type) {
      case 'ready':
        // Handled by onReady, which also carries the sender.
        break;
      case 'rendered':
        setIsRendered(true);
        break;
      case 'relocated':
        // The CFI lands here. Nothing consumes it yet — persisting it is
        // Personalization's Progress record (@/shared/contracts progress.ts),
        // whose open question is precisely that an integer offset cannot anchor
        // a reflowable EPUB and a CFI can.
        break;
      case 'toc':
        setToc(message.items);
        break;
      case 'error':
        setError({ code: message.code, message: message.message });
        break;
    }
  }, []);

  const goTo = useCallback(
    (href: string): void => {
      setShowToc(false);
      send?.({ type: 'goTo', href });
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
                toc.map((item) => (
                  <Pressable
                    key={item.href}
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
