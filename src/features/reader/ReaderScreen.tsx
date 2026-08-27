// Owner: Reader (Ahana).
//
// The reader screen: WebView + Prev/Next/Contents controls + a visible error
// banner, reading decrypted bytes through the ContentProvider seam.
//
// Colours are inline for the same reason the navigation screens' (src/navigation/) are: src/theme/
// has not landed yet. Replace with tokens when it does.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';

import { TtsControls } from '@/features/accessibility/tts/TtsControls';
import { useTtsEnabled } from '@/features/accessibility/tts/useTtsEnabled';
import { useTtsSession } from '@/features/accessibility/tts/useTtsSession';
import { closeBook } from '@/features/encryption/contentProvider';
import { DownloadFailure } from '@/features/download/errors';
import { startAccessMonitor } from '@/features/download/readingAccessMonitor';
import type { AccessMonitorHandle } from '@/features/download/readingAccessMonitor';
import { loadFontFaceSrc } from '@/features/personalization/fontFaceLoader';
import { prefsStore } from '@/features/personalization/prefsStore';
import { toReaderAppearance } from '@/features/personalization/readerAppearance';
import type { AppearanceEnv, ReaderAppearance } from '@/features/personalization/readerAppearance';
import {
  addCurrentEpubBookmark,
  addCurrentPdfBookmark,
  loadBookmarks,
  removeBookmark,
} from '@/features/personalization/readerBookmarks';
import type { ReaderBookmark } from '@/features/personalization/readerBookmarks';
import {
  addEpubHighlight,
  addPdfHighlight,
  loadReaderHighlights,
  removeHighlight,
} from '@/features/personalization/readerHighlights';
import type { ReaderHighlights } from '@/features/personalization/readerHighlights';
import { BookmarksPanel } from '@/features/reader/BookmarksPanel';
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
  ReaderAnchor,
  ReaderPosition,
  ReaderSelection,
  ReaderTarget,
  ReaderTocItem,
} from '@/features/reader/readerBridge';
import { focusOn } from '@/features/reader/a11yFocus';
import { popupPosition } from '@/features/reader/highlightPopup';
import { logEvent, logSpan, now } from '@/features/reader/readerTiming';
import { SearchMatchBar } from '@/features/reader/SearchMatchBar';
import { SearchPanel } from '@/features/reader/SearchPanel';
import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';
import {
  createEpubReaderTextProvider,
  type EpubReaderTextProvider,
} from '@/features/reader/tts/realReaderTextProvider';
import { targetOf, useBookSearch } from '@/features/reader/useBookSearch';
import { ContentFailure, DEFAULT_PREFS } from '@/shared/contracts';
import type { BookId, ContentFormat, LayoutPrefs, SharedPrefs } from '@/shared/contracts';

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

/**
 * `toReaderAppearance`'s own `customFontUri` is a straight passthrough of `FontPrefs.customFontUri`
 * — a separate, still-unused upload-path field (see readerAppearance.ts). This overlays it with the
 * loaded bundled-font data URI for `prefs.font.family` instead (or `null` for `'system'`/unknown) —
 * Reader's chosen meaning for this field on the bridge, per CUSTOM_FONTS_WIRING.md. Both send sites
 * below (open/OS-change via `applyAppearanceWith`, and the prefs-subscribe re-apply) go through this
 * one function so neither can drift from the other. `loadFontFaceSrc` never throws.
 */
async function buildAppearanceWithFont(
  prefs: SharedPrefs,
  env: AppearanceEnv,
): Promise<ReaderAppearance> {
  const fontFaceSrc = await loadFontFaceSrc(prefs.font.family);
  return { ...toReaderAppearance(prefs, env), customFontUri: fontFaceSrc };
}

interface ReaderScreenProps {
  /**
   * Identifies the ContentStore session `getBook(bookId)` opens and
   * `closeBook(bookId)` wipes.
   *
   * REQUIRED, deliberately: while it was optional the teardown effect below hit
   * an early return and never ran, so the "wipe on close" guarantee was dead
   * code. Making it required is what keeps that from silently regressing.
   *
   * >>> CALLERS MUST KEY THIS COMPONENT ON bookId: <ReaderScreen key={id} bookId={id} /> <<<
   * EVERY piece of state below belongs to one book — the resolved format, the shell URI,
   * the command sender, the TOC, the error banner. There is nothing worth carrying from
   * one book to the next, and carrying it is actively wrong: a stale `format` would send
   * `openEpub` to a PDF shell (which defines only `openPdf`, so it answers NOT_READY),
   * and a stale `toc` would list the previous book's chapters under the new one's
   * Contents button. Remounting resets all of it in one move, which is why this is a key
   * rather than a pile of resets in the effect below — React forbids those anyway
   * (`react-hooks/set-state-in-effect`), and it is the wrong idiom for "reset on prop
   * change". `src/navigation/RootNavigator.tsx` has now landed, and a navigator gives each route
   * its own instance for free on a genuinely new push — `ReaderRouteScreen.tsx` still passes this
   * key explicitly as defense-in-depth (a `navigate('Reader', ...)` to an already-mounted Reader
   * screen would otherwise reuse the instance rather than remount it).
   */
  bookId: BookId;

  /**
   * Where to `goTo` once, right after this open's first `rendered` — the resume half of session
   * progress (`sessionProgress.ts`). Read ONCE, at mount: this component is already keyed on
   * `bookId` (see above), so a genuinely new target means a remount, not a prop change on a live
   * instance. Omit it and the book opens at its normal default location, same as before this prop
   * existed.
   *
   * NOT this component's concern to source or persist — same division as `onRelocated` below. A
   * caller (`ReaderRouteScreen.tsx`) reads `sessionProgress.getSessionPosition` and converts it via
   * `targetFromPosition`; this file just knows how to seek once, having no opinion on where the
   * target came from.
   */
  initialTarget?: ReaderTarget;

  /**
   * Mirrors every `relocated` position outward, so a caller can keep `sessionProgress` current
   * without this component knowing that store exists. Fired from the SAME `relocated` branch that
   * already updates local `position` state — additive, not a second subscription.
   */
  onRelocated?: (position: ReaderPosition) => void;

  /**
   * Rendered as the LAST child of the toolbar row (after Search and, when shown, TTS), so it lands
   * rightmost — nearest the screen edge — with the built-in icons to its left, all in one row.
   *
   * A slot rather than this file importing `DevPreferencesMenu` directly: that component is
   * `ReaderRouteScreen.tsx`'s temp scaffolding, not this screen's concern (see its own header
   * note). It used to float as an absolutely-positioned overlay from that caller instead, which put
   * it on TOP of this exact row rather than IN it — sharing the row's own flex layout is what
   * guarantees the two can never overlap, on any format, without either file hard-coding the
   * other's width.
   */
  toolbarExtra?: React.ReactNode;
}

export function ReaderScreen({
  bookId,
  initialTarget,
  onRelocated,
  toolbarExtra,
}: ReaderScreenProps): React.JSX.Element {
  /**
   * The book's format and its matching shell — TAGGED WITH THE bookId THEY BELONG TO,
   * and set as ONE value so they can never disagree.
   *
   * Two reasons for the shape. First, atomicity: `format` picks the open command and
   * `htmlUri` picks the shell that implements it, so a render where one had updated and
   * the other had not would send `openEpub` to a PDF shell — which defines only
   * `openPdf` and answers NOT_READY.
   *
   * Second, the tag makes a stale value IMPOSSIBLE TO READ rather than merely unlikely.
   * Callers are told to key this component on bookId (see the prop doc), but a caller
   * that forgets would otherwise keep the previous book's renderer and open the wrong
   * one silently. Comparing the tag below costs nothing and turns that into a
   * guaranteed miss instead. Resetting in an effect would be the other way to do it,
   * and it is both the wrong idiom for "reset on prop change" and forbidden by
   * `react-hooks/set-state-in-effect`.
   */
  const [resolved, setResolved] = useState<{
    bookId: BookId;
    format: ContentFormat;
    htmlUri: string;
  } | null>(null);

  const current = resolved?.bookId === bookId ? resolved : null;
  const format = current?.format ?? null;
  const htmlUri = current?.htmlUri ?? null;

  const [send, setSend] = useState<((command: ReaderCommand) => void) | null>(null);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);

  /**
   * Where the reader is, as last reported.
   *
   * NOT PERSISTED HERE, deliberately. `progressStore.savePage()` / `savePosition()` exist on Sync's
   * side and this is finally the value they need, but writing a progress record is Personalization's
   * stage and its own decisions (when to write, how often, what wins on conflict). Surfacing it is
   * Reader's half; storing it is not, and doing both here would prejudge those.
   */
  const [position, setPosition] = useState<ReaderPosition | null>(null);

  /**
   * The edges of the current position, as last reported on `relocated` — carried separately from
   * `position` because both shells send them on every relocation regardless of format, where
   * `position` itself is discriminated. Used to disable Prev/Next at the ends: `next`/`prev` already
   * no-op at a boundary WebView-side (both entries clamp against it), so this is a UI-only
   * refinement — no behavior changes if it is wrong, only whether the button LOOKS tappable.
   *
   * Defaults to `atStart: true` because that is what "nothing has relocated yet" actually means —
   * the book opens on its first page/CFI, so Prev is correctly disabled before the first
   * `relocated` ever arrives, matching `send === null`'s own disablement over the same window.
   */
  const [bounds, setBounds] = useState({ atStart: true, atEnd: false });

  /**
   * The page-jump field: null when closed, the typed text when open.
   *
   * A STRING, not a number, and deliberately: the field has to be able to hold '' while the user
   * clears it and '1' on the way to '12', neither of which is a page. Parsing happens on submit.
   */
  const [pageJump, setPageJump] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);

  /**
   * Whether ANY panel is covering the book. Drives the two-prop "hide from assistive tech" pair on
   * the background — the toolbar, the WebView container, the bottom row, and the two on-page badges.
   *
   * A panel is an absolute overlay, so sighted users already cannot reach what is behind it; without
   * this a screen reader still can, and swiping past the last row of the TOC walks straight into the
   * book text underneath. The panels themselves are siblings of the WebView inside `viewer`, which
   * is why this is a flag applied to several nodes rather than one wrapper around them — see
   * `ReaderWebView`'s `hidden` prop for why reparenting is not an option here.
   */
  const anyPanelOpen = showToc || showSearch || showBookmarks;

  /**
   * The bottom row is hidden on a NARROWER condition than the rest of the background, and the
   * difference is not an oversight.
   *
   * Search and Bookmarks each carry their own close button inside the panel ("Close search",
   * "Close bookmarks"), so once one is open the row behind it is pure background. **Contents does
   * not.** Its close affordance is the Contents button in this very row — the one whose label flips
   * to "Close contents" while the panel is open. Hiding the row along with everything else left a
   * screen-reader user inside the TOC with no reachable way out of it: every route back was a
   * control that had just been removed from the focus order.
   *
   * Caught by `ReaderScreen.test.tsx`'s existing mutual-exclusion tests, which could no longer find
   * the Contents button. They were right to fail.
   */
  const controlsHidden = showSearch || showBookmarks;

  /**
   * The bookmarks panel's own state — loaded once, after the first `rendered`, then kept current by
   * every add/remove call-site's returned fresh set (readerBookmarks.ts's own contract: each call
   * returns the authoritative full set, so this never needs to merge a delta in by hand).
   *
   * `bookmarksLoaded` distinguishes "still reading from storage" from "read storage and it's empty" —
   * without it, the panel would flash "No bookmarks yet" before the real list arrives.
   */
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [skippedBookmarkCount, setSkippedBookmarkCount] = useState(0);

  /**
   * The little menu that appears over a long press, or null when there is nothing to offer.
   *
   * >>> ONE GESTURE, TWO OFFERS, AND THE SHELL DECIDES WHICH. <<< Press and hold on plain text and
   * WebKit selects it and the shell reports a `selection`, so the menu offers to highlight it. Press
   * and hold on something already highlighted — anywhere in it, one word is enough — and the shell
   * reports a `highlightPressed` instead, so the menu offers to delete it. The reader learns one
   * gesture; which offer they get follows from what is under their finger.
   *
   * A MENU RATHER THAN THE ACTION ITSELF, for delete especially: a long press is deliberate, but it
   * is not a confirmation, and nothing that destroys saved work should happen without the reader
   * naming it.
   *
   * MIRRORED FROM THE WEBVIEW RATHER THAN ASKED FOR ON DEMAND. The bridge is fire-and-forget in this
   * direction (there is one request/reply pair on it, and this is not it), and a selection is
   * ephemeral enough that a round trip on button press would race the reader's next touch. Both
   * shells post every change including the clear, precisely so this can be a mirror.
   *
   * `selection` here is exactly `addEpubHighlight`'s / `addPdfHighlight`'s own arguments — see
   * `ReaderSelection`'s note on why nothing re-derives anything from it.
   */
  const [highlightMenu, setHighlightMenu] = useState<
    | { kind: 'create'; selection: ReaderSelection; anchor: ReaderAnchor }
    | { kind: 'delete'; id: string; anchor: ReaderAnchor }
    | null
  >(null);

  /** The viewer's measured box, for keeping the menu inside it. Written on layout only, so this
   * re-renders once per rotation rather than per frame. */
  const [viewerBox, setViewerBox] = useState({ width: 0, height: 0 });

  /**
   * The user's saved highlights for this book, split per shell, plus how many stored rows could not
   * be made paintable.
   *
   * Held so the SAME set can be re-sent after a re-open (`send` transitions null -> non-null once,
   * but a WebView reload would give a second `rendered`), and so the count has somewhere to live.
   * `readerHighlights.ts`'s call-sites each return the fresh, full, authoritative set, so this is
   * only ever replaced wholesale — never merged into.
   */
  const [highlights, setHighlights] = useState<ReaderHighlights>({ epub: [], pdf: [] });
  const [skippedHighlightCount, setSkippedHighlightCount] = useState(0);

  /**
   * Whether the "Page Bookmarked" tooltip should show, driven by TWO independent triggers:
   *
   * 1. `onHoverIn`/`onHoverOut` — a real mouse/trackpad hover. VERIFIED AGAINST RN's OWN SOURCE
   *    (`node_modules/react-native/Libraries/Pressability/{Pressability,HoverState}.js`), not assumed:
   *    with this RN version's default feature flags, `Pressable`'s hover callbacks route through the
   *    legacy `onMouseEnter`/`onMouseLeave` path, and `HoverState.isHoverEnabled()` is hard-coded to
   *    stay `false` unless `Platform.OS === 'web'` — it is NEVER set on native iOS/Android, regardless
   *    of an iPad trackpad, Apple Pencil hover, or Mac Catalyst. So on every platform this app
   *    currently ships to, this trigger is inert; it exists for if/when this app gets a web target, or
   *    RN turns on real W3C Pointer Events for hover, and is otherwise proven only by the Jest test
   *    that calls it directly.
   * 2. `onLongPress`/`onPressOut` — a press-and-hold, which IS a real touch gesture and the one that
   *    actually shows this on a phone, an iPad, or the simulator today. Not `onPress`: a plain tap
   *    must stay inert (see the badge's own note on why it is not a button), so revealing the tooltip
   *    needs a deliberately longer gesture than a tap, the same distinction iOS's own "peek" pattern
   *    makes.
   */
  const [showBookmarkTooltip, setShowBookmarkTooltip] = useState(false);

  /**
   * TTS is EPUB-only (readerTextProvider.ts's segmentation model is CFI-based) and gated on
   * Accessibility's one exported boolean — `useTtsEnabled()` is deliberately the ONLY check;
   * `useTtsSession`'s `play()` does not re-check it, on the grounds that mounting the controls IS
   * the decision (see TTS_PROVIDER.md's "one boolean that crosses" section).
   *
   * A `useMemo`, not state-in-an-effect — same reasoning as `panResponder` below: constructing a
   * provider has no side effect of its own (it sends nothing until a method is called), so it can
   * be recomputed as a plain function of its deps rather than pushed through setState.
   */
  const ttsEnabled = useTtsEnabled();
  const ttsProvider = useMemo<EpubReaderTextProvider | null>(() => {
    if (!ttsEnabled || format !== 'EPUB' || send === null) return null;
    return createEpubReaderTextProvider(bookId, send);
  }, [bookId, format, send, ttsEnabled]);

  /**
   * `handleMessage` and the closeBook effect below reach for THIS, not `ttsProvider` directly — a
   * ref because neither needs a re-render when it changes, only the latest value at the moment a
   * message or teardown arrives. Kept in sync via the same ref-mirroring pattern `appearanceEnvRef`
   * already uses in this file.
   */
  const ttsProviderRef = useRef(ttsProvider);
  useEffect(() => {
    ttsProviderRef.current = ttsProvider;
  }, [ttsProvider]);

  // NULL UNTIL TTS IS ACTUALLY ON. `useTtsSession` cannot be called conditionally (Rules of Hooks),
  // so it is always called — and it does nothing at all with a null provider. It used to be handed
  // an inert stand-in instead, which set up a whole session (engine listeners, AppState, a prefs
  // read) that could never speak, then tore it down and set up a second one the moment the real
  // provider arrived.
  const ttsSession = useTtsSession(ttsProvider);

  /**
   * THE PREFERENCE IS THE SWITCH. There is no in-reader button that opens this panel: turning TTS
   * on in the preferences menu is what puts the transport on screen, and turning it off is what
   * takes it away (and stops speech — see `useTtsEnabled`). A speaker button in the toolbar was a
   * SECOND control for a decision the preference already owns, and two switches for one mode is
   * how a user ends up with TTS "on" and no controls, or controls for a mode that is off.
   *
   * The panel REPLACES the page-navigation row rather than stacking above it. Both are transport
   * controls, and side by side the two Prev/Next pairs (page, and the match bar's) plus a
   * Play/Stop read as one undifferentiated bank of buttons — `SearchMatchBar.tsx`'s own note makes
   * the same point about the find bar's arrows.
   *
   * `ttsProvider` already carries every condition: the preference, `format === 'EPUB'`, and a live
   * bridge. Derived rather than mirrored into state, so nothing can disagree about whether the
   * panel is showing.
   */
  const ttsControlsVisible = ttsProvider !== null;

  /**
   * The layout half of prefs, mirrored into local state so the swipe overlay (paginated-only) and
   * `scrollEnabled` below can read it without an async round trip on every render.
   *
   * The TOGGLE UI for this lives in `DevPreferencesMenu.tsx` (the temp hamburger prefs menu, floated
   * over this screen's own body from `src/navigation/ReaderRouteScreen.tsx`) — this file only needs
   * to know the CURRENT value, not
   * offer a second way to set it. Seeded from DEFAULT_PREFS.layout until the initial `getPrefs()`
   * below resolves, and kept current by the SAME `prefsStore.subscribe` effect that already
   * re-sends `applyAppearance` (trigger B) — this is additive to that effect, not a second
   * subscription.
   */
  const [layoutPrefs, setLayoutPrefs] = useState<LayoutPrefs>(DEFAULT_PREFS.layout);
  const [isRendered, setIsRendered] = useState(false);
  const [error, setError] = useState<ReaderError | null>(null);

  // Search state lives ABOVE the panel, so closing and reopening it keeps the results
  // and the place you had reached in them.
  const search = useBookSearch(bookId);

  /**
   * A search hit selected while `send` was still null, queued rather than dropped.
   *
   * `selectHit` used to do `send?.({...})` unconditionally: if the WebView had not yet
   * reported `ready`, that optional-chained call was a silent no-op — the panel still
   * closed and the match bar still said "Match N of M" as if the jump had happened. A
   * ref rather than state because nothing needs to re-render off ITS value; `awaitingSeek`
   * below is the render-facing half.
   */
  const pendingSeekRef = useRef<ReaderTarget | null>(null);
  const [awaitingSeek, setAwaitingSeek] = useState(false);

  /**
   * The two toolbar/controls buttons that screen-reader focus is handed BACK to when the panel they
   * opened closes — without this, dismissing a panel leaves focus on an element that just unmounted
   * and the platform drops the user at the top of the screen.
   *
   * Only the two panels whose close is a deliberate act have one. Bookmarks closes the same way and
   * could take a third, but its own close path is not in this handoff's scope; add it when that item
   * comes round rather than guessing at the restore rule for it now.
   */
  const contentsButtonRef = useRef<View | null>(null);
  const searchButtonRef = useRef<View | null>(null);

  const cancelPendingSeek = useCallback((): void => {
    pendingSeekRef.current = null;
    setAwaitingSeek(false);
  }, []);

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

  // The running periodic access re-check for the CURRENTLY OPEN book — started once
  // `getBookBase64` succeeds (readingAccessMonitor.ts's own doc comment on why it does not need an
  // immediate first tick), stopped by the same teardown effect that already calls closeBook(). A
  // ref, not state: nothing here should re-render off it, only read/replace the current handle.
  const accessMonitorRef = useRef<AccessMonitorHandle | null>(null);

  // When the `open` command was handed to injectJavaScript. A ref, not state: it is written on the
  // bridge path and read in the message handler, and re-rendering on it would perturb the very
  // interval being measured. `rendered - openSentAt` is the only view we get of bridge transfer +
  // atob + the charCodeAt loop + JSZip + epub.js, and it costs no change to the bridge itself.
  const openSentAtRef = useRef<number | null>(null);

  /**
   * The resume target, read ONCE at mount (lazy initialiser) — see `initialTarget`'s own prop doc
   * for why a prop change on a live instance is not a case this needs to handle. Cleared to null
   * once sent, so a second `rendered` (there is at most one per mount, but nothing enforces that
   * upstream) cannot re-seek.
   */
  const initialTargetRef = useRef<ReaderTarget | null>(initialTarget ?? null);

  /**
   * `onRelocated` mirrored into a ref for the same reason `appearanceEnvRef` is: `handleMessage`
   * below is memoised with an empty dep array (its identity must stay stable across the whole
   * lifetime — see its own note), so it reads the LATEST callback via a ref rather than closing over
   * a stale one. Synced every render, same pattern as `appearanceEnvRef`.
   */
  const onRelocatedRef = useRef(onRelocated);
  useEffect(() => {
    onRelocatedRef.current = onRelocated;
  });

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

      // Pause the periodic access re-check while backgrounded — nobody is reading, and a timer
      // firing while the app can't render a fresh error banner would either be wasted or, worse,
      // resolve into a revocation the reader never sees delivered. Resuming restarts a FULL
      // interval (readingAccessMonitor.ts's own doc comment on why: not a resumed partial one) —
      // a book that was safe to read when it backgrounded does not need re-checking the instant
      // it returns to the foreground. A no-op before the monitor has started (ref still null).
      if (nextState === 'active') {
        accessMonitorRef.current?.resume();
      } else {
        accessMonitorRef.current?.pause();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const raiseError = useCallback((code: ReaderErrorCode, message: string): void => {
    setError({ code, message });
  }, []);

  /**
   * The OS half of `applyAppearance`'s inputs (color scheme, font scale, reduce motion).
   *
   * REF, NOT READ DIRECTLY, from `handleReady`'s closure: `handleReady` is memoised on
   * `[bookId, format, raiseError]` (see below) precisely so it does not change identity on every
   * appearance-env tick — `ReaderWebView` only reads its latest `onReady` via its own ref (see the
   * note there), so a stale env in the CLOSURE would matter even though a stale PROP would not.
   * Kept current by an effect with no dependency array, same pattern as `ReaderWebView`'s own
   * `onReadyRef`.
   */
  const appearanceEnv = useAppearanceEnv();
  const appearanceEnvRef = useRef(appearanceEnv);
  useEffect(() => {
    appearanceEnvRef.current = appearanceEnv;
  });

  /**
   * Resolve the current prefs against `env` and send `applyAppearance` — the one seam both the
   * open-time send (trigger A) and the live re-apply effects below (triggers B/C) go through, so
   * "read prefs, resolve, send" is not duplicated three times.
   *
   * Best-effort: a failed prefs read must not block opening the book. The WebView already paints at
   * its DEFAULT_PREFS-derived baseline with no `applyAppearance` at all, which is exactly the
   * fallback this failure leaves it at.
   */
  const applyAppearanceWith = useCallback(
    async (
      sender: (command: ReaderCommand) => void,
      env = appearanceEnvRef.current,
    ): Promise<void> => {
      try {
        const prefs = await prefsStore.getPrefs();
        sender({ type: 'applyAppearance', appearance: await buildAppearanceWithFont(prefs, env) });
      } catch {
        // Best-effort — see the note above.
      }
    },
    [],
  );

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
        const bookFormat = await prepareBook(bookId);
        if (cancelled) return;

        const uri = await getReaderHtmlUri(bookFormat);
        if (cancelled) return;

        // ONE setState, after BOTH are known — see the note on `resolved` above for why
        // a half-updated pair is the bug worth designing out.
        setResolved({ bookId, format: bookFormat, htmlUri: uri });
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
      // Stop the periodic access re-check FIRST — same reasoning as the TTS teardown right below:
      // once the session is closing, a tick that landed mid-teardown has nothing left to act on
      // (raiseError on an unmounting/switching screen), and closeBook() below is about to make the
      // whole question moot anyway. A no-op before the monitor ever started (ref still null).
      accessMonitorRef.current?.stop();
      accessMonitorRef.current = null;

      // BEFORE closeBook, same cleanup, so the ordering is guaranteed rather than dependent on
      // React's cross-effect cleanup order (which is not the same on an in-place book switch as on
      // a full unmount). A no-op while TTS was never active (ref is null).
      ttsProviderRef.current?.notifyClosed();

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
            raiseError(
              'UNSUPPORTED_FORMAT',
              'The reader became ready before its format was known.',
            );
            return;
          }

          // BEFORE the open command, not alongside it: PDF answers NOT_READY to anything sent
          // before open*, and EPUB's flow/spread only take effect if set before renderTo(). Awaited
          // (not fired-and-forgotten) so the order is guaranteed rather than merely likely — see
          // WEBVIEW_BRIDGE.md's "prefs-application design, as signed off".
          await applyAppearanceWith(sender);

          const base64 = await withOpenTimeout(getBookBase64(bookId, format));
          openSentAtRef.current = now();
          logEvent('open sent', { chars: base64.length, format });

          // Start re-verifying access on a timer NOW that the book has actually opened —
          // getBookBase64 above already ran the one-time open-time check (verifyReadingAccess),
          // this is what covers everything after it for as long as the book stays open. Stop any
          // prior monitor first: `handleReady` is a WebView `ready` handler, not a mount effect, so
          // nothing rules out a second `ready` (e.g. a WebView reload) firing before this screen
          // unmounts, and starting a second interval without stopping the first would leak it.
          accessMonitorRef.current?.stop();
          accessMonitorRef.current = startAccessMonitor(bookId, format, (failure) => {
            raiseError(
              'ACCESS_REVOKED',
              `Access to this book was revoked while reading: ${failure.code}. ` +
                `(${String(failure.cause ?? failure.message)})`,
            );
          });

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
              // UNREACHABLE IN PRACTICE, TWICE OVER, AND KEPT ANYWAY — AUDIO PHASE 3.
              // getReaderHtmlUri already refused this format before any WebView could exist to be
              // ready (readerAssets.ts's READER_HTML_MODULES has no AUDIO entry), and — since
              // Phase 3 — BookListScreen's onPress now routes AUDIO to the AudioPlayer route at
              // tap time, so ReaderScreen never even mounts for an audio book on the path that
              // matters. This case is a deliberate BACKSTOP, not stale leftovers: the switch is
              // exhaustive on purpose (see the note above), and removing this arm would either
              // reintroduce a non-exhaustive switch or force a `never`-typed default to somehow
              // handle a real ContentFormat member. If some future caller ever DOES reach
              // ReaderScreen with an audio bookId (a hand-built deep link, a bug in a future
              // catalogue-driven routing decision), this is what stands between it and a blank
              // WebView instead of an explicit, understandable error.
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
    [bookId, format, raiseError, applyAppearanceWith],
  );

  /**
   * Trigger B (READER_PREFS_APPLICATION.md §5): a local prefs edit. `prefsStore.subscribe` hands
   * back the FRESH `SharedPrefs` record directly, so there is no `getPrefs()` round trip here —
   * unlike `applyAppearanceWith`, which reads it because trigger A/C have no record handed to them.
   *
   * `send === null` is checked inside the listener rather than skipped by not subscribing: `send`
   * transitions null -> non-null exactly once (see its own state comment), and the effect should
   * stay subscribed across that transition rather than resubscribing — same reasoning as the queued
   * search-seek effect below, which is keyed on `[send]` for the same class of problem.
   */
  useEffect(() => {
    return prefsStore.subscribe((freshPrefs) => {
      setLayoutPrefs(freshPrefs.layout);
      if (send === null) return;
      void (async () => {
        const appearance = await buildAppearanceWithFont(freshPrefs, appearanceEnvRef.current);
        send({ type: 'applyAppearance', appearance });
      })();
    });
  }, [send]);

  // Seed `layoutPrefs` once at mount — the subscribe effect above only fires on a SUBSEQUENT
  // savePrefs/resetPrefs, so without this the toggle and the swipe overlay would see the
  // DEFAULT_PREFS.layout fallback until the user's first edit, rather than their stored preference.
  useEffect(() => {
    let cancelled = false;
    void prefsStore.getPrefs().then((prefs) => {
      if (!cancelled) setLayoutPrefs(prefs.layout);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Trigger C (READER_PREFS_APPLICATION.md §5): an OS-level change (system dark mode, Dynamic Type,
   * Reduce Motion) — `useAppearanceEnv` re-renders this component with a new `env` whenever one of
   * those fires, and this effect is what turns that into a re-resolve-and-resend. Skipped while
   * `send` is null: trigger A already sends the FIRST appearance once `send` exists, so there is
   * nothing to re-apply until then.
   */
  useEffect(() => {
    if (send === null) return;
    void applyAppearanceWith(send, appearanceEnv);
  }, [send, appearanceEnv, applyAppearanceWith]);

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
        setPosition(message.position);
        setBounds({ atStart: message.atStart, atEnd: message.atEnd });
        // Every real `relocated` is a navigation signal — epub.js never fires it for
        // setSpokenRange, which only touches annotations — so this is the one call site needed,
        // not one at every next/prev/goTo send. A no-op while TTS isn't active (ref is null).
        ttsProviderRef.current?.notifyRelocated();
        onRelocatedRef.current?.(message.position);
        break;
      case 'toc':
        // TIMED, unlike the other post-open messages, because this is the one that can stall
        // invisibly: `rendered` has already fired, so the reader shows a page while Contents is
        // still unavailable. The PDF shell resolves every outline destination through the worker
        // (one or two round trips each), so a large book's outline is where that shows up.
        if (openSentAtRef.current !== null) {
          logSpan('open -> toc', openSentAtRef.current, { items: message.items.length });
        }
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
      case 'ttsSentence':
        ttsProviderRef.current?.handleReply(message);
        break;
      case 'selection':
        /**
         * The reader long-pressed some text (or let a selection go). Turned straight into the menu's
         * own state, INCLUDING the null — "nothing is selected any more" is half of what this
         * message carries (see its note in readerBridge.ts), and is what takes the menu back off
         * screen when they tap elsewhere.
         *
         * A `selection` NEVER displaces a delete menu, because the shells never send one while a
         * press has claimed the gesture for delete (`suppressSelectionOffer` in both entries). The
         * decision is made where the whole gesture is visible; the host only mirrors it.
         */
        setHighlightMenu(
          message.selection === null || message.anchor === null
            ? null
            : { kind: 'create', selection: message.selection, anchor: message.anchor },
        );
        break;
      case 'highlightPressed':
        /**
         * The reader long-pressed a highlight they already made — anywhere in it, one word is
         * enough. Offers the delete, it does NOT perform it: a long press is a deliberate gesture
         * but it is not a confirmation, and nothing that destroys saved work should happen without
         * the reader naming it. The menu is that naming.
         */
        setHighlightMenu({ kind: 'delete', id: message.id, anchor: message.anchor });
        break;
    }
  }, []);

  /**
   * Flush a search jump that was queued while `send` was still null.
   *
   * `send` only ever transitions null -> non-null (set once, from `handleReady`), so this
   * fires at most once per queued target. It is a separate effect rather than logic inside
   * `selectHit` because the queueing and the flushing happen at two different, unrelated
   * moments — a tap, and a bridge message — and nothing else should re-check the queue.
   */
  useEffect(() => {
    if (send === null) return;
    const target = pendingSeekRef.current;
    if (target === null) return;
    pendingSeekRef.current = null;
    setAwaitingSeek(false);
    setShowSearch(false);
    send({ type: 'goTo', target });
  }, [send]);

  /**
   * Flush the resume target once, after the FIRST `rendered` — not merely once `send` exists,
   * because a `goTo` before the rendition itself exists fails `NOT_READY` (both shells guard exactly
   * that in their own `goTo`). In practice `send` is already non-null by the time `rendered` arrives
   * (it is set synchronously in `handleReady`, before the awaited open-and-render sequence below it),
   * so the `send === null` guard here is a belt-and-braces ordering check, not the expected path.
   */
  useEffect(() => {
    if (!isRendered || send === null) return;
    const target = initialTargetRef.current;
    if (target === null) return;
    initialTargetRef.current = null;
    send({ type: 'goTo', target });
  }, [isRendered, send]);

  /**
   * Close the Contents panel, optionally handing screen-reader focus back to the button that opened
   * it.
   *
   * THE ARGUMENT IS THE WHOLE POINT OF THE HELPER — it is not here because five call sites repeat
   * two lines, it is here because those five sites split into two cases that are easy to get wrong
   * and impossible to see from any one of them:
   *
   *   `true`  — the user finished with the TOC (chose a row). Nothing else is claiming focus, so
   *             leaving it where the now-unmounted row was strands it; send it back to Contents.
   *   `false` — the TOC is closing because ANOTHER panel is opening over it (Search or Bookmarks
   *             from the toolbar, a queued search seek, the match bar's "show all results"). That
   *             panel does its own entry focus, and restoring here would race it — the user would be
   *             moved to Contents a frame after arriving in the search field.
   *
   * The Contents toggle's own press needs neither: focus is already on it, and it is still mounted.
   */
  const closeToc = useCallback((restoreFocus: boolean): void => {
    setShowToc(false);
    if (restoreFocus) focusOn(contentsButtonRef);
  }, []);

  // `target` is a `ReaderTarget` — discriminated by format, so the host never has to know whether a
  // Contents row addresses a spine href or a page number. It hands back exactly what the shell sent.
  const goTo = useCallback(
    (target: ReaderTarget): void => {
      // `false`, even though a Contents row is one of the things that reaches here. THIS FUNCTION IS
      // SHARED — the bookmarks panel and the page-jump field navigate through it too, and Contents
      // is always mounted (it lives in the bottom row, not inside the panel), so restoring focus
      // here would yank a bookmark-selecting user over to a button they never touched. The Contents
      // row restores focus at its own onPress instead, where "this was the TOC" is actually known.
      closeToc(false);
      setShowBookmarks(false);
      send?.({ type: 'goTo', target });
    },
    [closeToc, send],
  );

  /**
   * CALL-SITE 1, per READER_BOOKMARKS_WIRING.md: load this book's bookmarks once, after the first
   * `rendered` — matching the resume-target flush effect above, and for the same reason: nothing
   * downstream needs them before there is a page on screen, and `isRendered` only ever goes
   * false -> true once per mount (this component is keyed on `bookId`, see its own prop doc).
   */
  useEffect(() => {
    if (!isRendered) return;
    let cancelled = false;
    void loadBookmarks(bookId).then(({ bookmarks: loaded, skippedIds }) => {
      if (cancelled) return;
      setBookmarks(loaded);
      setSkippedBookmarkCount(skippedIds.length);
      setBookmarksLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // bookId: bookmarks are now scoped to the open book (was the global BOOK_ID constant).
  }, [isRendered, bookId]);

  /**
   * Tap a bookmark: dismiss the panel and `goTo` its target — the whole navigation path, already
   * proven by TOC entries and search hits. A dedicated handler rather than reusing `goTo` because that
   * one closes the CONTENTS panel; this needs to close the BOOKMARKS one instead.
   */
  const selectBookmark = useCallback(
    (bookmark: ReaderBookmark): void => {
      setShowBookmarks(false);
      send?.({ type: 'goTo', target: bookmark.target });
    },
    [send],
  );

  /**
   * Whether the current position can be bookmarked. False before the first `relocated` — EPUB's `cfi`
   * starts `null` until epub.js resolves a location (same nullability `sessionProgress.ts` guards) —
   * and while the WebView is not ready, matching `submitPageJump`'s own guards on `send`.
   */
  const canAddCurrentBookmark =
    send !== null && position !== null && (position.kind === 'page' || position.cfi !== null);

  /**
   * CALL-SITE 2 (both formats): bookmark the current position, under the label the user typed in
   * `BookmarksPanel`'s add field (or `undefined` for a blank one, which falls through to
   * `labelFor`'s own fallback). `position` is exactly what the last `relocated` reported, so no
   * separate read of the WebView's state is needed — the same reasoning TTS's `ttsProvider` and the
   * page-jump control already lean on.
   */
  const addCurrentBookmark = useCallback(
    (name?: string): void => {
      if (position === null) return;
      const add =
        position.kind === 'page'
          ? addCurrentPdfBookmark(bookId, position.page, name)
          : position.cfi !== null
            ? addCurrentEpubBookmark(bookId, position.cfi, undefined, name)
            : null;
      if (add === null) return;

      void add.then(({ bookmarks: fresh, skippedIds }) => {
        setBookmarks(fresh);
        setSkippedBookmarkCount(skippedIds.length);
      });
    },
    [position, bookId],
  );

  /** CALL-SITE 3: tap-to-delete, by stored id. Re-renders from the returned fresh set. */
  const deleteBookmark = useCallback(
    (id: string): void => {
      void removeBookmark(bookId, id).then(({ bookmarks: fresh, skippedIds }) => {
        setBookmarks(fresh);
        setSkippedBookmarkCount(skippedIds.length);
      });
    },
    [bookId],
  );

  /**
   * TEMPORARY STAND-IN for a real rename, agreed with the user rather than assumed: Karthik/Vaishnavi
   * own `bookmarkStore`/`readerBookmarks.ts` and are expected to add a proper update-in-place op there
   * later. This function exists so the UI can demonstrate renaming NOW, without Reader adding write
   * capability to a store it does not own — replace the body with a single call to their update op
   * once it ships, and delete this note.
   *
   * WHY NOT JUST ADD THE UPDATE OP HERE: `readerBookmarks.ts` is deliberately create-and-delete-only
   * — see `removeBookmark`'s own note — because that is what lets a plain last-write-wins field
   * (`updatedAt`) behave as a UNION across devices rather than a real merge. Whether an in-place
   * rename can be added without breaking that guarantee is a sync-model decision, not a UI one, so it
   * needs Personalization/Sync's sign-off rather than Reader guessing at it — outside Reader's
   * ownership per CLAUDE.md.
   *
   * THE WORKAROUND, until then: compose the two calls Reader already has — create a new bookmark at
   * the SAME target (so it appears in the same place) under the new name, then delete the old id. The
   * new row gets a fresh id, which is invisible to the panel — it re-renders from whatever
   * `readerBookmarks.ts` reports as the current authoritative set either way. This is NOT what the
   * real fix should look like on the wire (it is two writes and two sync-outbox entries for what is
   * conceptually one edit); it is what proves the feature works while the real op is pending.
   *
   * Sequenced (add awaited before remove), not fired in parallel: if the add failed, the original
   * bookmark must still exist afterwards rather than being deleted with nothing to replace it.
   */
  const renameBookmark = useCallback(
    (bookmark: ReaderBookmark, name?: string): void => {
      const add =
        bookmark.target.kind === 'page'
          ? addCurrentPdfBookmark(bookId, bookmark.target.page, name)
          : addCurrentEpubBookmark(bookId, bookmark.target.href, undefined, name);

      void add
        .then(() => removeBookmark(bookId, bookmark.id))
        .then(({ bookmarks: fresh, skippedIds }) => {
          setBookmarks(fresh);
          setSkippedBookmarkCount(skippedIds.length);
        });
    },
    [bookId],
  );

  /**
   * CALL-SITE 1, per READER_HIGHLIGHTS_WIRING.md: load this book's highlights once, after the first
   * `rendered`.
   *
   * AFTER `rendered`, NOT MERELY ONCE `send` EXISTS, and for a sharper reason than the bookmarks
   * effect beside it has: a bookmark is a list, but a highlight has to be PAINTED, and painting
   * needs a rendition to paint onto. The EPUB shell's `paintHighlights` is a no-op before
   * `openEpub` has built one, and the PDF shell has no page surface to measure against until its
   * first page is rasterised. Same gate `setSpokenRange` needs, for the same reason.
   */
  useEffect(() => {
    if (!isRendered) return;
    let cancelled = false;
    void loadReaderHighlights(bookId).then(({ highlights: loaded, skippedIds }) => {
      if (cancelled) return;
      setHighlights(loaded);
      setSkippedHighlightCount(skippedIds.length);
    });
    return () => {
      cancelled = true;
    };
  }, [isRendered, bookId]);

  /**
   * Paint whatever the current set is — the ONE place `paintHighlights` is sent from.
   *
   * DERIVED FROM STATE RATHER THAN SENT AT EACH CALL-SITE, which is what makes "load on open" and
   * "the user just added one" the same code path: every call-site replaces `highlights` with the
   * fresh authoritative set `readerHighlights.ts` hands back, and this effect re-sends it. A second
   * send from inside `highlightSelection` would be a second thing to keep in step with the first.
   *
   * The `switch` is exhaustive for the same reason `handleReady`'s is: choosing which array to send
   * IS the format routing (`toReaderHighlights` split them host-side precisely so no `ContentFormat`
   * value has to cross), so a fourth format must be a compile error here rather than a book whose
   * highlights silently never paint.
   */
  useEffect(() => {
    if (!isRendered || send === null || format === null) return;
    switch (format) {
      case 'EPUB':
        send({ type: 'paintHighlights', highlights: highlights.epub });
        break;
      case 'PDF':
        send({ type: 'paintHighlights', highlights: highlights.pdf });
        break;
      case 'AUDIO':
        // Unreachable — the same backstop `handleReady`'s switch carries, and for the same reason:
        // no WebView is mounted for an audio book at all, so there is nothing to paint onto.
        break;
      default: {
        const unhandled: never = format;
        throw new Error(`Unhandled ContentFormat: ${String(unhandled)}`);
      }
    }
  }, [isRendered, send, format, highlights]);

  /**
   * CALL-SITE 2 (both formats): highlight what the user has selected.
   *
   * `selection` is forwarded EXACTLY as the shell reported it — `ReaderSelection`'s two shapes are
   * `addEpubHighlight`'s and `addPdfHighlight`'s own arguments (see its note in readerBridge.ts), so
   * nothing here re-derives a locator and there is no second place for a selection's meaning to
   * drift from what gets stored.
   *
   * NO COLOUR ARGUMENT. Highlights are single-colour and create-and-delete-only by design — that
   * restriction is what lets plain last-write-wins behave as a union across devices
   * (READER_HIGHLIGHTS_WIRING.md's locked constraints), so a colour picker here would not be a UI
   * addition, it would be a sync-model change. The store's own default is the one colour.
   *
   * `setSelection(null)` FIRST, not in the `then`: the selection is spent the moment the button is
   * pressed, and leaving the affordance on screen for the length of a database write invites a
   * second press that stores the same span twice. (`highlightStore.add` is idempotent on the exact
   * span, so the duplicate would be absorbed — but the button would still be lying about what it
   * was going to do.)
   */
  const highlightSelection = useCallback((): void => {
    if (highlightMenu?.kind !== 'create') return;
    const { selection } = highlightMenu;
    const add =
      selection.kind === 'cfiRange'
        ? addEpubHighlight(bookId, selection.startCfi, selection.endCfi)
        : addPdfHighlight(bookId, {
            page: selection.page,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
          });

    setHighlightMenu(null);
    void add.then(({ highlights: fresh, skippedIds }) => {
      setHighlights(fresh);
      setSkippedHighlightCount(skippedIds.length);
    });
  }, [bookId, highlightMenu]);

  /**
   * CALL-SITE 3, per READER_HIGHLIGHTS_WIRING.md: delete the highlight the reader long-pressed.
   *
   * BY STORED ID. The shell painted it and said which one was pressed, so nothing here matches a
   * range against a selection — the fragile thing that doc rules out. The menu closes first, for the
   * same reason `highlightSelection` clears it first: the offer is spent the moment it is taken, and
   * leaving it up for the length of a database write invites a second press on a highlight that is
   * already going away.
   */
  const deleteHighlight = useCallback((): void => {
    if (highlightMenu?.kind !== 'delete') return;
    const { id } = highlightMenu;

    setHighlightMenu(null);
    void removeHighlight(bookId, id).then(({ highlights: fresh, skippedIds }) => {
      setHighlights(fresh);
      setSkippedHighlightCount(skippedIds.length);
    });
  }, [bookId, highlightMenu]);

  /**
   * Jump to a typed page, or refuse without navigating.
   *
   * >>> VALIDATED HERE RATHER THAN IN THE SHELL, AND THAT IS THE WHOLE POINT OF CARRYING pageCount. <<<
   * The shell range-checks too and raises NAVIGATION_FAILED, but that surfaces as the reader's error
   * banner — the right response to a corrupt book and a wildly disproportionate one to a typo. Knowing
   * the bound host-side means the UI can simply decline, and can show the range up front.
   *
   * Only reachable when the position is a page, so an EPUB can never get here — there is no stable page
   * to jump to in a reflowable book.
   */
  const submitPageJump = useCallback((): void => {
    if (position?.kind !== 'page' || pageJump === null) return;

    const page = Number(pageJump.trim());
    if (!Number.isInteger(page) || page < 1 || page > position.pageCount) {
      // Left OPEN on a bad value rather than closed: the typed text stays visible so it can be
      // corrected, which is the difference between a rejection and losing your input.
      return;
    }

    setPageJump(null);
    send?.({ type: 'goTo', target: { kind: 'page', page } });
  }, [pageJump, position, send]);

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
      // BOTH FORMATS SEEK NOW. A PDF hit used to be a dead row — listed, but tapping it did nothing —
      // because the only way to address a location was a bare string, and a page number could not be
      // told apart from a spine href in one. `targetOf` unwraps the frozen `Locator` into a
      // discriminated `ReaderTarget`, which is the one place that unwrap happens.
      const target = targetOf(hit);
      if (target === null) return;
      search.setActiveIndex(index);

      if (send === null) {
        // Search itself runs host-side over the decrypted index, so results can arrive well
        // before the WebView reports `ready` — `send` is still null here. `send?.({...})`
        // below would silently drop the jump: the panel would still close and the match bar
        // would still say "Match N of M" as if it had worked. Queue it and reopen the panel
        // (rather than leaving it wherever this was called from — the match bar's stepper
        // reaches this too) so the wait is visible; the effect above flushes it once `send`
        // exists.
        pendingSeekRef.current = target;
        setAwaitingSeek(true);
        closeToc(false); // Search is opening over it — see closeToc's own note.
        setShowBookmarks(false);
        setShowSearch(true);
        return;
      }

      setShowSearch(false);
      setShowBookmarks(false);
      send({ type: 'goTo', target });
    },
    [closeToc, search, send],
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
        // Every hit is navigable in both formats now, so in practice this skips nothing — it used to
        // skip every PDF hit, which made the match bar step straight past results it was counting.
        // Kept rather than dropped: it is what stops a future locator shape with no renderer from
        // being stepped onto and silently doing nothing.
        if (targetOf(search.hits[i]) !== null) {
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

  /**
   * `bookmarks`, narrowed to the ones that could even BELONG to the book currently open — a PARTIAL
   * mitigation for a real defect, not the fix, and that distinction matters enough to spell out.
   *
   * THE DEFECT: `bookmarkStore.add()` (Sync's, `src/features/sync/stores/bookmarkStore.ts`) stamps
   * every bookmark with the single hardcoded `BOOK_ID` from `syncConfig.ts`, not the id of whichever
   * book was actually open when it was created — and `bookmarkStore.list()` filters by that same
   * singleton. So `loadBookmarks()` returns every bookmark ever created, for every book, always; the
   * per-book identity this screen would need to filter on correctly does not exist anywhere in the
   * data it gets back. Fixing that means threading a real `bookId` through `bookmarkStore.ts` AND
   * `readerBookmarks.ts` (Personalization's) — both outside Reader's ownership per CLAUDE.md, and
   * deliberately NOT done here; see `READER_BOOKMARKS_WIRING.md`'s open items for the real fix.
   *
   * THE MITIGATION: `target.kind` DOES distinguish EPUB (`'href'`) from PDF (`'page'`) addressing, and
   * that much Reader already knows for certain from `format` — a PDF book can never navigate to an
   * href, an EPUB can never navigate to a bare page number, so a bookmark of the wrong kind for the
   * open book is provably not reachable here regardless of which book it actually belongs to. This
   * catches the two-book split the dev fixtures already exercise (`DEV_FIXTURES`: two EPUB ids, two
   * PDF ids) — opening the PDF sample no longer lists the EPUB sample's bookmarks, or vice versa.
   *
   * WHAT THIS DOES NOT FIX: two books of the SAME format (e.g. the bundled sample EPUB and the "Big"
   * EPUB fixture) still see each other's bookmarks — `target.kind` cannot tell them apart, and nothing
   * else in the returned data can either. That case needs the real per-book fix above.
   */
  const bookmarksForOpenBook = useMemo(() => {
    if (format === null) return bookmarks;
    return bookmarks.filter((b) =>
      format === 'PDF' ? b.target.kind === 'page' : b.target.kind === 'href',
    );
  }, [bookmarks, format]);

  /**
   * Whether the CURRENT position has a bookmark on it, for the corner badge below.
   *
   * PDF matches by PAGE — the same whole-page granularity `addCurrentPdfBookmark` already writes at,
   * so "this page has a bookmark" is exactly what was asked for. EPUB matches by exact CFI, which is
   * an honest narrower claim: a CFI addresses a point, not a page, so the badge lights up only at the
   * precise spot that was bookmarked, not "somewhere in this pagination" — the same "exactness over a
   * comforting approximation" the search hints elsewhere in this file already commit to.
   *
   * Reads `bookmarksForOpenBook`, not raw `bookmarks` — same reasoning as the panel list: a same-format
   * bookmark from a DIFFERENT book landing on the identical CFI/page would otherwise light this up for
   * the wrong book, and while `target.kind` can't fully solve that (see the note above), there is no
   * reason to skip the filter it CAN apply here just because the panel already applies it too.
   *
   * `useMemo`, not state-in-an-effect: this is a pure function of `bookmarksForOpenBook` and
   * `position`, both of which are already reactive state — nothing here has a side effect to push
   * through `setState`.
   */
  const isCurrentPositionBookmarked = useMemo(() => {
    if (position === null) return false;
    if (position.kind === 'page') {
      return bookmarksForOpenBook.some(
        (b) => b.target.kind === 'page' && b.target.page === position.page,
      );
    }
    return (
      position.cfi !== null &&
      bookmarksForOpenBook.some((b) => b.target.kind === 'href' && b.target.href === position.cfi)
    );
  }, [bookmarksForOpenBook, position]);

  /**
   * SWIPE-TO-TURN-PAGE NO LONGER LIVES IN THIS FILE, and the move is worth recording where the
   * PanResponder used to be.
   *
   * It was an RN overlay above the WebView (`reader-swipe-catcher`) with a `PanResponder` on it.
   * That overlay is the topmost hit-test target for every touch in the viewer, so the document
   * underneath never received a `touchstart` while it was mounted — fine for swipes, fatal for text
   * selection, which is the first half of making a highlight. The two could not both own the same
   * touches from opposite sides of the bridge.
   *
   * So both gestures are now recognised inside the WebView, where the whole touch is visible and
   * they can be told apart by SHAPE: hold still and the text selects, drag sideways and the page
   * turns. See `webview/src/touchGesture.ts`. Prev/Next below are unaffected — they were always
   * buttons, and they still send the same `next`/`prev` commands.
   */

  // Prev/Next are BUTTON-driven, discrete-page-turn controls, and neither concept applies in
  // continuous scroll: navigation there is native scrolling.
  // `bounds` is the UI-only refinement on top of that — `next`/`prev` already no-op at an edge
  // WebView-side, so disabling here only stops the button LOOKING tappable past the end; it changes
  // no behaviour if `bounds` is ever behind the WebView's own state.
  const isScrolling = layoutPrefs.flow === 'scrolled-doc';
  const prevDisabled = send === null || isScrolling || bounds.atStart;
  const nextDisabled = send === null || isScrolling || bounds.atEnd;

  return (
    <View style={styles.container}>
      {/* `alert` and the live region are both needed: the role is what iOS reads, the live region
          is what Android acts on. Together they are the one place in this screen allowed to
          interrupt — an error is the thing a reader must act on. */}
      {error !== null && (
        <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorCode}>{error.code}</Text>
          {/* `error.message` DIRECTLY, not `formatDiagnosticErrorMessage(error)`. That formatter is
              for CAUGHT THROWABLES — it digs a `cause` out of an Error and composes "CODE: detail".
              A `ReaderError` is neither: it is a structured `{code, message}` the bridge already
              parsed, with no `cause` to dig for. Passed through the formatter it matched no branch
              and fell to `String(error)`, which renders a plain object as "[object Object]" — the
              banner showed that instead of the message. The code is on its own line above, so
              composing it in here would duplicate it even once the formatter handles this shape. */}
          <Text style={styles.errorMessage}>{error.message}</Text>
        </View>
      )}

      {/* THE BACKGROUND, for `anyPanelOpen`'s purposes — this row, the book, the two on-page
          badges and the bottom row. Each carries the pair separately because a panel is a sibling
          of the book inside `viewer`; there is no single node that holds all of this and none of
          the panels. See `anyPanelOpen`'s own note. */}
      <View
        style={styles.toolbar}
        accessibilityElementsHidden={anyPanelOpen}
        importantForAccessibility={anyPanelOpen ? 'no-hide-descendants' : 'yes'}
      >
        <Pressable
          accessibilityRole="button"
          // Required rather than stylistic: a glyph child gives a screen reader nothing to say,
          // and every existing test finds buttons by accessible name.
          accessibilityLabel="Search this book"
          accessibilityState={{ expanded: showSearch }}
          ref={searchButtonRef}
          onPress={() => {
            // Mutual exclusion with Contents, Bookmarks (and TTS). A UI decision — one panel's
            // worth of the viewer is all there is room for. It no longer also carries the job of
            // keeping "Close" unambiguous: each panel now names its own ("Close search",
            // "Close bookmarks", "Close contents"), so the exclusion is free to change on its
            // own merits without renaming a control out from under the test suite.
            closeToc(false); // this panel is taking over — see closeToc's own note.
            setShowBookmarks(false);
            setShowSearch((open) => !open);
          }}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarIcon}>🔍</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bookmarks"
          accessibilityState={{ expanded: showBookmarks }}
          onPress={() => {
            closeToc(false);
            setShowSearch(false);
            setShowBookmarks((open) => !open);
          }}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarIcon}>🔖</Text>
        </Pressable>

        {/* LAST child, deliberately — see `toolbarExtra`'s own prop doc for why that makes this
            the rightmost item in the row rather than a floating overlay on top of it. */}
        {toolbarExtra}
      </View>

      <View
        testID="reader-viewer"
        style={styles.viewer}
        // The box the highlight menu is clamped into. Measured here rather than assumed from
        // `Dimensions`, because this container is what the WebView actually fills — the toolbar and
        // the bottom row take height off the window, and a menu clamped against the WINDOW would be
        // allowed to sit under the controls. `onLayout` fires on mount and on rotation, which is
        // exactly when this changes; it is not a per-frame cost.
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setViewerBox((previous) =>
            previous.width === width && previous.height === height ? previous : { width, height },
          );
        }}
      >
        {/*
          ReaderWebView is KEYED ON THE SHELL URI, so a different shell is a different
          component instance rather than the same one told to navigate. ReaderWebView
          holds `isReady` and arms the READY_TIMEOUT once; reusing it across a shell
          swap would leave it believing the bridge is already up, so the new document's
          `ready` would arrive at a component that had stopped waiting for it — and
          nothing would ever send the open command. Remounting is also what tears down
          the old document holding decrypted content.
        */}
        {htmlUri !== null && (
          <ReaderWebView
            key={htmlUri}
            sourceUri={htmlUri}
            onMessage={handleMessage}
            onHostError={raiseError}
            onReady={handleReady}
            scrollEnabled={layoutPrefs.flow === 'scrolled-doc'}
            hidden={anyPanelOpen}
            // The named stop between the toolbar and the bottom row. Says what this IS, not what it
            // contains — the document's own structure lives in the WebView's accessibility tree,
            // which no React Native prop can reach or describe.
            accessibilityLabel="Book content"
          />
        )}

        {/*
          THE HIGHLIGHT MENU. One small popover over the words the reader just pressed, offering the
          one thing that makes sense for what is under their finger: "Highlight" over plain text they
          have just selected, "Delete highlight" over one they made earlier. Which offer arrives is
          decided in the WebView, where the whole gesture is visible — see `highlightMenu`'s note.

          WHY THIS IS AN RN VIEW AND NOT THE OS's OWN SELECTION CALLOUT: WKWebView's callout menu
          cannot be extended from React Native, and the pieces that could reach it (a document-side
          menu, or `injectJavaScript` racing the native one) would put a control the reader depends
          on inside the document that renders decrypted book content. The same decision
          `SearchMatchBar` already makes for find-next.

          POSITIONED IN THE WEBVIEW'S OWN COORDINATES, which are this container's — `ReaderWebView`
          fills `viewer`, so an anchor crosses the bridge needing no conversion, only clamping.
          `highlightPopup.ts` does the clamping, and is pure so the edge cases (a first line, a word
          in the margin, a viewer shorter than the menu) are tested rather than eyeballed.

          Suppressed while a panel is open: the panels cover the book, so a menu pointing at words
          nobody can see would be pointing at nothing.
        */}
        {highlightMenu !== null && !anyPanelOpen && !isBusy && !isObscured && (
          <View
            testID="reader-highlight-menu"
            style={[
              styles.highlightMenu,
              popupPosition(highlightMenu.anchor, HIGHLIGHT_MENU_SIZE, viewerBox),
            ]}
          >
            {highlightMenu.kind === 'create' ? (
              <Pressable
                testID="reader-highlight-create"
                accessibilityRole="button"
                accessibilityLabel="Highlight"
                onPress={highlightSelection}
                style={styles.highlightMenuButton}
              >
                <Text style={styles.highlightMenuText}>Highlight</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="reader-highlight-delete"
                accessibilityRole="button"
                accessibilityLabel="Delete highlight"
                onPress={deleteHighlight}
                style={styles.highlightMenuButton}
              >
                <Text style={styles.highlightMenuText}>Delete highlight</Text>
              </Pressable>
            )}
          </View>
        )}

        {/*
          Stored highlights that could not be drawn, surfaced rather than only logged — same
          reasoning as the bookmarks panel's skipped count and the TOC hardeners: a highlight that
          cannot be painted is a bug worth seeing, and silence reads as "you never made one". There
          is no highlights panel to put it in (the menu is the whole UI), so it sits quietly at the
          bottom of the page and says nothing when the count is zero.
        */}
        {skippedHighlightCount > 0 && highlightMenu === null && !anyPanelOpen && !isBusy && (
          <View style={styles.highlightNoticeWrap} pointerEvents="none">
            <Text style={styles.highlightNotice}>
              {`${String(skippedHighlightCount)} saved highlight(s) could not be shown`}
            </Text>
          </View>
        )}

        {/*
          THE BOOKMARK BADGE — a PURELY VISUAL marker, the way Word marks a bookmarked location with
          an icon in the margin rather than a control: it does not open the panel, does not toggle
          anything, and is not a button — there is no `onPress`. Confirmed with the user rather than
          assumed — an earlier version made this tappable (opening BookmarksPanel), which is the wrong
          affordance here; the panel is reached from the toolbar, this is only the "you are somewhere
          you bookmarked" cue. Long-press reveals a "Page Bookmarked" tooltip; a plain tap still does
          nothing, which is the point of using `onLongPress` rather than `onPress` for that.

          `accessibilityRole="image"`, NOT `accessibilityElementsHidden` — unlike the swipe catcher and
          the privacy cover just below (which really are inert chrome with nothing to announce), this
          DOES carry information a screen reader user needs ("you are somewhere you bookmarked"), so it
          stays discoverable and announced; only its non-interactivity is what changed.

          NO `pointerEvents="none"` HERE, UNLIKE THE FIRST VERSION — both triggers need this View to
          actually receive touch/pointer events. The tradeoff: a finger tap landing exactly on this
          30x30 corner is swallowed rather than reaching a swipe gesture underneath it — accepted as
          negligible given the badge's size and inset placement, and a plain tap still does nothing
          either way (no `onPress`).

          A small corner ribbon, not a full-width banner, and deliberately inset from both edges
          rather than flush into the corner: a book's own typography already keeps its top margin
          clear, so an 8pt inset small badge sits in that margin rather than over the text underneath
          it. Rendered BEFORE isBusy/every panel below, so it is naturally hidden behind them by RN's
          sibling z-order the same way the swipe catcher's own note describes — no zIndex needed, and
          none is set, to stay consistent with how the rest of this screen stacks overlays.
        */}
        {isCurrentPositionBookmarked && (
          // Hidden with the rest of the background: this is announced (`accessibilityRole="image"`,
          // not `accessibilityElementsHidden` — see its note below), so unlike the truly decorative
          // overlays it WOULD be a stop behind an open panel.
          <View
            style={styles.bookmarkBadgeWrap}
            accessibilityElementsHidden={anyPanelOpen}
            importantForAccessibility={anyPanelOpen ? 'no-hide-descendants' : 'yes'}
          >
            <Pressable
              testID="reader-bookmark-badge"
              accessibilityRole="image"
              accessibilityLabel="This page is bookmarked"
              onHoverIn={() => {
                setShowBookmarkTooltip(true);
              }}
              onHoverOut={() => {
                setShowBookmarkTooltip(false);
              }}
              onLongPress={() => {
                setShowBookmarkTooltip(true);
              }}
              onPressOut={() => {
                // Also the natural end of a plain (non-long) tap — harmless no-op there, since the
                // tooltip was never shown by one.
                setShowBookmarkTooltip(false);
              }}
              style={styles.bookmarkBadge}
            >
              <Text style={styles.bookmarkBadgeIcon}>🔖</Text>
            </Pressable>

            {/* `pointerEvents="none"`: a tooltip must never be what a pointer is hovering OVER, or
                moving onto it would fire the badge's own onHoverOut and make it flicker. */}
            {showBookmarkTooltip && (
              <View style={styles.bookmarkTooltip} pointerEvents="none">
                <Text style={styles.bookmarkTooltipText}>Page Bookmarked</Text>
              </View>
            )}
          </View>
        )}

        {/*
          THE "READING ALOUD" CUE. Purely a visual state indicator: no `onPress`, no `onLongPress`,
          and `pointerEvents="none"` so it cannot swallow a tap or a swipe meant for the page under
          it — unlike the bookmark badge above, which has to receive touches for its tooltip. TTS is
          driven from the transport panel and from the preference; this only reports that it is
          running.

          WHAT IT HONESTLY MEANS: "this book is being read aloud right now", anchored on the page
          so the state is visible where the user is looking. It does NOT mean "the sentence being
          spoken is on this page" — nothing host-side can know that. `setSpokenRange` paints into
          the WebView and the reader does not follow the voice (TTS_PROVIDER.md open item 2), so
          speech can run past the visible page, and a page turn moves the reader without moving the
          voice. Promising the stronger meaning would need the WebView to report whether a CFI is
          on screen, which is not on the bridge.

          Gated on 'speaking' alone, not 'paused': paused keeps the highlight but nothing is being
          read, and a speaker icon over a silent book is the kind of indicator people learn to
          distrust.

          STACKED BELOW THE BOOKMARK BADGE when both are showing — see `ttsCueWrap`'s own note for
          why the offset is computed rather than left to flow.
        */}
        {ttsSession.status === 'speaking' && (
          <View
            testID="reader-tts-cue"
            accessibilityRole="image"
            accessibilityLabel="Reading aloud"
            pointerEvents="none"
            // Announced, so it needs hiding behind a panel for the same reason the badge does.
            accessibilityElementsHidden={anyPanelOpen}
            importantForAccessibility={anyPanelOpen ? 'no-hide-descendants' : 'yes'}
            style={[styles.ttsCueWrap, isCurrentPositionBookmarked && styles.ttsCueBelowBookmark]}
          >
            <Text style={styles.ttsCueIcon}>🔊</Text>
          </View>
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
                  // Index-composed key, NOT the target alone. A real book's TOC repeats targets: the
                  // 20 MB fixture's NCX has src="Accessed%2024" five times (malformed nav points the
                  // producer emitted from citation text), which collided and raised React's
                  // duplicate-key warning on device. Targets are not unique in the wild, so they
                  // cannot be identity here — and a PDF outline repeats page numbers by design, since
                  // several sections legitimately open on the same page.
                  toc.map((item, index) => {
                    // A nav point with no href (epubOutline.ts's flattenToc keeps a grouping
                    // heading rather than dropping it, as `{kind:'href', href:''}`) has nothing to
                    // navigate to. `disabled` stops onPress from firing at all, so this never
                    // reaches goTo -> epub.entry.ts's `rendition.display('')`, whose behavior is
                    // otherwise unverified.
                    const isNavigable = item.target.kind !== 'href' || item.target.href !== '';
                    return (
                      <Pressable
                        key={`${index}-${targetKey(item.target)}`}
                        disabled={!isNavigable}
                        accessibilityState={{ disabled: !isNavigable }}
                        onPress={() => {
                          goTo(item.target);
                          // THE ONE "restore focus" CASE. `goTo` deliberately does not do this
                          // itself — it is shared with bookmarks and the page-jump field, where
                          // Contents is not where the user came from. Here it is.
                          focusOn(contentsButtonRef);
                        }}
                        // Indent, do not inset the row: paddingLeft keeps the whole
                        // width tappable at every depth, where marginLeft would shrink
                        // the touch target of the entries that are already hardest to
                        // hit. `depth` is clamped by parseReaderMessage, so this cannot
                        // run away.
                        // Two elements when navigable, matching every row before this change
                        // (pinned by the depth-indent test) — the disabled style only extends the
                        // array for a grouping heading, which that test never covers.
                        style={
                          isNavigable
                            ? [styles.tocItem, { paddingLeft: item.depth * TOC_INDENT_PX }]
                            : [
                                styles.tocItem,
                                { paddingLeft: item.depth * TOC_INDENT_PX },
                                styles.tocItemDisabled,
                              ]
                        }
                      >
                        <Text style={styles.tocItemText}>{item.label}</Text>
                      </Pressable>
                    );
                  })
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
              {/* `pointerEvents="none"` keeps them out of the way of a finger; the two a11y props
                  keep them out of the way of a screen reader. Both are needed and neither implies
                  the other — a swipe-to-next-element walk visits nodes regardless of hit-testing,
                  so without these the traversal stops twice on a decorative gradient with nothing
                  to announce. Same pair as the swipe catcher and the privacy cover. */}
              {fades.top && (
                <LinearGradient
                  testID="reader-toc-fade-top"
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  colors={TOC_FADE_DOWN}
                  style={[styles.tocFade, styles.tocFadeTop]}
                />
              )}
              {fades.bottom && (
                <LinearGradient
                  testID="reader-toc-fade-bottom"
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
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
            onSubmit={() => {
              // A fresh search means the tapped hit's queued jump, if any, no longer
              // matches what is on screen — cancel rather than let it fire later against
              // a different result set.
              cancelPendingSeek();
              search.submit();
            }}
            onClose={() => {
              cancelPendingSeek();
              setShowSearch(false);
              // THE EXPLICIT-CLOSE PATH ONLY. The user dismissed the panel without choosing
              // anything, so the toolbar button they opened it from is where they were. Selecting a
              // result also closes this panel and deliberately does NOT restore focus here — that
              // journey ends somewhere else entirely (the match bar, or the book), which is its own
              // open question and not answered by sending the user back to the toolbar.
              focusOn(searchButtonRef);
            }}
            status={search.status}
            hits={search.hits}
            submittedTerm={search.submittedTerm}
            failure={search.failure}
            activeIndex={search.activeIndex}
            onSelectHit={selectHit}
            awaitingSeek={awaitingSeek}
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
              closeToc(false); // the results panel is opening — see closeToc's own note.
              setShowBookmarks(false);
              setShowSearch(true);
            }}
            onDismiss={() => {
              cancelPendingSeek();
              search.clear();
            }}
          />
        )}

        {/* Same overlay treatment as Contents/Search, for the same reason — see the note above
            SearchPanel. */}
        {showBookmarks && (
          <BookmarksPanel
            bookmarks={bookmarksForOpenBook}
            loaded={bookmarksLoaded}
            skippedBookmarkCount={skippedBookmarkCount}
            onSelect={selectBookmark}
            onDelete={deleteBookmark}
            onRename={renameBookmark}
            onAddCurrent={addCurrentBookmark}
            canAddCurrent={canAddCurrentBookmark}
            onClose={() => {
              setShowBookmarks(false);
            }}
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

      {/* Docked below the viewer rather than an absolute overlay like the TOC/Search panels — its
          own styling already assumes ordinary document flow (a border-top separator, not a floating
          panel with fades). Shown on exactly the condition that gives `useTtsSession` something to
          drive, so a transport is never on screen over a session that cannot speak. */}
      {ttsControlsVisible && <TtsControls session={ttsSession} />}

      {!ttsControlsVisible && (
        <View
          style={styles.controls}
          accessibilityElementsHidden={controlsHidden}
          importantForAccessibility={controlsHidden ? 'no-hide-descendants' : 'yes'}
        >
          {/* Explicit label because the glyph carries no accessible name — "‹ Prev" reads as the
            guillemet plus an abbreviation. `accessibilityState` is explicit for the same reason it
            is on Next and Contents: `disabled` alone leaves it to the platform to synthesise, and
            this row's disabled states are load-bearing (see `prevDisabled`). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous page"
            accessibilityState={{ disabled: prevDisabled }}
            disabled={prevDisabled}
            onPress={() => send?.({ type: 'prev' })}
            style={[styles.button, prevDisabled && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>‹ Prev</Text>
          </Pressable>

          {/*
          THE COUNT STAYS OUT OF THE ACCESSIBLE NAME. The visible text carries it, but a name that
          changes from "Contents (0)" to "Contents (37)" when the `toc` message lands renames a
          control the user may already have focused. The name is stable; the count is decoration.

          `expanded` IS OMITTED WHEN THERE IS NO TOC, rather than reported as `false`. A control
          that can never open is not "collapsed" — pairing `expanded: false` with `disabled: true`
          invites VoiceOver's "collapsed, expandable" phrasing for a button that will never expand.
          Disabled is the whole truth in that state; expanded is the whole truth in the other.
        */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showToc ? 'Close contents' : 'Contents'}
            accessibilityState={toc.length === 0 ? { disabled: true } : { expanded: showToc }}
            ref={contentsButtonRef}
            disabled={toc.length === 0}
            onPress={() => {
              setShowSearch(false); // mutual exclusion — see the toolbar button above
              setShowBookmarks(false);
              setShowToc((open) => !open);
            }}
            style={[styles.button, toc.length === 0 && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{showToc ? 'Close' : `Contents (${toc.length})`}</Text>
          </Pressable>

          {/*
          THE PAGE INDICATOR, DOUBLING AS THE PAGE-JUMP AFFORDANCE. PDF-only by construction rather
          than by choice: `position` is discriminated by addressing scheme, and a reflowable book
          reports a CFI because it has no stable page. Rendering nothing for a CFI is the honest
          outcome — a fabricated "page 3 of 400" would be a number that changes with the font size.

          THE INDICATOR *IS* THE CONTROL, rather than a fourth item in this row. The row is already
          three buttons wide on a phone, and "tap where the page number is to change the page" needs no
          explaining. It also means the affordance appears exactly when it is usable, because both it
          and the number come from the same message.

          NOTE WHAT THIS IS NOT: a table of contents. A PDF with no outline has no contents, and
          Contents stays correctly disabled for it — most PDFs in the wild are that. This is the
          navigation such a book can actually offer.
        */}
          {position?.kind === 'page' &&
            (pageJump === null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Page ${position.page} of ${position.pageCount}. Go to a page.`}
                onPress={() => setPageJump('')}
                testID="reader-page-indicator"
              >
                <Text style={styles.pageIndicator}>
                  {position.page} / {position.pageCount}
                </Text>
              </Pressable>
            ) : (
              <TextInput
                testID="reader-page-jump"
                // The placeholder carries the RANGE, which is the whole benefit of the host knowing
                // pageCount: the bound is visible before you type rather than discovered by being
                // refused. A placeholder is not a reliable accessible name on Android, so the label is
                // explicit as well.
                accessibilityLabel={`Go to page, 1 to ${position.pageCount}`}
                placeholder={`1–${position.pageCount}`}
                placeholderTextColor="#8a8a8a"
                style={styles.pageJump}
                value={pageJump}
                onChangeText={setPageJump}
                onSubmitEditing={submitPageJump}
                onBlur={() => setPageJump(null)}
                keyboardType="number-pad"
                returnKeyType="go"
                autoFocus
                maxLength={String(position.pageCount).length}
              />
            ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next page"
            accessibilityState={{ disabled: nextDisabled }}
            disabled={nextDisabled}
            onPress={() => send?.({ type: 'next' })}
            style={[styles.button, nextDisabled && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Next ›</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * A target as a string, for React's key only.
 *
 * NOT for display and not for comparison: it exists because a key must be a string and `ReaderTarget`
 * is an object. Composed with the `kind` so the two addressing schemes cannot collide — an href of
 * `'12'` and page 12 are different rows.
 */
function targetKey(target: ReaderTarget): string {
  return target.kind === 'page' ? `p${target.page}` : `h${target.href}`;
}

/**
 * Indent per TOC nesting level. A book's navigation document is a tree; the bridge
 * flattens it and carries a `depth`, so this is the only place the tree is visible.
 */
const TOC_INDENT_PX = 16;

/**
 * The highlight menu's fixed box.
 *
 * FIXED RATHER THAN MEASURED, and that is what lets it be placed correctly on its FIRST frame:
 * `popupPosition` needs the size to centre and clamp, and a measured size only arrives after a
 * layout pass — so a self-sizing menu would appear in the wrong place and jump. Both labels
 * ("Highlight", "Delete highlight") fit this width at the button's own font size; the longer one is
 * what it was chosen for.
 */
const HIGHLIGHT_MENU_SIZE = { width: 156, height: 44 };

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
  // Reads as a status line rather than a control: no border, no press affordance. Tabular figures so
  // the row does not shift width as the page number gains a digit.
  pageIndicator: {
    fontSize: 13,
    color: '#555555',
    fontVariant: ['tabular-nums'],
  },
  // Sized to the widest page number it can hold rather than to its content, so opening the field does
  // not reflow the controls row underneath the user's finger.
  pageJump: {
    minWidth: 54,
    fontSize: 13,
    color: '#111111',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#555555',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // flex:1 down to the WebView. See the note in ReaderWebView.tsx — epub.js
  // renders nothing at all into a zero-height container.
  container: { flex: 1, backgroundColor: '#ffffff' },
  viewer: { flex: 1 },

  // Right-aligned so the icon falls under the thumb rather than next to the native-stack header's
  // own title/back button above it. 44pt is the minimum comfortable touch target.
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
  // A dark popover rather than a page-coloured one, deliberately: it has to read as chrome floating
  // OVER the book at any theme, and a panel tinted like the page would disappear into it on the
  // sepia and dark palettes — the two where a selection is hardest to see already.
  highlightMenu: {
    position: 'absolute',
    width: HIGHLIGHT_MENU_SIZE.width,
    height: HIGHLIGHT_MENU_SIZE.height,
    borderRadius: 10,
    backgroundColor: 'rgba(31, 31, 31, 0.95)',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  // Fills the popover, so the whole thing is the target rather than the label inside it — 44pt is
  // the minimum comfortable touch size, and this menu appears under a finger that is already there.
  highlightMenuButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  highlightMenuText: { fontSize: 15, fontWeight: '600', color: '#ffffff' },

  highlightNoticeWrap: { position: 'absolute', left: 8, right: 8, bottom: 8, alignItems: 'center' },
  highlightNotice: {
    backgroundColor: 'rgba(31, 31, 31, 0.85)',
    color: '#ffffff',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
    textAlign: 'center',
  },

  // Explicit inset rather than StyleSheet.absoluteFillObject: RN 0.86's types
  // export only `absoluteFill`, so the *Object form is a typecheck error here.
  busy: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  busyText: { marginTop: 8, fontSize: 13, color: '#555555' },

  // Inset from both edges, deliberately — see the note at the JSX for why this stays clear of the
  // text. Positioned on the WRAP, not the badge itself, so the tooltip below can be a normal sibling
  // laid out relative to it rather than a second independently-positioned absolute element.
  bookmarkBadgeWrap: { position: 'absolute', top: 8, right: 8, alignItems: 'flex-end' },
  // A warm gold ribbon colour, not white-on-white: the badge needs to read as a DIFFERENT surface
  // from the page underneath it at a glance, on both the light and (eventually) dark reading themes
  // this file cannot yet see (src/theme/ has not landed — see the header note on inline colours). The
  // shadow does the same job on Android, where a flat gold circle over a busy page can still blend in
  // without one; `elevation` is Android's equivalent of the iOS shadow* props below it.
  bookmarkBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffd54f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0a800',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  bookmarkBadgeIcon: { fontSize: 15 },

  // Dark-on-light rather than matching the badge's own gold, so it reads as a SEPARATE floating label
  // (the standard tooltip convention) instead of an extension of the badge shape. `alignSelf` on the
  // wrap keeps this right-aligned under the badge regardless of the tooltip's own text width.
  bookmarkTooltip: {
    marginTop: 6,
    backgroundColor: 'rgba(17, 17, 17, 0.92)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bookmarkTooltipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },

  // SAME CORNER AS THE BOOKMARK BADGE, and deliberately its own absolute element rather than a
  // second child of `bookmarkBadgeWrap`. Sharing that wrap would put this in normal flow under the
  // "Page Bookmarked" tooltip, so the cue would jump down 24pt every time the tooltip appeared and
  // back when it went. An explicit offset costs one style and never moves.
  ttsCueWrap: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Cool blue against the badge's warm gold: the two can be on screen at once, and colour is
    // what separates "you bookmarked this" from "this is being read aloud" at a glance.
    backgroundColor: '#d6e4ff',
    borderWidth: 1,
    borderColor: '#5b8def',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  // 8 (badge top) + 32 (badge height) + 8 (gap) — clears the bookmark badge exactly, so the two
  // read as a column rather than a collision. Applied only while the badge is actually showing;
  // otherwise the cue takes the corner itself rather than floating below an empty slot.
  ttsCueBelowBookmark: { top: 48 },
  ttsCueIcon: { fontSize: 15 },

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
  // A grouping heading with no href — see the note at the TOC row's `isNavigable` check.
  tocItemDisabled: { opacity: 0.5 },

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
