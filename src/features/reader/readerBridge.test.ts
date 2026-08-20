// Owner: Reader (Ahana).
//
// Two jobs:
//   1. Normal unit coverage of parseReaderMessage / buildCommandScript.
//   2. THE DRIFT GUARD (bottom of the file) — the reason this test matters more
//      than its size suggests.
//
// readerBridge.ts and the WebView halves are two descriptions of one protocol, and
// the WebView side is deliberately outside tsc's view (plain JS inside .html files,
// so allowJs/checkJs cannot reach it). ESLint cannot see it either — type-aware
// linting now covers src/features/reader/, but only the .ts/.tsx in it, and a .html
// is neither. So NOTHING in the toolchain can see that the sides agree. The drift
// guard closes that by reading the WebView files as text and asserting, mechanically,
// that every message type they post has a case in the TS union and every method RN
// calls exists on window.TFReader.
//
// THE WEBVIEW SIDE IS NOW THREE FILES, NOT ONE, and the guard unions across them:
//
//   webview/reader-epub.template.html   epub.js renderer + openEpub
//   webview/reader-pdf.template.html    pdf.js renderer + openPdf
//   webview/reader.bridge.html          the shared half both inline (post/fail/…)
//
// Unioning is not a loosening. Each template legitimately raises codes the other
// cannot (EPUBJS_MISSING vs PDFJS_MISSING) and defines only its own open command, so
// a per-file equality assertion would be wrong. What must hold is that the union
// equals the TS side exactly — nothing declared and unused, nothing used and
// undeclared. Per-file expectations that DO still hold are asserted separately below.
//
// This converts the "keep it in sync BY HAND" risk into a red test. If you add a
// message to one side and not the other, this fails by name.
//
// Node's fs is used to read the template fixture. That is a test-time Node
// dependency, not device code — the same latitude the encryption scripts have,
// and the reason tsconfig carries "node" in `types`.

import * as fs from 'fs';
import * as path from 'path';

import {
  HOST_ERROR_CODES,
  MAX_TOC_DEPTH,
  READER_COMMANDS,
  READER_MESSAGE_TYPES,
  WEBVIEW_ERROR_CODES,
  buildCommandScript,
  parseReaderMessage,
} from '@/features/reader/readerBridge';

const webviewFile = (name: string): string =>
  fs.readFileSync(path.join(__dirname, 'webview', name), 'utf8');

const EPUB_TEMPLATE = webviewFile('reader-epub.template.html');
const PDF_TEMPLATE = webviewFile('reader-pdf.template.html');
const BRIDGE_FRAGMENT = webviewFile('reader.bridge.html');

/**
 * Every file the WebView half is assembled from.
 *
 * The fragment is included because it raises the two catch-all codes and posts the
 * `error` message — leaving it out would report those as declared-but-unused and
 * fail the guard for the wrong reason.
 */
const WEBVIEW_SOURCES: readonly { name: string; text: string }[] = [
  { name: 'reader-epub.template.html', text: EPUB_TEMPLATE },
  { name: 'reader-pdf.template.html', text: PDF_TEMPLATE },
  { name: 'reader.bridge.html', text: BRIDGE_FRAGMENT },
];

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

/** Every distinct `post({ type: 'x' ... })` one WebView source can emit. */
function messageTypesPostedBy(source: string): string[] {
  return sortedUnique([...source.matchAll(/post\(\{\s*type:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
}

/** Every `fail('CODE', ...)` call site in one WebView source. */
function errorCodesRaisedBy(source: string): string[] {
  return sortedUnique([...source.matchAll(/fail\(\s*'([A-Z_]+)'/g)].map((m) => m[1]));
}

/**
 * Method names defined on `window.TFReader` in one template.
 *
 * POSITION-ANCHORED, which is why both templates are in .prettierignore: the object
 * is found by an 8-space `};` and its methods by a 10-space `name: function`. If a
 * formatter re-indents a template, this returns an empty list and the failure reads
 * as "the bridge drifted" rather than "the file was reformatted".
 */
function tfReaderMethodsIn(source: string, name: string): string[] {
  const block = /window\.TFReader\s*=\s*\{([\s\S]*?)\n\s{8}\};/.exec(source);
  if (!block) throw new Error(`Could not locate the window.TFReader object in ${name}.`);
  return sortedUnique([...block[1].matchAll(/^\s{10}([a-zA-Z]+):\s*function/gm)].map((m) => m[1]));
}

/** Union across every WebView source — see the header on why this is a union. */
function messageTypesPostedByWebView(): string[] {
  return sortedUnique(WEBVIEW_SOURCES.flatMap((s) => messageTypesPostedBy(s.text)));
}

function errorCodesRaisedByWebView(): string[] {
  return sortedUnique(WEBVIEW_SOURCES.flatMap((s) => errorCodesRaisedBy(s.text)));
}

function tfReaderMethods(): string[] {
  return sortedUnique([
    ...tfReaderMethodsIn(EPUB_TEMPLATE, 'reader-epub.template.html'),
    ...tfReaderMethodsIn(PDF_TEMPLATE, 'reader-pdf.template.html'),
  ]);
}

describe('parseReaderMessage', () => {
  it('parses every message the template can send', () => {
    expect(parseReaderMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseReaderMessage('{"type":"rendered"}')).toEqual({ type: 'rendered' });
    expect(
      parseReaderMessage(
        '{"type":"relocated","cfi":"epubcfi(/6/4!/2)","atStart":true,"atEnd":false}',
      ),
    ).toEqual({ type: 'relocated', cfi: 'epubcfi(/6/4!/2)', atStart: true, atEnd: false });
    expect(
      parseReaderMessage('{"type":"toc","items":[{"label":"One","href":"ch1.xhtml","depth":0}]}'),
    ).toEqual({ type: 'toc', items: [{ label: 'One', href: 'ch1.xhtml', depth: 0 }] });
    expect(parseReaderMessage('{"type":"error","code":"OPEN_FAILED","message":"boom"}')).toEqual({
      type: 'error',
      code: 'OPEN_FAILED',
      message: 'boom',
    });
  });

  it('returns null for anything that is not one of ours', () => {
    expect(parseReaderMessage('not json')).toBeNull();
    expect(parseReaderMessage('null')).toBeNull();
    expect(parseReaderMessage('[]')).toBeNull();
    expect(parseReaderMessage('{"type":"somethingElse"}')).toBeNull();
    expect(parseReaderMessage('{"noType":true}')).toBeNull();
  });

  it('hardens malformed fields rather than trusting the payload', () => {
    // A wrong-typed cfi must not become a string-typed lie downstream.
    expect(parseReaderMessage('{"type":"relocated","cfi":42}')).toEqual({
      type: 'relocated',
      cfi: null,
      atStart: false,
      atEnd: false,
    });
    // Non-conforming TOC entries are dropped, not passed through.
    expect(
      parseReaderMessage('{"type":"toc","items":[{"label":"ok","href":"a"},{"label":1},"junk"]}'),
    ).toEqual({ type: 'toc', items: [{ label: 'ok', href: 'a', depth: 0 }] });
    expect(parseReaderMessage('{"type":"toc","items":"nope"}')).toEqual({ type: 'toc', items: [] });
    // An unknown code still yields a usable, typed error.
    expect(parseReaderMessage('{"type":"error","code":"WAT","message":"m"}')).toEqual({
      type: 'error',
      code: 'WEBVIEW_SCRIPT_ERROR',
      message: 'm',
    });
  });
});

describe('TOC nesting depth', () => {
  function depthsOf(items: string): (number | undefined)[] {
    const message = parseReaderMessage(`{"type":"toc","items":${items}}`);
    if (message?.type !== 'toc') throw new Error('not a toc message');
    return message.items.map((item) => item.depth);
  }

  it('carries the depth the template flattened to', () => {
    expect(
      depthsOf('[{"label":"Part","href":"a","depth":0},{"label":"Ch","href":"b","depth":1}]'),
    ).toEqual([0, 1]);
  });

  it('treats a missing depth as top level, so a stale reader-epub.html still works', () => {
    // assets/reader/reader-epub.html is generated but TRACKED, so a working tree can
    // hold a template older than this file. Degrading to a flat list is the
    // failure mode we want; dropping every entry is not.
    expect(depthsOf('[{"label":"Ch","href":"b"}]')).toEqual([0]);
  });

  it('refuses a depth that is not a non-negative integer', () => {
    // The nav document these come from is book content, i.e. untrusted, and this
    // number reaches a style calculation.
    expect(
      depthsOf(
        '[{"label":"a","href":"a","depth":-1},' +
          '{"label":"b","href":"b","depth":1.5},' +
          '{"label":"c","href":"c","depth":"2"},' +
          '{"label":"d","href":"d","depth":null}]',
      ),
    ).toEqual([0, 0, 0, 0]);
  });

  it('clamps an absurd depth to MAX_TOC_DEPTH rather than dropping the entry', () => {
    // Losing a chapter is worse than mis-indenting one.
    expect(depthsOf('[{"label":"a","href":"a","depth":9001}]')).toEqual([MAX_TOC_DEPTH]);
  });
});

describe('buildCommandScript', () => {
  it('calls the matching window.TFReader method', () => {
    expect(buildCommandScript({ type: 'next' })).toContain('window.TFReader.next()');
    expect(buildCommandScript({ type: 'prev' })).toContain('window.TFReader.prev()');
  });

  it('JSON-encodes arguments so book content cannot break out of the string', () => {
    // A malicious/broken goTo target is content, and content is untrusted.
    const script = buildCommandScript({ type: 'goTo', target: `a'); alert('xss` });
    expect(script).toContain(String.raw`window.TFReader.goTo("a'); alert('xss")`);
    expect(script).not.toContain(`goTo('a');`);
  });

  it('carries an EPUB CFI target verbatim, not just a spine href', () => {
    // Search mints CFIs at index-build time (search/extractor.ts) and the Reader
    // resolves them through this same command — epub.js's spine.get() branches on
    // isCfiString() before its href lookup. The brackets and parens of a real CFI
    // must survive JSON encoding unmangled or the seek silently misses.
    const cfi = 'epubcfi(/6/2[ch1]!/4/4/1:113)';
    expect(buildCommandScript({ type: 'goTo', target: cfi })).toContain(
      `window.TFReader.goTo(${JSON.stringify(cfi)})`,
    );
  });

  it('guards against a missing bridge and ends with a statement value', () => {
    const script = buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' });
    expect(script).toContain('window.TFReader.openEpub("UEsDBA==")');
    // Without the guard, a call before the IIFE defines TFReader throws unseen.
    expect(script).toContain("typeof window.TFReader.openEpub !== 'function'");
    // Without a trailing value, iOS warns on every injectJavaScript call.
    expect(script.trimEnd().endsWith('true;')).toBe(true);
  });

  it('sends the base64 payload for BOTH open commands', () => {
    // The two differ only in method name — the payload handling must not diverge,
    // because base64ToArrayBuffer is shared and both renderers receive the same bytes.
    // A PDF's base64 is not zip-shaped, so this also pins that nothing assumes it is.
    const pdfBase64 = 'JVBERi0xLjQK'; // "%PDF-1.4\n"
    expect(buildCommandScript({ type: 'openPdf', base64: pdfBase64 })).toContain(
      `window.TFReader.openPdf(${JSON.stringify(pdfBase64)})`,
    );
    expect(buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' })).toContain(
      'window.TFReader.openEpub("UEsDBA==")',
    );
  });

  it('never puts a ContentFormat value into a command payload', () => {
    // Trigger 3 in WEBVIEW_BRIDGE.md, as an executable assertion rather than a note.
    // Format is routed by CHOOSING a command, so the literals 'EPUB'/'PDF'/'AUDIO'
    // must never appear in what crosses. Widening to open(base64, format) fails here.
    for (const script of [
      buildCommandScript({ type: 'openEpub', base64: 'UEsDBA==' }),
      buildCommandScript({ type: 'openPdf', base64: 'JVBERi0xLjQK' }),
      buildCommandScript({ type: 'next' }),
      buildCommandScript({ type: 'goTo', target: '12' }),
    ]) {
      for (const format of ['EPUB', 'PDF', 'AUDIO']) {
        expect(script).not.toContain(`'${format}'`);
        expect(script).not.toContain(`"${format}"`);
      }
    }
  });
});

// --- THE DRIFT GUARD ---------------------------------------------------------

describe('readerBridge <-> the WebView templates stay in sync', () => {
  it('every message type the WebView posts has a case in ReaderMessage', () => {
    // READER_MESSAGE_TYPES, not a literal copy of the union. This used to be a
    // hand-written array, which left one hand-synced list inside the guard whose
    // whole job is removing them: a case added to ReaderMessage but to neither the
    // template nor the literal failed nothing. readerBridge.ts now pins that array
    // to the union at compile time, so both sides of this assertion are derived.
    expect(messageTypesPostedByWebView()).toEqual([...READER_MESSAGE_TYPES].sort());
  });

  it('every message type in the union is parseable (no dead cases)', () => {
    for (const type of messageTypesPostedByWebView()) {
      expect(parseReaderMessage(JSON.stringify({ type }))).not.toBeNull();
    }
  });

  it('every error code the WebView raises is declared in WEBVIEW_ERROR_CODES', () => {
    expect(errorCodesRaisedByWebView()).toEqual([...WEBVIEW_ERROR_CODES].sort());
  });

  it('host-only error codes are never raised inside the WebView', () => {
    // If one of these appears in a WebView source, the two error namespaces have been
    // conflated and "where did this come from" stops being answerable.
    for (const code of HOST_ERROR_CODES) {
      expect(errorCodesRaisedByWebView()).not.toContain(code);
    }
  });

  it('every command maps to a real window.TFReader method', () => {
    expect(tfReaderMethods()).toEqual([...Object.values(READER_COMMANDS)].sort());
  });

  // --- per-file expectations the union deliberately cannot make ---------------

  it('each template defines exactly one open command, and it is its own format', () => {
    // The point of two commands rather than open(base64, format): the renderer is
    // chosen by WHICH METHOD EXISTS, so a template carrying both — or the wrong one —
    // would silently make the host's format switch meaningless.
    expect(tfReaderMethodsIn(EPUB_TEMPLATE, 'epub')).toContain(READER_COMMANDS.openEpub);
    expect(tfReaderMethodsIn(EPUB_TEMPLATE, 'epub')).not.toContain(READER_COMMANDS.openPdf);

    expect(tfReaderMethodsIn(PDF_TEMPLATE, 'pdf')).toContain(READER_COMMANDS.openPdf);
    expect(tfReaderMethodsIn(PDF_TEMPLATE, 'pdf')).not.toContain(READER_COMMANDS.openEpub);
  });

  it('both templates implement every format-agnostic command', () => {
    // next/prev/goTo are sent without the host knowing or caring which renderer is
    // loaded, so a template missing one answers NOT_READY for a command the host
    // believes is universal.
    for (const command of [READER_COMMANDS.next, READER_COMMANDS.prev, READER_COMMANDS.goTo]) {
      expect(tfReaderMethodsIn(EPUB_TEMPLATE, 'epub')).toContain(command);
      expect(tfReaderMethodsIn(PDF_TEMPLATE, 'pdf')).toContain(command);
    }
  });

  it('neither template redefines what the shared fragment provides', () => {
    // The whole reason reader.bridge.html exists. A template that declared its own
    // post() or fail() would shadow the shared one and drift silently — the guard
    // above would still pass, because the codes and types would still match.
    const shared = ['post', 'fail', 'showFallback', 'base64ToArrayBuffer'];

    // Collected rather than asserted one at a time so a failure names the file AND
    // the function, instead of reporting that some regex did not match something.
    const offenders = WEBVIEW_SOURCES.filter((s) => s.name !== 'reader.bridge.html').flatMap((s) =>
      shared
        .filter((fn) => new RegExp(`function\\s+${fn}\\s*\\(`).test(s.text))
        .map((fn) => `${s.name} defines its own ${fn}()`),
    );

    expect(offenders).toEqual([]);
  });

  it('the shared fragment is what raises the catch-all codes', () => {
    // These are registered once, in the fragment, for both formats. A template
    // raising them itself would mean the fragment was not inlined where expected.
    expect(errorCodesRaisedBy(BRIDGE_FRAGMENT)).toEqual(
      ['WEBVIEW_SCRIPT_ERROR', 'WEBVIEW_UNHANDLED_REJECTION'].sort(),
    );
  });
});
