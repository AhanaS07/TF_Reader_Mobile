// Owner: Reader (Ahana).
//
// The typed half of the RN <-> WebView bridge. Its counterpart is the plain-JS
// IIFE at the bottom of src/features/reader/webview/reader.template.html.
//
// >>> HAND-SYNC CONTRACT — READ BEFORE EDITING <<<
// The WebView side is NOT typechecked. It lives inside a .html file precisely to
// keep it out of tsc's view (tsconfig sets allowJs + checkJs over src/), and
// type-aware ESLint is off repo-wide, so NOTHING mechanically enforces that these
// two files agree. The only thing keeping that safe is that the surface is tiny
// and 1:1:
//
//   ReaderMessage['type']   <-> every post({ type: ... }) in the template
//   READER_COMMANDS keys    <-> every method name on window.TFReader
//
// Both directions are asserted at runtime below (parseReaderMessage rejects an
// unknown type; TFReader membership is checked in the injected script), so a
// drift shows up as a loud, coded error instead of a silently ignored message.
// KEEP THIS UNION MINIMAL. The moment it needs to grow much past this, the right
// answer is to switch the WebView payload to a real typechecked build step, not
// to add more hand-synced cases.

/** Chapter entry from epub.js `book.loaded.navigation`. */
export interface ReaderTocItem {
  label: string;
  href: string;
}

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
 *   toc       — navigation resolved. Arrives AFTER rendered, not with it.
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

export type ReaderCommand =
  | { type: 'open'; base64: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goTo'; href: string };

// --- WebView -> RN -----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTocItems(value: unknown): ReaderTocItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReaderTocItem[] => {
    if (!isRecord(entry)) return [];
    const { label, href } = entry;
    if (typeof label !== 'string' || typeof href !== 'string') return [];
    return [{ label, href }];
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
 *    harmless, but a TOC `href` comes from inside the book — i.e. from content —
 *    and pasting untrusted content into an eval'd string is the injection bug
 *    this whole file exists to avoid. It matters more, not less, once the book
 *    is decrypted licensed content.
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
        ? JSON.stringify(command.href)
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
