// Owner: Reader (Ahana).
//
// The typed half of the RN <-> WebView bridge. Its counterpart is the plain-JS
// IIFE at the bottom of src/features/reader/webview/reader.template.html.
//
// >>> HAND-SYNC CONTRACT — READ BEFORE EDITING <<<
// The WebView side is NOT typechecked — it lives in a .html file precisely to
// keep it out of tsc's view — so NOTHING mechanically enforces that these two
// files agree. What keeps that safe is that the surface is tiny and 1:1:
//
//   ReaderMessage['type']   <-> every post({ type: ... }) in the template
//   READER_COMMANDS keys    <-> every method name on window.TFReader
//
// Both directions are asserted at runtime below, so a drift shows up as a loud,
// coded error rather than a silently ignored message. KEEP THIS UNION MINIMAL:
// once it needs to grow much past this, the right answer is a real typechecked
// build step for the WebView payload, not more hand-synced cases.
//
// >>> REVISIT WEBVIEW-JS TYPING WHEN THE BRIDGE GROWS <<<
// Full analysis, stage forecast and conversion plan: WEBVIEW_BRIDGE.md, in this
// folder. Read it before changing anything below, and update it in the same
// change. The summary here is so this decision is not missed by someone who only
// opens this file.
//
// Accepted debt, not an oversight — but it compounds with surface area, so here
// is the trigger rather than a vague "someday". Surface as of 2026-08-14:
//
//   5 message types (ready, rendered, relocated, toc, error)
//   4 commands      (open, next, prev, goTo)
//
// Runtime assertions cover a tiny 1:1 surface cheaply. They stop being enough
// when a mismatch can be SHAPE-level rather than NAME-level — parseReaderMessage
// can check that `type` is one of five strings, but it cannot tell you the
// template stopped sending a field some case needs. Switch to a typechecked
// WebView build (tsc over a real .ts entry, bundled into the template by
// buildReaderHtml.ts) when ANY of these becomes true:
//
//   - the message union passes ~8 cases, or any case grows past ~3 fields
//   - a command needs a RESPONSE (request/reply, not fire-and-forget) — that
//     doubles the hand-synced surface per call and adds correlation ids
//   - a bridge payload is a type owned by a FROZEN contract in src/shared/
//     contracts/ (Locator, SharedPrefs, SearchHit, …) rather than a primitive
//     local to this file. WEBVIEW_BRIDGE.md calls this the sharpest one: tsc
//     walks every TS consumer of a frozen contract and walks straight past the
//     .html, so hand-copying a frozen shape silently removes the WebView from
//     the freeze's blast radius
//   - the transport stops being base64-over-injectJavaScript (see the note on
//     getBookBase64 in readerAssets.ts); a new transport means re-agreeing the
//     whole payload shape, which is the cheapest moment to get a compiler
//   - anything inside the WebView starts holding state RN also models
//
// (This list is a copy of WEBVIEW_BRIDGE.md's; keep the two in step. The frozen-
// contract trigger above was missing here until 2026-08-13 — which is precisely
// the drift a duplicated list invites, and the reason the note below about
// "trips two" only ever parsed against the doc's version.)
//
// Day 3 (whole-book decrypt) did NOT trip any of these — worth recording,
// because it was the predicted trigger. The decrypted-buffer handoff reused
// `open` unchanged, TOC already existed, and the one new code
// (CONTENT_LOAD_FAILED) is host-side and never crosses the bridge.
//
// Day 4 (the 20 MB whole-book transport) did NOT trip any either, and that one
// was expected to: base64-over-injectJavaScript was ASSERTED not to scale to a
// 20 MB book. Measured instead — the payload crosses and renders in ~330ms, ~5%
// of a warm open — so the transport stayed and only the base64 IMPLEMENTATION
// changed on each side, behind an unchanged open(base64). Chunking would have
// fired trigger 4 and 5; it turned out not to be needed. The debt is still cheap.
//
// Widening `goTo` to take an EPUB CFI (for Search hits) did NOT trip any either.
// It is an argument rename, not a new capability — `rendition.display()` already
// resolved CFIs — and the payload stays a bare string, so trigger 3 is untouched.
// That last part is the whole reason it stayed cheap: see the note on
// ReaderCommand below, and do not "simplify" it by passing the Locator.
//
// Flattening the TOC (following epub.js's nested `subitems`) did NOT trip any
// either — but it is the first change here that grew a SHAPE rather than a name:
// ReaderTocItem went from {label, href} to {label, href, depth}. That is AT
// trigger 1's "~3 fields" boundary rather than past it, and `depth` is a plain
// number local to this file, not a frozen contract. The NEXT field added to a TOC
// entry fires trigger 1; say so then instead of re-arguing the boundary.
//
// EXPECTED DUE DATE: the prefs-application stage (applying SharedPrefs to the
// epub.js rendition). That is the first stage that trips a trigger, and it trips
// two — nested multi-field payloads AND a frozen shared contract crossing the
// boundary. Convert BEFORE writing those commands, not after: 4 flat commands is
// a morning, 9 commands plus annotations' `Locator` union is a week.
//
// SECOND CANDIDATE, AS OF 2026-08-16: TTS. The Reader -> TTS seam is agreed (see
// TTS_PROVIDER.md in this folder) and Accessibility is building against it now.
// Its bridge half needs `requestSentence` to RETURN a sentence — trigger 2
// outright, the first request/reply here — and a 7-field reply payload, well past
// trigger 1. The agreed design is stateless per request (the anchor CFI travels
// with every call), which keeps trigger 5 clear, but that changes nothing about
// the due date. Whichever of prefs-application and TTS starts first pays for the
// conversion; neither can be built without it. Nothing about the TTS interface or
// its fake touches this file — they are RN-side only.
//
// THE BRIDGE IS NOW THE ONLY THING LEFT BLOCKING THAT STAGE. Until Sync landed,
// there was a second blocker that made this date feel far away: prefs existed only
// as an in-memory stub that reset every launch, so there was nothing durable to
// apply. That is no longer true — `features/sync/sharedPrefs.ts`'s
// `readSharedPrefs()` reads both tables off SQLite and merges them into one
// contract-shaped `SharedPrefs`. So the work can start the day someone asks for it,
// and when it does, the conversion is the first task rather than a discovery.

/**
 * One entry from epub.js `book.loaded.navigation`, flattened.
 *
 * `depth` is the entry's nesting level in the book's navigation tree — 0 for a
 * top-level entry. The tree is flattened depth-first in the template (see
 * `flattenToc` there) and arrives as a single ordered list, so the host indents by
 * `depth` rather than rendering a recursive structure. That is the point: a
 * recursive payload is the shape a hand-synced, untypechecked boundary is worst at.
 *
 * A MISSING `depth` PARSES AS 0 ON PURPOSE. `assets/reader/reader.html` is a
 * generated but tracked artifact, so a working tree can legitimately hold a
 * template older than this file; degrading to a flat list beats dropping every
 * entry, which is what a required field would do.
 */
export interface ReaderTocItem {
  label: string;
  href: string;
  depth: number;
}

/**
 * Deepest nesting the host will indent, mirroring `MAX_TOC_DEPTH` in the template.
 *
 * Both sides clamp, and the duplication is deliberate rather than sloppy: the
 * template clamps as it flattens so the payload is sane, and this side clamps again
 * because that payload is built from a book's own navigation document — untrusted
 * input — and an out-of-range depth must not be able to indent an entry off the
 * side of the screen.
 */
export const MAX_TOC_DEPTH = 6;

/**
 * Error codes raised INSIDE the WebView. Exactly the strings passed to `fail()`
 * in reader.template.html — one entry per call site, no extras.
 */
export const WEBVIEW_ERROR_CODES = [
  'EPUBJS_MISSING',
  'JSZIP_MISSING',
  'OPEN_FAILED',
  'NAVIGATION_FAILED',
  'NOT_READY',
  'WEBVIEW_SCRIPT_ERROR',
  'WEBVIEW_UNHANDLED_REJECTION',
] as const;

/**
 * Error codes raised on the RN side. These never come over the bridge — the host
 * synthesises them so that every failure the user can hit has one shape and one
 * place to render, whether it happened in the WebView or before it ever loaded.
 */
export const HOST_ERROR_CODES = [
  'ASSET_LOAD_FAILED',
  // getBook(bookId) rejected — decrypt/licence/keystore. Distinct from
  // ASSET_LOAD_FAILED, which means a bundled asset would not resolve. The
  // specific ContentError rides in the message rather than being duplicated into
  // this union: the two vocabularies belong to different contracts.
  'CONTENT_LOAD_FAILED',
  // The byte path did not SETTLE in time — distinct from CONTENT_LOAD_FAILED,
  // which means it settled and said no. Kept apart because the two need different
  // reactions: a failure is about this book, a timeout is about the network or the
  // device, and telling a reader "could not open this book" when the truth is "we
  // gave up waiting" sends them looking in the wrong place. Raised by
  // ReaderScreen's bounded wait; see OPEN_TIMEOUT_MS there for why the wait exists
  // at all and what it does NOT do.
  'CONTENT_LOAD_TIMEOUT',
  'READY_TIMEOUT',
  'WEBVIEW_LOAD_FAILED',
  'BRIDGE_PARSE_FAILED',
  'BLOCKED_NAVIGATION',
] as const;

export type WebViewErrorCode = (typeof WEBVIEW_ERROR_CODES)[number];
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];
export type ReaderErrorCode = WebViewErrorCode | HostErrorCode;

/**
 * Everything the WebView can send. One case per `post({...})` in the template:
 *
 *   ready     — TFReader is defined and both libs loaded. RN waits for this
 *               before injecting anything; injecting sooner races the IIFE.
 *   rendered  — first display() resolved; the book is on screen.
 *   relocated — the page changed (also fires for the first page). Carries the
 *               CFI, which is the stable anchor Progress will eventually store
 *               (see the OPEN note in @/shared/contracts progress.ts).
 *   toc       — navigation resolved, as one depth-first flattened list (a book's
 *               nav document is a tree). Arrives AFTER rendered, not with it.
 *   error     — anything went wrong; always coded, never bare.
 */
export type ReaderMessage =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'relocated'; cfi: string | null; atStart: boolean; atEnd: boolean }
  | { type: 'toc'; items: ReaderTocItem[] }
  | { type: 'error'; code: ReaderErrorCode; message: string };

export type ReaderMessageType = ReaderMessage['type'];

/**
 * Every member of `ReaderMessageType`, as something that exists at runtime.
 *
 * WHY: a TS union has no runtime form, so the drift guard in readerBridge.test.ts
 * mirrored this list as a hand-written literal — which made the guard itself the
 * one hand-synced thing it exists to eliminate. Adding a case to `ReaderMessage`
 * and to the template while forgetting the test's copy was green. The test reads
 * this instead, and the two checks below make it impossible for this array and
 * the union to disagree.
 *
 * The command side needs no equivalent: `READER_COMMANDS` is already a runtime
 * object, and the test enumerates it with `Object.values`.
 */
export const READER_MESSAGE_TYPES = [
  'ready',
  'rendered',
  'relocated',
  'toc',
  'error',
] as const satisfies readonly ReaderMessageType[];

/**
 * `satisfies` above rejects an entry that is NOT in the union — a typo, or a name
 * left behind by a rename. It cannot catch the opposite direction, because a
 * SHORTER array still satisfies the constraint: drop `toc` and nothing complains.
 *
 * That is the direction that actually matters here (the failure is "added a union
 * case, forgot to list it"), so it gets its own check. `Exclude` is `never` only
 * when every union member appears in the array; anything left over fails
 * `AssertNever`'s constraint at compile time, naming the missing case.
 *
 * Exported because it is a proof, not a utility — nothing should import it, but
 * an unexported type alias used only for its own constraint reads as dead code.
 */
type AssertNever<T extends never> = T;
export type ReaderMessageTypesAreExhaustive = AssertNever<
  Exclude<ReaderMessageType, (typeof READER_MESSAGE_TYPES)[number]>
>;

/**
 * Commands RN can send. The VALUE is the literal method name on window.TFReader —
 * that mapping is the whole point of this object: command name and method name
 * are pinned together in one place instead of being spelled out at each call
 * site, so a rename is one edit and a mismatch is greppable.
 */
export const READER_COMMANDS = {
  open: 'open',
  next: 'next',
  prev: 'prev',
  goTo: 'goTo',
} as const;

/**
 * `goTo.target` is either a spine href (a TOC entry) or an EPUB CFI (a Search
 * hit). One command covers both because epub.js discriminates them itself:
 * `spine.get()` tests `isCfiString(target)` BEFORE the href branch, and
 * `manager.display()` nulls the target when it equals the section href — so an
 * href lands at the top of the chapter and a CFI scrolls to its exact offset,
 * through the same `rendition.display()` call.
 *
 * It MUST stay a bare string. Search stores a `Locator`; the host unwraps
 * `.cfi` before sending. Passing the `Locator` union itself would put a frozen
 * contract inside untypechecked WebView JS — trigger 3, see WEBVIEW_BRIDGE.md.
 */
export type ReaderCommand =
  | { type: 'open'; base64: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goTo'; target: string };

// --- WebView -> RN -----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A nesting level that is safe to indent by. Anything that is not a non-negative
 * integer — absent, fractional, NaN, Infinity, a string — collapses to 0 rather
 * than reaching a style calculation.
 */
function asTocDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, MAX_TOC_DEPTH);
}

function asTocItems(value: unknown): ReaderTocItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReaderTocItem[] => {
    if (!isRecord(entry)) return [];
    const { label, href, depth } = entry;
    if (typeof label !== 'string' || typeof href !== 'string') return [];
    return [{ label, href, depth: asTocDepth(depth) }];
  });
}

function asErrorCode(value: unknown): ReaderErrorCode {
  const known: readonly string[] = [...WEBVIEW_ERROR_CODES, ...HOST_ERROR_CODES];
  return typeof value === 'string' && known.includes(value)
    ? (value as ReaderErrorCode)
    : 'WEBVIEW_SCRIPT_ERROR';
}

/**
 * Parse a raw `onMessage` payload into a typed ReaderMessage, or null if it is
 * not one of ours.
 *
 * Deliberately paranoid: `event.nativeEvent.data` is an untyped string, and
 * under strict TS a `JSON.parse(...) as ReaderMessage` would be a lie that only
 * fails later, somewhere else. Anything unrecognised returns null and the caller
 * raises BRIDGE_PARSE_FAILED — which is exactly how a hand-sync drift between
 * this file and the template surfaces as a visible error rather than silence.
 */
export function parseReaderMessage(raw: string): ReaderMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;

  switch (parsed.type) {
    case 'ready':
      return { type: 'ready' };

    case 'rendered':
      return { type: 'rendered' };

    case 'relocated':
      return {
        type: 'relocated',
        cfi: typeof parsed.cfi === 'string' ? parsed.cfi : null,
        atStart: parsed.atStart === true,
        atEnd: parsed.atEnd === true,
      };

    case 'toc':
      return { type: 'toc', items: asTocItems(parsed.items) };

    case 'error':
      return {
        type: 'error',
        code: asErrorCode(parsed.code),
        message: typeof parsed.message === 'string' ? parsed.message : 'Unknown reader error',
      };

    default:
      return null;
  }
}

// --- RN -> WebView -----------------------------------------------------------

/**
 * Build the JS string handed to `WebView.injectJavaScript` for a command.
 *
 * Three things this has to get right:
 *
 * 1. EVERY argument goes through JSON.stringify. Base64 is alphanumeric so it is
 *    harmless, but a `goTo` target comes from inside the book — a TOC href, or a
 *    CFI minted from the book's own text by Search — and pasting untrusted
 *    content into an eval'd string is the injection bug this whole file exists
 *    to avoid. It matters more, not less, once the book is decrypted licensed
 *    content.
 * 2. The guard for a missing window.TFReader. If the IIFE failed to define it,
 *    an unguarded call throws inside injectJavaScript where nobody sees it; the
 *    guard turns that into a normal coded error message instead.
 * 3. The trailing `true;`. Without a final statement value, iOS logs a warning
 *    about the injected script's return value on every single call.
 */
export function buildCommandScript(command: ReaderCommand): string {
  const method = READER_COMMANDS[command.type];
  const args: string =
    command.type === 'open'
      ? JSON.stringify(command.base64)
      : command.type === 'goTo'
        ? JSON.stringify(command.target)
        : '';

  return `(function(){
    try {
      if (!window.TFReader || typeof window.TFReader.${method} !== 'function') {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error', code: 'NOT_READY',
          message: 'window.TFReader.${method} is not defined'
        }));
        return;
      }
      window.TFReader.${method}(${args});
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error', code: 'WEBVIEW_SCRIPT_ERROR',
        message: (e && e.message) ? e.message : String(e)
      }));
    }
  })();
  true;`;
}
