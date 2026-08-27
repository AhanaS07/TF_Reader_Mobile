// Owner: Reader (Ahana).
//
// Unit coverage of parseReaderMessage / buildCommandScript, plus the two invariants that survived
// the typechecked-WebView conversion.
//
// >>> THE DRIFT GUARD IS GONE, AND ITS DELETION IS THE POINT. <<<
// This file used to read the WebView halves as TEXT and assert, mechanically, that every message type
// they posted had a case in the TS union and every method RN called existed on `window.TFReader`. It
// had to, because those halves were plain JS inside .html files that neither tsc nor ESLint could
// see.
//
// They are TypeScript now (webview/src/), and they IMPORT `ReaderMessage` and `ReaderCommand` from
// readerBridge.ts. So each of those assertions became a type:
//
//   posted types match the union        -> `post(message: ReaderMessage)` in webview/src/bridge.ts
//   raised codes are declared           -> `fail(code: WebViewErrorCode, ...)`
//   host-only codes never raised inside -> the same parameter type excludes them
//   every command has a method          -> `TFReaderApi<Open>`, a mapped type over ReaderCommand
//   each shell defines only its own open -> `TFReaderApi<'openEpub'>` vs `TFReaderApi<'openPdf'>`
//   a method's ARGUMENTS match its command -> `CommandArgsMatchPayloads`, which the old guard could
//                                             not see at all: it compared names, so a command growing
//                                             a field while its method kept the old signature passed.
//
// Deleting a guard normally reads as a regression, so to be explicit: every one of those is now
// checked more strictly and earlier, by `npm run typecheck` rather than by a regex that also depended
// on both templates staying out of prettier's reach.
//
// WHAT A TYPE STILL CANNOT SEE, and therefore stays below:
//
//   1. The JSON round trip. `parseReaderMessage` receives an untyped string built from book content,
//      so compile-time types prove nothing about it. This is the majority of the file and it did not
//      change.
//   2. `buildCommandScript`'s OUTPUT is a string of JavaScript. That a `ContentFormat` literal never
//      appears in it is a property of generated text, not of a type.
//   3. Codes DECLARED BUT NEVER RAISED. `fail`'s parameter type gives raised ⊆ declared; nothing
//      gives the reverse, so `WEBVIEW_ERROR_CODES` could still grow a dead member.
//   4. WHERE a code is raised. The catch-alls belong in the shared module, not duplicated into each
//      entry — a placement rule, not a type.
//
// Node's fs is used to read the entry sources for 3 and 4. That is a test-time Node dependency, not
// device code.

import * as fs from 'fs';
import * as path from 'path';

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';
import {
  HOST_ERROR_CODES,
  MAX_TOC_DEPTH,
  READER_COMMANDS,
  READER_MESSAGE_TYPES,
  WEBVIEW_ERROR_CODES,
  buildCommandScript,
  parseReaderMessage,
} from '@/features/reader/readerBridge';

/** A representative appearance payload — every field, so the JSON-encoding test is not testing a
 * partial shape by accident. */
const SAMPLE_APPEARANCE: ReaderAppearance = {
  colorScheme: 'dark',
  fg: '#e6e6e6',
  bg: '#121212',
  link: '#6ea8fe',
  fontFamily: '',
  customFontUri: null,
  fontSizePt: 16,
  lineHeight: 1.5,
  letterSpacingPx: 0,
  marginPx: 16,
  flow: 'paginated',
  spread: 'single',
  zoom: 1,
  reduceMotion: false,
  highContrast: false,
  boldText: false,
  dyslexiaFont: false,
  readableSpacing: false,
  announcePageChanges: true,
};

const webviewFile = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, 'webview', ...parts), 'utf8');

/**
 * The three files the WebView half is compiled from.
 *
 * Read as text only for the two assertions above that are about text. Everything else about these
 * files is checked by the compiler now.
 */
const WEBVIEW_SOURCES: readonly { name: string; text: string }[] = [
  { name: 'webview/src/bridge.ts', text: webviewFile('src', 'bridge.ts') },
  { name: 'webview/src/epub.entry.ts', text: webviewFile('src', 'epub.entry.ts') },
  { name: 'webview/src/pdf.entry.ts', text: webviewFile('src', 'pdf.entry.ts') },
];

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

/** Every `fail('CODE', ...)` call site across the WebView sources. */
function errorCodesRaisedByWebView(): string[] {
  return sortedUnique(
    WEBVIEW_SOURCES.flatMap((source) => [
      ...source.text.matchAll(/fail\(\s*'([A-Z_]+)'/g),
    ]).map((m) => m[1]),
  );
}

describe('parseReaderMessage', () => {
  it('parses every message the template can send', () => {
    expect(parseReaderMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseReaderMessage('{"type":"rendered"}')).toEqual({ type: 'rendered' });
    expect(
      parseReaderMessage(
        '{"type":"relocated","position":{"kind":"cfi","cfi":"epubcfi(/6/4!/2)"},"atStart":true,"atEnd":false}',
      ),
    ).toEqual({
      type: 'relocated',
      position: { kind: 'cfi', cfi: 'epubcfi(/6/4!/2)' },
      atStart: true,
      atEnd: false,
    });
    expect(
      parseReaderMessage(
        '{"type":"relocated","position":{"kind":"page","page":4,"pageCount":50},"atStart":false,"atEnd":false}',
      ),
    ).toEqual({
      type: 'relocated',
      position: { kind: 'page', page: 4, pageCount: 50 },
      atStart: false,
      atEnd: false,
    });
    expect(
      parseReaderMessage(
        '{"type":"toc","items":[{"label":"One","target":{"kind":"href","href":"ch1.xhtml"},"depth":0}]}',
      ),
    ).toEqual({
      type: 'toc',
      items: [{ label: 'One', target: { kind: 'href', href: 'ch1.xhtml' }, depth: 0 }],
    });
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
    expect(parseReaderMessage('{"type":"relocated","position":{"kind":"cfi","cfi":42}}')).toEqual({
      type: 'relocated',
      position: { kind: 'cfi', cfi: null },
      atStart: false,
      atEnd: false,
    });
    // Non-conforming TOC entries are dropped, not passed through — and since the target became
    // discriminated that now includes a row whose TARGET is unusable, which the old shape could not
    // detect: any string was a plausible href, so a malformed entry became a Contents row that could
    // only ever raise NAVIGATION_FAILED when tapped.
    expect(
      parseReaderMessage(
        '{"type":"toc","items":[' +
          '{"label":"ok","target":{"kind":"href","href":"a"}},' +
          '{"label":1,"target":{"kind":"href","href":"b"}},' +
          '{"label":"no target"},' +
          '{"label":"bad format","target":{"format":"AUDIO"}},' +
          '{"label":"page zero","target":{"kind":"page","page":0}},' +
          '"junk"]}',
      ),
    ).toEqual({
      type: 'toc',
      items: [{ label: 'ok', target: { kind: 'href', href: 'a' }, depth: 0 }],
    });
    expect(parseReaderMessage('{"type":"toc","items":"nope"}')).toEqual({ type: 'toc', items: [] });
    // An unknown code still yields a usable, typed error.
    expect(parseReaderMessage('{"type":"error","code":"WAT","message":"m"}')).toEqual({
      type: 'error',
      code: 'WEBVIEW_SCRIPT_ERROR',
      message: 'm',
    });
  });
});

describe('the reported position', () => {
  const relocated = (position: string): unknown =>
    parseReaderMessage(`{"type":"relocated","position":${position},"atStart":false,"atEnd":false}`);

  it('accepts a PDF page inside its document', () => {
    expect(relocated('{"kind":"page","page":1,"pageCount":1}')).toMatchObject({
      position: { kind: 'page', page: 1, pageCount: 1 },
    });
  });

  // STRICTER THAN THE OTHER HARDENERS, and the whole block exists to pin that choice. A mis-indented
  // Contents row is cosmetic, so asTocDepth collapses a bad value to 0. A position is shown to the
  // user as a claim about where they are, so a nonsense value is DROPPED rather than smoothed into a
  // plausible one — the message parses to null and the caller raises BRIDGE_PARSE_FAILED.
  it.each([
    ['a missing position', 'null'],
    ['an unknown format', '{"format":"AUDIO","page":1,"pageCount":2}'],
    ['no format at all', '{"page":1,"pageCount":2}'],
    ['a page of zero', '{"kind":"page","page":0,"pageCount":2}'],
    ['a negative page', '{"kind":"page","page":-1,"pageCount":2}'],
    ['a fractional page', '{"kind":"page","page":1.5,"pageCount":2}'],
    ['a stringified page', '{"kind":"page","page":"1","pageCount":2}'],
    ['a missing pageCount', '{"kind":"page","page":1}'],
    ['a zero pageCount', '{"kind":"page","page":1,"pageCount":0}'],
  ])('drops the whole message for %s', (_label, position) => {
    expect(relocated(position)).toBeNull();
  });

  // THE RELATION, which is the part worth having: both fields are individually valid here and jointly
  // impossible, and "page 7 of 3" is exactly what a rendering bug would produce.
  it('refuses a page past its own page count', () => {
    expect(relocated('{"kind":"page","page":7,"pageCount":3}')).toBeNull();
  });

  // An EPUB position is deliberately permissive by comparison: a null cfi is a real state (epub.js
  // reports a location before the first CFI resolves), and it costs nothing because nothing is
  // displayed from it.
  it('keeps an EPUB position whose cfi is absent', () => {
    expect(relocated('{"kind":"cfi"}')).toMatchObject({
      position: { kind: 'cfi', cfi: null },
    });
  });
});

describe('TOC nesting depth', () => {
  // Every entry below carries a valid `target` because a row without one is now DROPPED rather than
  // kept — see the hardening test above. These cases are about `depth`, so the target is scaffolding
  // and not the subject; leaving it out would make them all pass for the wrong reason (an empty list).
  function depthsOf(items: string): (number | undefined)[] {
    const message = parseReaderMessage(`{"type":"toc","items":${items}}`);
    if (message?.type !== 'toc') throw new Error('not a toc message');
    return message.items.map((item) => item.depth);
  }

  it('carries the depth the template flattened to', () => {
    expect(
      depthsOf('[{"label":"Part","target":{"kind":"href","href":"a"},"depth":0},{"label":"Ch","target":{"kind":"href","href":"b"},"depth":1}]'),
    ).toEqual([0, 1]);
  });

  it('treats a missing depth as top level, so a stale reader-epub.html still works', () => {
    // assets/reader/reader-epub.html is generated but TRACKED, so a working tree can
    // hold a template older than this file. Degrading to a flat list is the
    // failure mode we want; dropping every entry is not.
    expect(depthsOf('[{"label":"Ch","target":{"kind":"href","href":"b"}}]')).toEqual([0]);
  });

  it('refuses a depth that is not a non-negative integer', () => {
    // The nav document these come from is book content, i.e. untrusted, and this
    // number reaches a style calculation.
    expect(
      depthsOf(
        '[{"label":"a","target":{"kind":"href","href":"a"},"depth":-1},' +
          '{"label":"b","target":{"kind":"href","href":"b"},"depth":1.5},' +
          '{"label":"c","target":{"kind":"href","href":"c"},"depth":"2"},' +
          '{"label":"d","target":{"kind":"href","href":"d"},"depth":null}]',
      ),
    ).toEqual([0, 0, 0, 0]);
  });

  it('clamps an absurd depth to MAX_TOC_DEPTH rather than dropping the entry', () => {
    // Losing a chapter is worse than mis-indenting one.
    expect(depthsOf('[{"label":"a","target":{"kind":"href","href":"a"},"depth":9001}]')).toEqual([MAX_TOC_DEPTH]);
  });
});

describe('buildCommandScript', () => {
  it('calls the matching window.TFReader method', () => {
    expect(buildCommandScript({ type: 'next' })).toContain('window.TFReader.next()');
    expect(buildCommandScript({ type: 'prev' })).toContain('window.TFReader.prev()');
  });

  it('JSON-encodes arguments so book content cannot break out of the string', () => {
    // A malicious/broken goTo target is content, and content is untrusted. The href is nested inside an
    // object now, which changes nothing about the risk or the defence: JSON.stringify was always
    // applied to the whole argument rather than to a string, which is why the target becoming a
    // discriminated union needed no change here.
    const script = buildCommandScript({
      type: 'goTo',
      target: { kind: 'href', href: `a'); alert('xss` },
    });
    expect(script).toContain(
      String.raw`window.TFReader.goTo({"kind":"href","href":"a'); alert('xss"})`,
    );
    expect(script).not.toContain(`alert('xss')`);
  });

  it('carries an EPUB CFI target verbatim, not just a spine href', () => {
    // Search mints CFIs at index-build time (search/extractor.ts) and the Reader resolves them through
    // this same command — epub.js's spine.get() branches on isCfiString() before its href lookup. The
    // brackets and parens of a real CFI must survive JSON encoding unmangled or the seek silently
    // misses.
    const target = { kind: 'href', href: 'epubcfi(/6/2[ch1]!/4/4/1:113)' } as const;
    expect(buildCommandScript({ type: 'goTo', target })).toContain(
      `window.TFReader.goTo(${JSON.stringify(target)})`,
    );
  });

  it('carries a PDF page target as a number, not a stringified one', () => {
    // THE OVERLOAD THIS REPLACED. A Contents row used to arrive as `href: '12'` and be sent back as the
    // string '12', which the PDF shell parseInt'd. The number now survives end to end, so there is no
    // round trip through a vocabulary the host had to guess at.
    const script = buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 12 } });
    expect(script).toContain('window.TFReader.goTo({"kind":"page","page":12})');
    expect(script).not.toContain('"page":"12"');
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

  it('calls applyAppearance with the whole appearance object, JSON-encoded', () => {
    // ReaderAppearance is flat and primitive-only (readerAppearance.test.ts pins that), so encoding
    // the whole object is exactly as safe as goTo.target above — there is no second field to keep in
    // step, unlike CommandArgs's per-field entries.
    const script = buildCommandScript({ type: 'applyAppearance', appearance: SAMPLE_APPEARANCE });
    expect(script).toContain(
      `window.TFReader.applyAppearance(${JSON.stringify(SAMPLE_APPEARANCE)})`,
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
      buildCommandScript({ type: 'goTo', target: { kind: 'page', page: 12 } }),
      buildCommandScript({ type: 'applyAppearance', appearance: SAMPLE_APPEARANCE }),
      // The newest way this rule could have been broken: `HighlightPaint` (Sync's stored shape) DOES
      // discriminate on `format: 'EPUB' | 'PDF'`, so forwarding it as-is would put a frozen enum
      // value on the wire. `toReaderHighlights` strips it host-side into these per-shell shapes;
      // this is that stripping, asserted rather than trusted.
      buildCommandScript({
        type: 'paintHighlights',
        highlights: [{ id: 'hl-1', startCfi: 'epubcfi(/6/4!/4/2/1:0)', endCfi: 'epubcfi(/6/4!/4/2/1:9)', color: 'yellow' }],
      }),
      buildCommandScript({
        type: 'paintHighlights',
        highlights: [{ id: 'hl-2', page: 4, startOffset: 10, endOffset: 25, color: 'yellow' }],
      }),
    ]) {
      for (const format of ['EPUB', 'PDF', 'AUDIO']) {
        expect(script).not.toContain(`'${format}'`);
        expect(script).not.toContain(`"${format}"`);
      }
    }
  });
});

// --- THE DRIFT GUARD ---------------------------------------------------------

describe('what the compiler cannot check about the WebView half', () => {
  it('declares no error code the WebView never actually raises', () => {
    // THE DIRECTION TYPES DO NOT COVER. `fail(code: WebViewErrorCode, ...)` guarantees that every
    // code raised is declared. Nothing guarantees the reverse, so WEBVIEW_ERROR_CODES could
    // accumulate a member no shell can produce — which reads to the next person as a failure mode
    // that exists and has to be handled.
    expect(errorCodesRaisedByWebView()).toEqual([...WEBVIEW_ERROR_CODES].sort());
  });

  it('never raises a host-only code from inside the WebView', () => {
    // Also covered by `fail`'s parameter type, and kept anyway because it is one line and states an
    // ownership boundary the codes' own names do not: HOST_ERROR_CODES are synthesised by
    // ReaderScreen for failures that happen before or outside the WebView.
    expect(
      errorCodesRaisedByWebView().filter((code) => (HOST_ERROR_CODES as readonly string[]).includes(code)),
    ).toEqual([]);
  });

  it('raises the catch-all codes from the shared module, not from either entry', () => {
    // A PLACEMENT rule, which no type expresses. window.onerror and unhandledrejection are
    // registered once, in bridge.ts, and the entries call installErrorHandlers() first so the
    // handlers exist before any renderer setup can throw. Duplicating them into an entry would mean
    // one shell reporting a throw twice and the other not at all.
    const CATCH_ALLS = ['WEBVIEW_SCRIPT_ERROR', 'WEBVIEW_UNHANDLED_REJECTION'];
    const byName = new Map(WEBVIEW_SOURCES.map((s) => [s.name, s.text]));

    for (const code of CATCH_ALLS) {
      expect(byName.get('webview/src/bridge.ts')).toContain(`fail('${code}'`);
      expect(byName.get('webview/src/epub.entry.ts')).not.toContain(`fail('${code}'`);
      expect(byName.get('webview/src/pdf.entry.ts')).not.toContain(`fail('${code}'`);
    }
  });

  it('installs those handlers before anything that can throw', () => {
    // Ordering, not presence. When this logic lived inline it sat two thirds of the way down the
    // file and anything that threw above it was invisible — a blank page and a READY_TIMEOUT.
    for (const source of WEBVIEW_SOURCES.filter((s) => s.name.endsWith('.entry.ts'))) {
      const install = source.text.indexOf('installErrorHandlers()');
      const publish = source.text.indexOf('publish(api)');
      expect(install).toBeGreaterThan(-1);
      expect(publish).toBeGreaterThan(install);
    }
  });

  it('lets every message type in the union be parsed (no dead cases)', () => {
    // A TS-side check: a type added to ReaderMessage but not to parseReaderMessage's switch returns
    // null and surfaces as BRIDGE_PARSE_FAILED at runtime rather than failing a build.
    //
    // EACH TYPE NEEDS ITS MINIMUM VALID PAYLOAD, not a bare `{ type }`. This used to send the bare
    // form, which worked only because every case tolerated an absent payload — and `relocated` now
    // deliberately does not, because a position it cannot understand must not parse. The map is the
    // better shape anyway: it documents what the minimum is, and `satisfies` makes forgetting to add
    // an entry a compile error rather than a passing test over a shorter list.
    const MINIMUM: Record<(typeof READER_MESSAGE_TYPES)[number], Record<string, unknown>> = {
      ready: {},
      rendered: {},
      relocated: { position: { kind: 'cfi' } },
      toc: {},
      error: {},
      ttsSentence: { requestId: 0, result: { status: 'unavailable' } },
      // `null` IS the minimum valid payload here, not a placeholder for one — "nothing is selected"
      // is half of what this message exists to carry, so a case that only accepted a real selection
      // would drop every clear.
      selection: { selection: null, anchor: null },
      highlightPressed: { id: 'hl-1', anchor: { x: 10, y: 20, width: 0, height: 0 } },
    };

    for (const type of READER_MESSAGE_TYPES) {
      expect(parseReaderMessage(JSON.stringify({ type, ...MINIMUM[type] }))).not.toBeNull();
    }
  });

  it('names every command as its own method name', () => {
    // READER_COMMANDS maps a command name to the literal method name on window.TFReader. The mapping
    // being the identity is what makes `TFReaderApi` able to be a mapped type over ReaderCommand at
    // all, and what makes a mismatch greppable.
    for (const [command, method] of Object.entries(READER_COMMANDS)) {
      expect(method).toBe(command);
    }
  });
});
