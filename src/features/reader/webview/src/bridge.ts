// Owner: Reader (Ahana).
//
// THE SHARED HALF OF THE WEBVIEW BRIDGE — and, since the typechecked-WebView conversion, the place
// where the two halves of the bridge became ONE contract rather than two descriptions of it.
//
// This file and the two entry points beside it are compiled by
// src/features/reader/scripts/buildReaderHtml.ts (esbuild, one IIFE per format) and inlined into the
// generated shells. They are typechecked by the root tsconfig like any other file under src/ —
// `lib` already includes DOM, so no second project is needed.
//
// >>> WHAT THIS REPLACED, AND WHY IT MATTERS. <<< The bridge's WebView half used to be plain JS
// inside .html files, kept in sync with readerBridge.ts BY HAND, guarded by tests that read the
// templates as TEXT. The single import below is the whole point of the conversion: `ReaderMessage`
// and `ReaderCommand` now come FROM readerBridge.ts, so a shape drift is a compile error rather
// than something a regex might notice.
//
// TWO THINGS THE CONVERSION DID NOT CHANGE, both deliberate:
//
//  1. `parseReaderMessage()` STAYS, exactly as it was. Compile-time types do not survive the JSON
//     round trip through postMessage, and the host still receives untrusted input built from book
//     content. Types are not a substitute for the parser.
//  2. The functions below stay module-locals inlined into each entry's IIFE rather than becoming
//     globals. This document holds DECRYPTED BOOK CONTENT; widening what a malicious book's own
//     script can reach is the thing that argument was always about, and esbuild's `format: 'iife'`
//     preserves it structurally instead of by convention.

import type {
  ReaderCommand,
  ReaderMessage,
  ReaderTarget,
  TtsSentenceRequest,
  WebViewErrorCode,
} from '@/features/reader/readerBridge';
import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import type {
  EpubHighlightPaint,
  PdfHighlightPaint,
} from '@/features/personalization/readerHighlights';

type ReaderCommandName = ReaderCommand['type'];

/**
 * Libraries the generated shell inlines as classic scripts, so they arrive on `window` rather than
 * through an import. Declared here because that is a real property of how these shells are built —
 * the entry must NOT import epub.js or pdf.js as values, or esbuild would bundle a second copy of a
 * library that is already in the file. `buildReaderHtml.ts` enforces that with a size ceiling.
 */
declare global {
  interface Window {
    ePub?: unknown;
    JSZip?: unknown;
    pdfjsLib?: unknown;
    TFReader?: unknown;
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

// --- WebView -> RN -----------------------------------------------------------

/**
 * Send a message to the host.
 *
 * THE PARAMETER TYPE IS THE CONVERSION. `ReaderMessage` is imported from readerBridge.ts, so a
 * message this file can build is by construction a message `parseReaderMessage` has a case for —
 * which is what the drift guard used to approximate by grepping for `post({ type: '...'`.
 */
export function post(message: ReaderMessage): void {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
}

/**
 * Report a coded failure both ways: to the host, and into the visible fallback.
 *
 * `code` is `WebViewErrorCode`, so the host-only codes in `HOST_ERROR_CODES` cannot be raised from
 * in here — another assertion that used to be a text search over the templates.
 */
export function fail(code: WebViewErrorCode, error: unknown): void {
  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error === undefined ? code : error);

  post({ type: 'error', code, message });
  showFallback(`${code}: ${message}`);
}

/**
 * The last-resort visible failure state, for when the bridge itself is what broke and the host will
 * never hear about it. "Not a blank page" is an explicit acceptance criterion.
 *
 * The `#fallback` element and its `.visible` class live in each template's CSS, which this cannot
 * carry — so readerTemplate.test.ts asserts both selectors exist in both templates.
 */
export function showFallback(text: string): void {
  const el = document.getElementById('fallback');
  if (el) {
    el.textContent = `Reader error\n\n${text}`;
    el.className = 'visible';
  }
}

/**
 * Register the catch-alls so a throw anywhere becomes a visible, reported error instead of a white
 * screen.
 *
 * CALLED FIRST IN EACH ENTRY, BEFORE ANY RENDERER SETUP. When this logic lived inline it sat two
 * thirds of the way down the file, and anything that threw above it was invisible.
 */
export function installErrorHandlers(): void {
  window.onerror = (message, _source, lineno, colno): boolean => {
    fail('WEBVIEW_SCRIPT_ERROR', `${String(message)} (${String(lineno)}:${String(colno)})`);
    return true;
  };

  window.addEventListener('unhandledrejection', (event) => {
    fail('WEBVIEW_UNHANDLED_REJECTION', event.reason);
  });
}

// --- bytes -------------------------------------------------------------------

/**
 * base64 -> ArrayBuffer.
 *
 * Base64 is the transport because injectJavaScript is a string channel. MEASURED on real books
 * rather than assumed — see READER_MEASUREMENTS.md; the crossing is a small fraction of an open, so
 * the transport is not the thing to optimise.
 *
 * `Uint8Array.fromBase64` is native and single-pass. The `atob` path below is the fallback and costs
 * two full-size intermediates (a binary STRING the size of the book, then a per-byte copy out of
 * it) — kept because the native form is recent and Android's system WebView may not have it. This
 * must degrade, not break.
 *
 * Shared by both formats: a PDF's bytes cross the same string channel as an EPUB's.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Optional in the lib types too, so the feature test is the type guard as well as the runtime one.
  const native = Uint8Array.fromBase64;
  if (typeof native === 'function') {
    return native(base64).buffer;
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- RN -> WebView -----------------------------------------------------------

/**
 * The argument list each `window.TFReader` method takes, keyed by command name.
 *
 * >>> THIS MAP'S KEYS *AND* ITS ARGUMENT TYPES ARE BOTH COMPILER-CHECKED AGAINST `ReaderCommand`. <<<
 * The two proofs below do it in both directions, which is strictly more than the old text-grep
 * guard could see: that one compared method NAMES, and could not have told you a command grew a
 * field while its method kept the old signature.
 *
 * It is still written out by hand rather than inferred outright, because the mapping from "a
 * command's payload fields" to "a method's positional arguments" is a choice `buildCommandScript`
 * makes, not something derivable. What the proofs guarantee is that the choice stays consistent.
 */
export interface CommandArgs {
  openEpub: [base64: string];
  openPdf: [base64: string];
  next: [];
  prev: [];
  goTo: [target: ReaderTarget];
  applyAppearance: [appearance: ReaderAppearance];
  requestTtsSentence: [request: TtsSentenceRequest];
  setSpokenRange: [cfi: string | null];
  // The UNION, not the shell's own half of it, because this map has one entry per COMMAND and both
  // shells share this command. Each entry narrows it on arrival (`epubHighlights`/`pdfHighlights` in
  // highlightPaint.ts) — the same thing `goTo` does with `ReaderTarget`, and for the same reason:
  // splitting it per shell would mean a `ContentFormat`-shaped decision on the wire.
  paintHighlights: [highlights: EpubHighlightPaint[] | PdfHighlightPaint[]];
}

/** The values of a command's non-`type` fields — `never` for a command that carries none. */
type PayloadValues<C> = Omit<C, 'type'>[keyof Omit<C, 'type'>];

/**
 * The arguments a command SHOULD map to: one per payload field, none when it has no payload.
 *
 * A command growing a second field makes this a 1-tuple of a union, which no longer matches the
 * hand-written entry above — so the mismatch surfaces here rather than as a silently dropped
 * argument at the call site. That is also exactly trigger 1 in WEBVIEW_BRIDGE.md arriving as a
 * compile error.
 */
type ExpectedArgs<N extends ReaderCommandName> = [
  PayloadValues<Extract<ReaderCommand, { type: N }>>,
] extends [never]
  ? []
  : [PayloadValues<Extract<ReaderCommand, { type: N }>>];

type AssertNever<T extends never> = T;

/** Every command has an entry, and no entry names a command that does not exist. */
export type CommandArgsAreExhaustive = AssertNever<Exclude<ReaderCommandName, keyof CommandArgs>>;
export type CommandArgsHasNoExtras = AssertNever<Exclude<keyof CommandArgs, ReaderCommandName>>;

/** Every entry's arguments match the shape of its command's payload. */
export type CommandArgsMatchPayloads = AssertNever<
  {
    [N in ReaderCommandName]: CommandArgs[N] extends ExpectedArgs<N>
      ? ExpectedArgs<N> extends CommandArgs[N]
        ? never
        : N
      : N;
  }[ReaderCommandName]
>;

/**
 * The methods a shell must define, given the commands it can receive.
 *
 * PER-FORMAT ON PURPOSE. Each shell defines exactly one of `openEpub`/`openPdf`, which is how
 * `ContentFormat` is routed without crossing the bridge (see ReaderCommand's own note). So the
 * EPUB entry declares `TFReaderApi<'openEpub'>` and the PDF entry `TFReaderApi<'openPdf'>`, and
 * defining the wrong one — or forgetting `next`/`prev`/`goTo` — is a compile error in that entry.
 */
export type FormatCommandName = 'openEpub' | 'openPdf';
export type SharedCommandName = Exclude<ReaderCommandName, FormatCommandName>;

export type TFReaderApi<Open extends FormatCommandName> = {
  [N in Open | SharedCommandName]: (...args: CommandArgs[N]) => void;
};

/**
 * Publish the API and announce readiness, in that order.
 *
 * ORDER IS LOAD-BEARING: RN waits for `ready` before injecting any command, so posting it before
 * the methods exist opens a window where the host can call one that is not there.
 */
export function publish<Open extends FormatCommandName>(api: TFReaderApi<Open>): void {
  window.TFReader = api;
  post({ type: 'ready' });
}
