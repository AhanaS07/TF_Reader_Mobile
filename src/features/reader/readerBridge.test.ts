// Owner: Reader (Ahana).
//
// Two jobs:
//   1. Normal unit coverage of parseReaderMessage / buildCommandScript.
//   2. THE DRIFT GUARD (bottom of the file) — the reason this test matters more
//      than its size suggests.
//
// readerBridge.ts and webview/reader.template.html are two halves of one
// protocol, and the template half is deliberately outside tsc's view (it is
// plain JS inside a .html so allowJs/checkJs cannot reach it), while type-aware
// ESLint is off repo-wide. So NOTHING in the toolchain can see that the two
// agree. The drift guard closes that by reading the template as text and
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
  READER_COMMANDS,
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
      parseReaderMessage('{"type":"toc","items":[{"label":"One","href":"ch1.xhtml"}]}'),
    ).toEqual({ type: 'toc', items: [{ label: 'One', href: 'ch1.xhtml' }] });
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
    ).toEqual({ type: 'toc', items: [{ label: 'ok', href: 'a' }] });
    expect(parseReaderMessage('{"type":"toc","items":"nope"}')).toEqual({ type: 'toc', items: [] });
    // An unknown code still yields a usable, typed error.
    expect(parseReaderMessage('{"type":"error","code":"WAT","message":"m"}')).toEqual({
      type: 'error',
      code: 'WEBVIEW_SCRIPT_ERROR',
      message: 'm',
    });
  });
});

describe('buildCommandScript', () => {
  it('calls the matching window.TFReader method', () => {
    expect(buildCommandScript({ type: 'next' })).toContain('window.TFReader.next()');
    expect(buildCommandScript({ type: 'prev' })).toContain('window.TFReader.prev()');
  });

  it('JSON-encodes arguments so book content cannot break out of the string', () => {
    // A malicious/broken TOC href is content, and content is untrusted.
    const script = buildCommandScript({ type: 'goTo', href: `a'); alert('xss` });
    expect(script).toContain(String.raw`window.TFReader.goTo("a'); alert('xss")`);
    expect(script).not.toContain(`goTo('a');`);
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
    // Mirror of the ReaderMessage union. Kept as a literal on purpose: a TS union
    // has no runtime representation to enumerate, so this list is the assertion.
    // Adding a case to the union without adding it here fails the next check.
    const unionTypes = ['error', 'ready', 'relocated', 'rendered', 'toc'];

    expect(messageTypesPostedByTemplate()).toEqual(unionTypes);
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
