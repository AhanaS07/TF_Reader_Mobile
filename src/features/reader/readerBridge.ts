// Owner: Reader (Ahana).
//
// The typed half of the RN <-> WebView bridge — and since 2026-08-18, the ONLY description of it.
//
// `ReaderAppearance` (imported below) is the one signed-off cross-owner type on this file: it is
// Personalization's, resolved host-side by `toReaderAppearance()`, and it is a bridge-local flat
// shape rather than a `src/shared/contracts/` type — importing it here is NOT trigger 3. See
// WEBVIEW_BRIDGE.md's "prefs-application design, as signed off" for why that distinction holds.
//
// >>> THE TYPECHECKED-WEBVIEW CONVERSION IS DONE. THE HAND-SYNC CONTRACT IS OVER. <<<
// The WebView half used to be plain JS inside .html files, deliberately outside tsc's view, kept in
// step with this file BY HAND and guarded by tests that read those files as text. It is now real
// TypeScript under src/features/reader/webview/src/, compiled into the generated shells by
// buildReaderHtml.ts (esbuild), and it IMPORTS the types below:
//
//   webview/src/bridge.ts        post/fail/showFallback/base64ToArrayBuffer + the TFReaderApi type
//   webview/src/epub.entry.ts    epub.js renderer, openEpub
//   webview/src/pdf.entry.ts     pdf.js renderer, openPdf
//   webview/src/readerMetrics.ts typography arithmetic and the stylesheet (pure, unit-tested)
//   webview/src/epubOutline.ts   epub.js navigation -> toc (pure, unit-tested)
//   webview/src/pdfOutline.ts    pdf.js outline -> toc, page/scale arithmetic (pure, unit-tested)
//
// So `ReaderMessage` and `ReaderCommand` are one contract with two consumers, not two descriptions of
// one protocol. `post()` takes `ReaderMessage`; `fail()` takes `WebViewErrorCode`; each entry declares
// `TFReaderApi<'openEpub' | 'openPdf'>`, a mapped type over `ReaderCommand` that also checks each
// method's ARGUMENTS against its command's payload — something the old text-based guard could not see
// at all, because it compared names.
//
// WHAT THIS MEANS WHEN YOU CHANGE SOMETHING HERE: add a case to `ReaderMessage` and the WebView half
// fails to compile until it handles it. There is no longer a list to remember, a template to re-grep,
// or a trigger to re-run. WEBVIEW_BRIDGE.md records what the triggers were and which stage finally
// fired one, as history rather than as a forecast.
//
// >>> parseReaderMessage() STAYS, AND IS NOT REDUNDANT. <<<
// Compile-time types do not survive the JSON round trip through `postMessage`. The host receives an
// untyped string built from a book's own navigation document — untrusted input — so the runtime
// validation below is still the only thing between book content and the host. Types are not a
// substitute for the parser, and a future refactor that "simplifies" it away by casting is the one
// change this file most needs to refuse.
//
// THREE DESIGN DECISIONS THE CONVERSION DID NOT CHANGE, because each is about what crosses the
// boundary rather than about how it is typed:
//
//   1. TWO OPEN COMMANDS, not `open(base64, format)`. `ContentFormat` is a frozen contract; routing it
//      by COMMAND NAME keeps its value off the bridge entirely. See the note on `ReaderCommand`.
//   2. `goTo.target` STAYS A BARE STRING. Search stores a `Locator`; the host unwraps `.cfi` before
//      sending. Now that the WebView is a tsc consumer, importing `Locator` there would no longer be
//      a *drift* risk — but it would still put a discriminated union on a channel whose payloads all
//      arrive as JSON, and `parseReaderMessage` would have to validate every variant.
//   3. `toc.items[].href` CARRIES A PAGE NUMBER FOR PDF. This is the one thing the conversion makes it
//      possible to improve: a typed payload can carry a discriminated target instead of one string
//      meaning two things. Worth doing, and deliberately NOT bundled into the conversion — it is a
//      protocol change with a host-side half, not a change of how one file is produced.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type { TtsFetchResult, TtsSentence } from './tts/readerTextProvider';

/**
 * Somewhere in a book the reader can be asked to go, discriminated by format.
 *
 * >>> THIS REPLACED AN OVERLOADED STRING, AND THE OVERLOAD IS WORTH UNDERSTANDING. <<<
 * `ReaderTocItem.href` used to be one `string` meaning a spine href for EPUB and a 1-based page
 * number for PDF. That was chosen deliberately, back when a fourth field on the `toc` message meant
 * paying for the typechecked-WebView conversion — a real cost for a Contents panel. The conversion has
 * happened, so the cheaper option stopped being cheaper and this is the honest shape.
 *
 * THE EPUB VARIANT STILL ACCEPTS TWO THINGS, and that one is NOT an overload to remove: `href` is a
 * spine href (from a TOC entry) or an EPUB CFI (from a Search hit), and epub.js discriminates them
 * itself — `spine.get()` tests `isCfiString()` before its href lookup, so `rendition.display()` routes
 * both through one call. One field, two forms, resolved by the library rather than by us.
 *
 * IT TRAVELS IN BOTH DIRECTIONS: out on `toc`, back in on `goTo`. That is the point — the host no
 * longer has to flatten a typed target into an ambiguous string to send it anywhere.
 */
export type ReaderTarget =
  | { kind: 'href'; href: string }
  | { kind: 'page'; page: number };

/**
 * >>> WHY `kind` AND NOT `format`. <<<
 * The first draft of this type discriminated on `format: 'EPUB' | 'PDF'`, and
 * `readerBridge.test.ts`'s "never puts a ContentFormat value into a command payload" caught it: the
 * string `"PDF"` was suddenly on the wire. Relaxing that guard would have been the wrong fix.
 *
 * The right fix is that a target is not discriminated by a book's format at all — it is discriminated
 * by its ADDRESSING SCHEME. `href` addresses a spine item (or a CFI); `page` addresses a page number.
 * Two schemes exist because two renderers exist, but the payload describes the scheme, and the reader
 * branches on "is this a page?" rather than on "is this book a PDF?".
 *
 * Three things fall out of that, and they are why the rename is worth the words:
 *  - `ContentFormat` stays entirely off the bridge, so the guard passes honestly.
 *  - `ContentFormat` has a third member (`AUDIO`) with no addressing scheme here. A `format`
 *    discriminant invited the question "where is the AUDIO case?"; a `kind` discriminant does not.
 *  - Adding a fourth `ContentFormat` cannot silently change this union's meaning, because the two are
 *    now unrelated by construction rather than by coincidence of spelling.
 */

/**
 * One Contents entry, flattened — from epub.js `book.loaded.navigation` for an EPUB, or from pdf.js
 * `getOutline()` for a PDF.
 *
 * `target` is handed straight back as `goTo`'s argument, so a row the host can render is a row it can
 * navigate to. What makes that safe is that the receiving shell VALIDATES rather than trusts: this
 * payload originates in a book's own navigation document, which is untrusted input, and each entry
 * refuses a target belonging to the other format outright.
 *
 * `depth` is the entry's nesting level in the book's navigation tree — 0 for a top-level entry. The
 * tree is flattened depth-first in the WebView (`flattenToc` in epubOutline.ts, `collectOutline` in
 * pdfOutline.ts) and arrives as one ordered list, so the host indents by `depth` rather than rendering
 * a recursive structure. A recursive payload is the shape this boundary is worst at: it arrives as
 * JSON, so every level would have to be re-validated by hand.
 */
export interface ReaderTocItem {
  label: string;
  target: ReaderTarget;
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
 * across the two templates and the shared bridge fragment — one entry per call
 * site, no extras.
 *
 * This is a UNION over the WebView sources, not a list from one. `EPUBJS_MISSING` and
 * `JSZIP_MISSING` are raised only by the EPUB template, `PDFJS_MISSING` only by the
 * PDF one, and the two `WEBVIEW_*` catch-alls only by the shared fragment. The drift
 * guard reads all three and unions them before comparing, so a code raised in one
 * shell and absent from the other is correct rather than drift. `fail()` takes `WebViewErrorCode`,
 * so the raised-implies-declared direction is now the compiler's; readerBridge.test.ts still checks
 * the reverse, because nothing stops this list growing a member no shell can produce.
 */
export const WEBVIEW_ERROR_CODES = [
  'EPUBJS_MISSING',
  'JSZIP_MISSING',
  'PDFJS_MISSING',
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
  // The book's ContentFormat has no renderer here. Today that means AUDIO, which is
  // a real member of the frozen enum and never encrypted — so it can reach this
  // reader and must be refused with something better than a blank page. Raised
  // BEFORE any WebView is mounted (ReaderScreen picks the template by format), which
  // is why it is host-side: there is no WebView to raise it from.
  'UNSUPPORTED_FORMAT',
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
 *   relocated — the page changed (also fires for the first page). Carries a
 *               `ReaderPosition`: a CFI from the EPUB shell, a page + page count from the PDF one.
 *   toc       — navigation resolved, as one depth-first flattened list (a book's
 *               nav document is a tree). Arrives AFTER rendered, not with it.
 *   error     — anything went wrong; always coded, never bare.
 */
/**
 * Where the reader is, discriminated by format.
 *
 * >>> WHY THIS IS A DISCRIMINATED UNION AND NOT FLAT FIELDS. <<<
 * The two formats do not have a common notion of position. A CFI addresses an EPUB spine offset and
 * has no PDF meaning; a page number addresses a PDF and has no reflowable meaning. Carried flat, one
 * of them is always `null` and the reader has to know which — which is the same "one field, two
 * meanings" arrangement `toc.items[].href` still suffers from, and the thing the typechecked-WebView
 * conversion made it possible to stop doing.
 *
 * Before the conversion the PDF page was DELIBERATELY NOT REPORTED: `relocated` was at the field
 * boundary that would have forced the conversion, nothing consumed a reading position, so the field
 * bought nothing and cost a day. Both halves of that have changed — the conversion has happened, and
 * `progressStore.savePage()` exists on Sync's side with nothing to feed it.
 *
 * `pageCount` rides along with `page` rather than arriving as its own message because they are only
 * meaningful together: "page 4" with no total is not something a reader can be shown, and a total
 * that arrives separately has to be correlated with a position that may already have moved.
 */
export type ReaderPosition =
  | { kind: 'cfi'; cfi: string | null }
  | { kind: 'page'; page: number; pageCount: number };

// Discriminated on `kind` for the same reason `ReaderTarget` is — see the note there. Read it as "the
// position is a CFI" / "the position is a page", not as "the book is an EPUB".


/**
 * The reply to a `requestTtsSentence` command. `requestId` is the same value the command carried —
 * that is the whole correlation mechanism on the host side; nothing about a book identity or a
 * generation crosses the wire, because each open book gets its own provider instance with its own
 * private id space (see `tts/realReaderTextProvider.ts`). `result` is a `TtsFetchResult` — the same
 * type `ReaderTextProvider.current`/`.next` resolve to — so the wire shape and the seam shape cannot
 * drift apart; a caller that has already given up on `requestId` (aborted, or the provider was torn
 * down) simply has nowhere to route this and drops it.
 */
export type ReaderMessage =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'relocated'; position: ReaderPosition; atStart: boolean; atEnd: boolean }
  | { type: 'toc'; items: ReaderTocItem[] }
  | { type: 'error'; code: ReaderErrorCode; message: string }
  | { type: 'ttsSentence'; requestId: number; result: TtsFetchResult };

export type ReaderMessageType = ReaderMessage['type'];

/**
 * Every member of `ReaderMessageType`, as something that exists at runtime.
 *
 * WHY: a TS union has no runtime form, so the drift guard in readerBridge.test.ts
 * mirrored this list as a hand-written literal — which made the guard itself the
 * one hand-synced thing it existed to eliminate. Adding a case to `ReaderMessage`
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
  'ttsSentence',
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
  openEpub: 'openEpub',
  openPdf: 'openPdf',
  next: 'next',
  prev: 'prev',
  goTo: 'goTo',
  applyAppearance: 'applyAppearance',
  requestTtsSentence: 'requestTtsSentence',
  setSpokenRange: 'setSpokenRange',
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
 * union itself would mean re-validating every variant in `parseReaderMessage`, since types do not
 * survive the JSON hop. See WEBVIEW_BRIDGE.md.
 */
/**
 * WHY TWO OPEN COMMANDS RATHER THAN `open(base64, format)`.
 *
 * This is how `ContentFormat` is routed WITHOUT putting it on the bridge. Each
 * template defines exactly one of these two methods — the EPUB one calls epub.js,
 * the PDF one calls pdf.js — and the host chooses which to send from a typechecked
 * `switch` on `ContentFormat`. So the discriminant is a command NAME, owned by this file, and the
 * frozen enum's value never crosses. That is still worth keeping after the conversion: it is what
 * lets each shell declare exactly one open method and be checked for it.
 *
 * Do not "simplify" these into one command with a format argument. It reads tidier
 * and it moves a frozen contract across the boundary.
 */
/**
 * `applyAppearance` carries the whole `ReaderAppearance` object as one payload field rather than
 * flattening it onto the command — there is exactly one consumer of the whole shape (the entry's
 * `applyAppearance` method), so there is no "argument per field" case here to keep in step, unlike
 * `goTo.target`.
 *
 * MUST reach both shells (`TFReaderApi<'openEpub'>` and `TFReaderApi<'openPdf'>` both require it —
 * see `SharedCommandName` in bridge.ts) and MUST be sent before `openEpub`/`openPdf`: PDF answers
 * `NOT_READY` to anything sent before `open*`, and EPUB's `flow`/`spread` only take effect if set
 * before `renderTo()`. See WEBVIEW_BRIDGE.md's "prefs-application design, as signed off".
 */
/** Which sentence `requestTtsSentence` wants: the one at `from`, or the one after it. */
export type TtsFetchMode = 'current' | 'next';

/**
 * `requestTtsSentence`'s whole payload nests under one field rather than three flat ones
 * (`requestId`, `from`, `mode`) on purpose: `bridge.ts`'s `ExpectedArgs` derives a command's
 * method-argument tuple from the UNION of its payload fields' value types, so three flat fields of
 * unrelated types would collapse into one argument typed `number | string | null | TtsFetchMode` —
 * unwritable as a sane `CommandArgs` entry, and `CommandArgsMatchPayloads` would (correctly) refuse
 * to compile. One object field keeps the existing one-argument-per-field convention `goTo` and
 * `applyAppearance` already use.
 */
export interface TtsSentenceRequest {
  requestId: number;
  from: string | null;
  mode: TtsFetchMode;
}

export type ReaderCommand =
  | { type: 'openEpub'; base64: string }
  | { type: 'openPdf'; base64: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goTo'; target: ReaderTarget }
  | { type: 'applyAppearance'; appearance: ReaderAppearance }
  /**
   * The FIRST command on this bridge that expects a reply (`ttsSentence`, correlated by
   * `requestId`). Named `requestTtsSentence` rather than reusing `next`/`prev` — those already mean
   * "turn the page." One command with a `mode` discriminant, not two commands, so there is one
   * reply type and one host-side resolve seam to keep consistent, matching `applyAppearance`'s
   * "one command, one resolve seam" reasoning.
   */
  | { type: 'requestTtsSentence'; request: TtsSentenceRequest }
  /**
   * Paint or clear the spoken-sentence highlight. Fire-and-forget, matching
   * `ReaderTextProvider.setSpokenRange`'s own contract: best-effort, never a reply, never a
   * reason to interrupt speech if it fails.
   */
  | { type: 'setSpokenRange'; cfi: string | null };

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

/**
 * A `ReaderTarget` from an untrusted payload, or null if it is not one.
 *
 * A PDF page is checked as a positive integer. The upper bound is NOT checked here and cannot be — the
 * host does not know the document's page count at parse time. The receiving shell does, and
 * `pageFromTarget` in pdfOutline.ts range-checks there. Two checks, two different pieces of knowledge.
 */
function asTarget(value: unknown): ReaderTarget | null {
  if (!isRecord(value)) return null;

  if (value.kind === 'href') {
    return typeof value.href === 'string' ? { kind: 'href', href: value.href } : null;
  }

  if (value.kind === 'page') {
    return isPositiveInteger(value.page) ? { kind: 'page', page: value.page } : null;
  }

  return null;
}

function asTocItems(value: unknown): ReaderTocItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReaderTocItem[] => {
    if (!isRecord(entry)) return [];
    const { label, target, depth } = entry;
    if (typeof label !== 'string') return [];

    // A row with an unusable target is DROPPED rather than kept as a dead row. The old shape could not
    // make this distinction: any string was a plausible href, so a malformed entry became a Contents
    // row that could only ever raise NAVIGATION_FAILED when tapped.
    const parsed = asTarget(target);
    if (parsed === null) return [];

    return [{ label, target: parsed, depth: asTocDepth(depth) }];
  });
}

/**
 * A `ReaderPosition` from an untrusted payload, or null if it is not one.
 *
 * STRICTER THAN THE OTHER HARDENERS IN THIS FILE, on purpose. `asTocDepth` collapses a bad value to 0
 * and `asTocItems` drops a bad entry, because a mis-indented or missing Contents row is cosmetic. A
 * position drives what the reader TELLS THE USER about where they are, and later what Progress
 * persists, so a nonsense value must not be smoothed into a plausible one.
 *
 * `page` and `pageCount` are checked as positive integers with `page <= pageCount`. The relation is
 * the part worth having: each field alone can be individually valid and jointly impossible, and
 * "page 7 of 3" is exactly the shape a rendering bug would produce.
 */
function asPosition(value: unknown): ReaderPosition | null {
  if (!isRecord(value)) return null;

  if (value.kind === 'cfi') {
    return { kind: 'cfi', cfi: typeof value.cfi === 'string' ? value.cfi : null };
  }

  if (value.kind === 'page') {
    const { page, pageCount } = value;
    if (!isPositiveInteger(page) || !isPositiveInteger(pageCount)) return null;
    if (page > pageCount) return null;
    return { kind: 'page', page, pageCount };
  }

  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Like `isPositiveInteger`, but 0 is valid — `spineIndex`/`sentenceIndex`/`requestId` all start at 0. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * A `TtsSentence` from an untrusted payload, or null if it is not one.
 *
 * STRICT, same as `asPosition` and for the same reason: this is what gets spoken and highlighted,
 * not a cosmetic Contents row, so a malformed field drops the whole sentence rather than being
 * smoothed into a plausible one.
 */
function asTtsSentence(value: unknown): TtsSentence | null {
  if (!isRecord(value)) return null;
  const { text, cfi, spineIndex, sentenceIndex, lastInSection } = value;
  if (typeof text !== 'string' || typeof cfi !== 'string') return null;
  if (!isNonNegativeInteger(spineIndex) || !isNonNegativeInteger(sentenceIndex)) return null;
  if (typeof lastInSection !== 'boolean') return null;
  return { text, cfi, spineIndex, sentenceIndex, lastInSection };
}

/** A `TtsFetchResult` from an untrusted payload, or null if `status` is missing or unrecognised. */
function asTtsFetchResult(value: unknown): TtsFetchResult | null {
  if (!isRecord(value)) return null;

  switch (value.status) {
    case 'ok': {
      const sentence = asTtsSentence(value.sentence);
      return sentence === null ? null : { status: 'ok', sentence };
    }
    case 'endOfBook':
      return { status: 'endOfBook' };
    case 'invalidAnchor':
      return { status: 'invalidAnchor' };
    case 'unavailable':
      return { status: 'unavailable' };
    case 'error':
      return typeof value.message === 'string' ? { status: 'error', message: value.message } : null;
    default:
      return null;
  }
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

    case 'relocated': {
      const position = asPosition(parsed.position);
      // A position that cannot be understood is not a position. Dropping the whole message is right
      // rather than substituting a default: a wrong page number shown confidently is worse than no
      // indicator, and the caller raises BRIDGE_PARSE_FAILED so it is not silent either.
      if (position === null) return null;

      return {
        type: 'relocated',
        position,
        atStart: parsed.atStart === true,
        atEnd: parsed.atEnd === true,
      };
    }

    case 'toc':
      return { type: 'toc', items: asTocItems(parsed.items) };

    case 'error':
      return {
        type: 'error',
        code: asErrorCode(parsed.code),
        message: typeof parsed.message === 'string' ? parsed.message : 'Unknown reader error',
      };

    case 'ttsSentence': {
      const result = asTtsFetchResult(parsed.result);
      // Dropped, not defaulted: an unroutable requestId or an unparseable result leaves a
      // ReaderTextProvider request pending until its own timeout/abort handling gives up, rather
      // than resolving it with a fabricated value.
      if (result === null || !isNonNegativeInteger(parsed.requestId)) return null;
      return { type: 'ttsSentence', requestId: parsed.requestId, result };
    }

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
    command.type === 'openEpub' || command.type === 'openPdf'
      ? JSON.stringify(command.base64)
      : command.type === 'goTo'
        ? // An OBJECT now, not a bare string. JSON.stringify already handled this correctly — which is
          // the whole reason the escaping rule below is stated as "every argument", not "every string".
          JSON.stringify(command.target)
        : command.type === 'applyAppearance'
          ? // ReaderAppearance is flat and primitive-only (its own contract, enforced by
            // readerAppearance.test.ts), so this is exactly as safe as goTo.target above.
            JSON.stringify(command.appearance)
          : command.type === 'requestTtsSentence'
            ? JSON.stringify(command.request)
            : command.type === 'setSpokenRange'
              ? JSON.stringify(command.cfi)
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
