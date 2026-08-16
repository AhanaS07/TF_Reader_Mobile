// Owner: Reader (Ahana).
//
// Two jobs:
//   1. Normal unit coverage of parseReaderMessage / buildCommandScript.
//   2. THE DRIFT GUARD (bottom of the file) — the reason this test matters more
//      than its size suggests.
//
// readerBridge.ts and webview/reader.template.html are two halves of one
// protocol, and the template half is deliberately outside tsc's view (it is
// plain JS inside a .html so allowJs/checkJs cannot reach it). ESLint cannot see
// it either — type-aware linting now covers src/features/reader/, but only the
// .ts/.tsx in it, and a .html is neither. So NOTHING in the toolchain can see
// that the two agree. The drift guard closes that by reading the template as text
// and
// asserting, mechanically, that every message type it posts has a case in the
// TS union and every method RN calls exists on window.TFReader.
//
// This converts the plan's "keep it in sync BY HAND" risk into a red test. If
// you add a message to one side and not the other, this fails by name.
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

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'webview', 'reader.template.html'), 'utf8');

/** Every distinct `post({ type: 'x' ... })` the template can emit. */
function messageTypesPostedByTemplate(): string[] {
  const matches = TEMPLATE.matchAll(/post\(\{\s*type:\s*'([a-zA-Z]+)'/g);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

/** Every `fail('CODE', ...)` call site in the template. */
function errorCodesRaisedByTemplate(): string[] {
  const matches = TEMPLATE.matchAll(/fail\(\s*'([A-Z_]+)'/g);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

/** Method names defined on `window.TFReader`. */
function tfReaderMethods(): string[] {
  const block = /window\.TFReader\s*=\s*\{([\s\S]*?)\n\s{8}\};/.exec(TEMPLATE);
  if (!block) throw new Error('Could not locate the window.TFReader object in the template.');
  const matches = block[1].matchAll(/^\s{10}([a-zA-Z]+):\s*function/gm);
  return [...new Set([...matches].map((m) => m[1]))].sort();
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

  it('treats a missing depth as top level, so a stale reader.html still works', () => {
    // assets/reader/reader.html is generated but TRACKED, so a working tree can
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
    const script = buildCommandScript({ type: 'open', base64: 'UEsDBA==' });
    expect(script).toContain('window.TFReader.open("UEsDBA==")');
    // Without the guard, a call before the IIFE defines TFReader throws unseen.
    expect(script).toContain("typeof window.TFReader.open !== 'function'");
    // Without a trailing value, iOS warns on every injectJavaScript call.
    expect(script.trimEnd().endsWith('true;')).toBe(true);
  });
});

// --- THE DRIFT GUARD ---------------------------------------------------------

describe('readerBridge <-> reader.template.html stay in sync', () => {
  it('every message type the template posts has a case in ReaderMessage', () => {
    // READER_MESSAGE_TYPES, not a literal copy of the union. This used to be a
    // hand-written array, which left one hand-synced list inside the guard whose
    // whole job is removing them: a case added to ReaderMessage but to neither the
    // template nor the literal failed nothing. readerBridge.ts now pins that array
    // to the union at compile time, so both sides of this assertion are derived.
    expect(messageTypesPostedByTemplate()).toEqual([...READER_MESSAGE_TYPES].sort());
  });

  it('every message type in the union is parseable (no dead cases)', () => {
    for (const type of messageTypesPostedByTemplate()) {
      expect(parseReaderMessage(JSON.stringify({ type }))).not.toBeNull();
    }
  });

  it('every error code the template raises is declared in WEBVIEW_ERROR_CODES', () => {
    expect(errorCodesRaisedByTemplate()).toEqual([...WEBVIEW_ERROR_CODES].sort());
  });

  it('host-only error codes are never raised inside the WebView', () => {
    // If one of these appears in the template, the two error namespaces have been
    // conflated and "where did this come from" stops being answerable.
    for (const code of HOST_ERROR_CODES) {
      expect(errorCodesRaisedByTemplate()).not.toContain(code);
    }
  });

  it('every command maps to a real window.TFReader method', () => {
    expect(tfReaderMethods()).toEqual([...Object.values(READER_COMMANDS)].sort());
  });
});
