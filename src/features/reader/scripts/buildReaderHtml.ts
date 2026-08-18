// Owner: Reader (Ahana).
//
// Builds the self-contained HTML files the reader WebView loads — ONE PER CONTENT
// FORMAT:
//
//   webview/reader-epub.template.html                  (shell: HTML + CSS only, edit this)
//   + node_modules/jszip/dist/jszip.min.js             (inlined)
//   + node_modules/epubjs/dist/epub.min.js             (inlined)
//   + webview/src/epub.entry.ts                        (COMPILED by esbuild, then inlined)
//   = assets/reader/reader-epub.html                   (generated, committed)
//
//   webview/reader-pdf.template.html                   (shell: HTML + CSS only, edit this)
//   + node_modules/pdfjs-dist/build/pdf.min.js         (inlined)
//   + node_modules/pdfjs-dist/build/pdf.worker.min.js  (inlined, raw, as text/plain)
//   + webview/src/pdf.entry.ts                         (COMPILED by esbuild, then inlined)
//   = assets/reader/reader-pdf.html                    (generated, committed)
//
// >>> THE WEBVIEW HALF IS TYPECHECKED TYPESCRIPT NOW. <<< It used to be plain JS inside the
// templates plus a shared reader.bridge.html fragment, kept in sync with readerBridge.ts by hand.
// The entries under webview/src/ IMPORT ReaderMessage / ReaderCommand from readerBridge.ts, so the
// two halves of the bridge are one contract rather than two descriptions of it. `npm run typecheck`
// covers them like any other file under src/ — no second tsconfig, because the root one already has
// DOM in `lib`. See WEBVIEW_BRIDGE.md.
//
// esbuild is used ONLY as a bundler; it strips types without checking them. `npm run typecheck` is
// what checks them, so a build that succeeds here proves nothing about types on its own.
//
// Run: npm run reader:build-html
// (which is `npx tsx src/features/reader/scripts/buildReaderHtml.ts` — tsx, not
// ts-node, matching the encryption scripts' precedent. tsx is a devDep; npx
// resolves it locally.)
//
// WHY TWO ARTIFACTS AND NOT ONE BRANCHING FILE: pdf.js plus its worker is ~1.4MB
// inlined. A single file would make every EPUB read carry a renderer it can never
// call. It is also load-bearing for CORRECTNESS, not just size: one shell per book is
// why each shell only ever receives targets in its own addressing scheme, and can
// refuse the other outright. The two entries share their bridge half by IMPORTING
// webview/src/bridge.ts, so there is one copy of post() / fail() /
// base64ToArrayBuffer() and no hand-sync anywhere.
//
// WHY INLINE INSTEAD OF SHIPPING SEPARATE FILES: Metro classifies `.js` as a SOURCE
// extension, so a `.js` file can never be bundled as an asset and served next to
// the HTML — and release Android builds rename assets under
// file:///android_asset/, so relative sub-resource paths are not stable either.
// One file with zero sub-resource requests solves both, and makes the
// offline-first guarantee structural rather than a promise.
//
// WHY jszip IS A SEPARATE INLINE: verified against the installed dist —
// epub.js 0.3.93's UMD header ends `t.ePub=e(t.JSZip)`, i.e. JSZip is a webpack
// EXTERNAL read off `window`, not bundled. Confirmed by absence: epub.min.js
// contains zero JSZip implementation fingerprints (no DEFLATE/STORE/pako/
// compressedSize). So JSZip must be inlined, and it must come FIRST.
//
// WHY THE PDF WORKER IS INJECTED RAW INTO A type="text/plain" BLOCK: pdf.js picks
// its execution mode by probing for an already-loaded worker module
// (`globalThis.pdfjsWorker?.WorkerMessageHandler`, the
// `_mainThreadWorkerMessageHandler` getter in pdf.min.js). pdf.worker.min.js is
// UMD and its header does `e.pdfjsWorker=t()`, so inlining it as an EXECUTABLE
// script would define that global and force pdf.js to parse every page on the main
// thread. Parked as inert text and handed over as a Blob URL, it becomes a real
// worker thread instead. See the long comment at that marker in the PDF template.
//
// This script uses Node globals (fs/path/__dirname). That is legitimate here for
// the same reason it is in src/features/encryption/scripts/ — it runs under
// Node, never on device — and is why tsconfig carries "node" in `types`.
// NOTHING under src/features/reader/ OUTSIDE this scripts/ folder may import
// Node built-ins; the rest of the feature is React Native code.

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const webview = (...parts: string[]): string =>
  path.join(REPO_ROOT, 'src', 'features', 'reader', 'webview', ...parts);
const dist = (...parts: string[]): string => path.join(REPO_ROOT, 'node_modules', ...parts);
const asset = (file: string): string => path.join(REPO_ROOT, 'assets', 'reader', file);

/**
 * The compiled entry point for each format. Both pull in webview/src/bridge.ts, which is where the
 * shared half of the bridge lives now that it is a real module rather than a spliced-in fragment.
 */
const EPUB_ENTRY = webview('src', 'epub.entry.ts');
const PDF_ENTRY = webview('src', 'pdf.entry.ts');

/**
 * Hard ceiling on a compiled entry, and it is a real guard rather than a tidiness rule.
 *
 * epub.js, JSZip and pdf.js arrive on `window` from their own inlined <script> tags. If an entry ever
 * imports one of them as a VALUE instead of `import type`, esbuild would helpfully bundle a second
 * copy — 300 KB to 1.4 MB of it — into a file that already contains the library. The result still
 * works, so nothing else here would notice. Both entries are comfortably under 20 KB today; this
 * leaves headroom for the prefs-application work while a library leak overshoots by an order of
 * magnitude.
 */
const MAX_ENTRY_BUNDLE_BYTES = 80 * 1024;

/**
 * How an injected source is spliced in.
 *
 * `script` wraps it in its own <script data-lib="…"> tag — for whole libraries that
 * need their own scope and are the unit the load-order check reasons about.
 *
 * `raw` splices the source in verbatim, re-indented to its marker's depth. Used for
 * two different jobs: the bridge fragment (which must land INSIDE the template's
 * IIFE so its functions stay locals rather than becoming globals in a document
 * holding decrypted content), and the pdf.js worker (which must land inside a
 * type="text/plain" block so it does NOT execute — see the header).
 */
type Wrap = 'script' | 'raw';

interface Injection {
  marker: string;
  source: string;
  label: string;
  wrap: Wrap;
  /**
   * Compile `source` as a TypeScript entry point with esbuild instead of inlining the file verbatim.
   * Only the two webview/src entries use this.
   */
  bundle?: boolean;
}

interface Artifact {
  name: string;
  template: string;
  output: string;
  injections: readonly Injection[];
  /**
   * Marker names in the order they MUST appear in the template. Checked against the
   * template source rather than the output, because the template is where order is
   * actually decided and it is the one place that works for `raw` injections too
   * (they leave no data-lib tag to find).
   */
  order: readonly string[];
  /** Substrings that must survive into the output, each from its own dist's UMD header. */
  fingerprints: readonly { needle: string; hint: string }[];
}

const ARTIFACTS: readonly Artifact[] = [
  {
    name: 'EPUB',
    template: webview('reader-epub.template.html'),
    output: asset('reader-epub.html'),
    injections: [
      {
        marker: '<!-- @inject:jszip -->',
        source: dist('jszip', 'dist', 'jszip.min.js'),
        label: 'JSZip',
        wrap: 'script',
      },
      {
        marker: '<!-- @inject:epubjs -->',
        source: dist('epubjs', 'dist', 'epub.min.js'),
        label: 'epub.js',
        wrap: 'script',
      },
      {
        marker: '<!-- @inject:entry -->',
        source: EPUB_ENTRY,
        label: 'epub entry',
        wrap: 'script',
        bundle: true,
      },
    ],
    // The entry is LAST on purpose: it reads window.ePub and window.JSZip as it runs, and posts
    // EPUBJS_MISSING / JSZIP_MISSING if either is absent. Put it first and every open fails that way.
    order: ['<!-- @inject:jszip -->', '<!-- @inject:epubjs -->', '<!-- @inject:entry -->'],
    fingerprints: [
      { needle: 'JSZip v3', hint: 'JSZip banner — inline produced nothing.' },
      {
        needle: 't.ePub=e(t.JSZip)',
        hint:
          'epub.js UMD footer. If epubjs was upgraded and no longer takes JSZip as ' +
          'an external, re-verify whether jszip is still needed at all before ' +
          'changing this assertion.',
      },
    ],
  },
  {
    name: 'PDF',
    template: webview('reader-pdf.template.html'),
    output: asset('reader-pdf.html'),
    injections: [
      {
        marker: '<!-- @inject:pdfjs -->',
        source: dist('pdfjs-dist', 'build', 'pdf.min.js'),
        label: 'pdf.js',
        wrap: 'script',
      },
      {
        marker: '<!-- @inject:pdfjsworker -->',
        source: dist('pdfjs-dist', 'build', 'pdf.worker.min.js'),
        label: 'pdf.js worker',
        wrap: 'raw',
      },
      {
        marker: '<!-- @inject:entry -->',
        source: PDF_ENTRY,
        label: 'pdf entry',
        wrap: 'script',
        bundle: true,
      },
    ],
    // The entry is LAST on purpose: it reads window.pdfjsLib as it runs and posts PDFJS_MISSING if it
    // is absent. It also reads the text/plain worker block out of the DOM, which must already exist.
    order: [
      '<!-- @inject:pdfjs -->',
      '<!-- @inject:pdfjsworker -->',
      '<!-- @inject:entry -->',
    ],
    fingerprints: [
      {
        needle: 't.pdfjsLib=e()',
        hint:
          'pdf.js UMD footer — this is what defines window.pdfjsLib. pdfjs-dist is ' +
          'PINNED to 3.11.174 because v4+ ships ESM only (pdf.min.mjs) and this ' +
          'script emits classic <script> tags. If this assertion fails after a ' +
          'version bump, the bump is the problem.',
      },
      {
        needle: 'WorkerMessageHandler',
        hint: 'pdf.js worker source — the text/plain block inlined nothing.',
      },
    ],
  },
];

/**
 * Compile one entry point to a single self-contained IIFE.
 *
 * Every option below is load-bearing:
 *
 *  - `format: 'iife'` PRESERVES THE SCOPE PROPERTY STRUCTURALLY. Nothing in the entry becomes a
 *    global except what it explicitly assigns to `window`. That matters because this document holds
 *    decrypted book content, and widening what a malicious book's own script can reach is exactly
 *    what the old "inject the fragment raw, inside the IIFE" rule was protecting.
 *  - `bundle: true` with no `external`, so the output has zero imports and needs no module loader —
 *    the same zero-sub-resource-requests property the inlined libs have.
 *  - `minify: false` DELIBERATELY. These artifacts are tracked and diffed in review and in CI; a
 *    readable diff is worth far more than a few KB next to 1.4 MB of already-minified pdf.js. It also
 *    means a stack trace from inside a document holding licensed content is legible.
 *  - `target: 'safari15'` rather than `esnext`, so output runs on the WKWebView versions this app
 *    supports. Do NOT raise it casually: `base64ToArrayBuffer`'s feature test for
 *    `Uint8Array.fromBase64` exists because that API is much newer than the floor.
 *  - `tsconfig` explicitly, so esbuild resolves the `@/` path alias the same way tsc does.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A NICETY: CI regenerates both artifacts and `git diff
 * --exit-code`s them. esbuild's output is stable for a fixed version and input, which is why
 * package.json pins it EXACTLY (no caret). A flapping diff here means the version drifted; do not
 * "fix" it by loosening the CI check.
 */
function bundleEntry(entry: string, label: string): string {
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing ${label} entry point: ${entry}`);
  }

  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'safari15',
    minify: false,
    legalComments: 'none',
    tsconfig: path.join(REPO_ROOT, 'tsconfig.json'),
    write: false,
  });

  const file = result.outputFiles[0];
  if (!file) {
    throw new Error(`${label}: esbuild produced no output for ${entry}.`);
  }

  const code = file.text;

  if (Buffer.byteLength(code) > MAX_ENTRY_BUNDLE_BYTES) {
    throw new Error(
      `${label} compiled to ${Math.round(Buffer.byteLength(code) / 1024)}KB, over the ` +
        `${Math.round(MAX_ENTRY_BUNDLE_BYTES / 1024)}KB ceiling. The usual cause is a VALUE import ` +
        `of epubjs, jszip or pdfjs-dist: those arrive on window from their own inlined script tags, ` +
        `so importing one bundles a second copy. Use \`import type\` for their types.`,
    );
  }

  // The entry is entirely first-party, so this is the strongest place to apply the offline check —
  // stronger than scanning the old .html sources, because it also covers everything the entry
  // imports.
  assertNoNetworkReferences(code, label);

  return code;
}

function read(file: string, what: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${what}: ${file}\nRun \`npm install\` — epubjs, jszip and pdfjs-dist are devDependencies.`,
    );
  }
  return fs.readFileSync(file, 'utf8');
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap a library's source in a <script> tag.
 *
 * `</script>` appearing inside a JS string literal would terminate the tag early
 * and corrupt the page — the classic inline-script escaping bug. No inlined lib
 * contains one today (asserted in assertSourceIsInlinable), but the escape is
 * applied anyway so a future version bump cannot silently produce a broken HTML
 * file that only fails at runtime on a device.
 */
function scriptTag(source: string, label: string): string {
  const escaped = source.replace(/<\/script/gi, '<\\/script');
  return `<script data-lib="${label}">\n${escaped}\n</script>`;
}

/**
 * Re-indent a raw source to its marker's depth.
 *
 * The first line is left alone: it inherits the whitespace already sitting in front
 * of the marker. Blank lines are left empty rather than padded, so this cannot
 * introduce trailing whitespace.
 *
 * Cosmetic only — nothing parses these files by column any more. It used to matter: the drift guard
 * in readerBridge.test.ts located `window.TFReader` with a regex anchored to an exact indent, which
 * is also why both templates sit in .prettierignore. The typechecked-WebView conversion deleted that
 * guard in favour of a type, so this is now purely about a generated file a human can diff.
 *
 * Still used for the one remaining raw injection, the pdf.js worker.
 */
function reindent(source: string, indent: string): string {
  if (!indent) return source;
  return source
    .split('\n')
    .map((line, i) => (i === 0 || line.length === 0 ? line : indent + line))
    .join('\n');
}

/**
 * A `raw` source is spliced into a JS body or an inert text block, and in NEITHER
 * case can the `</script` escape be applied safely: `<\/script` is only valid JS
 * inside a string or regex literal, so escaping a raw source could corrupt it
 * instead of saving it. So raw sources are asserted clean and the build fails loudly
 * if that ever stops being true — a human then decides, rather than shipping HTML
 * that only breaks on a device.
 *
 * Only the pdf.js worker is injected raw now — the shared bridge became a real module the entries
 * import. Verified: zero occurrences in pdf.worker.min.js.
 */
function assertSourceIsInlinable(source: string, label: string, wrap: Wrap): void {
  if (wrap === 'raw' && /<\/script/i.test(source)) {
    throw new Error(
      `${label} contains a literal "</script", which cannot be escaped in a raw ` +
        `injection without corrupting it. Wrap it in its own <script> tag instead, ` +
        `or escape it at the source.`,
    );
  }
}

/**
 * Nothing first-party may reference the network. The entire point of these files is
 * that they are self-contained and offline — a CDN <script src>, a fetch() to a
 * remote host, or a workerSrc pointed at a URL would defeat the requirement
 * silently.
 *
 * Checked against SOURCES (templates + the bridge fragment) rather than the built
 * output, which is what makes it stronger than the `src="http` check it replaces:
 * scanning sources covers every line of first-party code, including the IIFE, while
 * never touching minified lib bodies — those contain harmless "http" substrings
 * (licence URLs, XML namespaces) and would false-positive.
 *
 * This is also the structural answer to the dead PDFJS_LIB_URL / PDFJS_WORKER_URL /
 * pdfjsFontUrl constants in src/features/sync/syncConfig.ts: wiring any of them into
 * the reader is now a failed build, not something review has to catch.
 */
function assertNoNetworkReferences(source: string, label: string): void {
  const match = source.match(/https?:\/\/[^\s"'<)]*/i);
  if (match) {
    throw new Error(
      `${label} references ${match[0]}. The reader must be fully offline and ` +
        `self-contained: no CDN scripts, no fetch(), no remote workerSrc or font URL. ` +
        `pdf.js assets are inlined at build time — see syncConfig.ts's dead PDFJS_* ` +
        `constants, which is what this check exists to stop anyone reaching for.`,
    );
  }
}

function buildArtifact(artifact: Artifact): void {
  const template = read(artifact.template, `${artifact.name} template`);

  assertNoNetworkReferences(template, path.basename(artifact.template));

  // Load order, checked on the SOURCE. For the EPUB artifact this is the JSZip
  // rule: epub.js reads window.JSZip at definition time, so with the order
  // swapped `ePub` is defined with JSZip undefined and every archived (i.e. every
  // real) EPUB fails deep inside the unzip. For PDF it is the worker: the
  // text/plain block is read by wireWorker(), which runs after pdf.js is defined.
  for (let i = 1; i < artifact.order.length; i++) {
    const before = template.indexOf(artifact.order[i - 1]);
    const after = template.indexOf(artifact.order[i]);
    if (before === -1 || after === -1) {
      throw new Error(
        `${artifact.name}: expected both ${artifact.order[i - 1]} and ${artifact.order[i]} ` +
          `in ${path.basename(artifact.template)}.`,
      );
    }
    if (before > after) {
      throw new Error(
        `${artifact.name}: ${artifact.order[i - 1]} must come BEFORE ${artifact.order[i]} ` +
          `in ${path.basename(artifact.template)}. Fix the marker order in the template.`,
      );
    }
  }

  let html = template;

  const emitted = new Map<string, number>();

  for (const { marker, source, label, wrap, bundle } of artifact.injections) {
    const at = html.match(new RegExp(`^([ \\t]*)${escapeForRegExp(marker)}`, 'm'));
    if (!at) {
      throw new Error(
        `${artifact.name} template is missing the ${marker} marker. buildReaderHtml.ts ` +
          `and ${path.basename(artifact.template)} must agree on marker names.`,
      );
    }

    const code = bundle
      ? bundleEntry(source, label)
      : read(source, `${label} source`).replace(/\n+$/, '');
    assertSourceIsInlinable(code, label, wrap);
    emitted.set(label, Buffer.byteLength(code));

    const replacement =
      wrap === 'script' ? scriptTag(code, label) : reindent(code, at[1] ?? '');

    // The replacement MUST go through a function, not a string. With a string
    // replacement, `$&`, `$'`, "$`" and `$n` are substitution patterns — and
    // epub.min.js genuinely contains a `$&`, which expanded to the matched
    // marker text and spliced `<!-- @inject:epubjs -->` into the middle of the
    // library while also re-introducing the marker into the output. That
    // corrupts the library in a way that only shows up as a broken WebView on a
    // device. A replacer function is treated as a literal and disables all of
    // it. (Caught by assertBuild's leftover-marker check on the first run —
    // keep that check.)
    html = html.replace(marker, () => replacement);
  }

  assertBuild(html, artifact);

  fs.mkdirSync(path.dirname(artifact.output), { recursive: true });
  fs.writeFileSync(artifact.output, html, 'utf8');

  const kb = (n: number): string => `${Math.round(n / 1024)}KB`;
  console.log(
    `Wrote ${path.relative(REPO_ROOT, artifact.output)} (${kb(Buffer.byteLength(html))})`,
  );
  for (const { label, bundle } of artifact.injections) {
    // The emitted size, not the source's. For a bundled entry those differ by every module it pulls
    // in, and the emitted number is the one the ceiling is about.
    console.log(`  ${label.padEnd(14)} ${kb(emitted.get(label) ?? 0)}${bundle ? ' (compiled)' : ''}`);
  }
}

/**
 * Every <script> body in the output, in document order.
 *
 * Walks the file rather than running one regex over it, because HTML comments have
 * to be skipped explicitly: both templates legitimately discuss `<script
 * src="./epub.min.js">` in their header prose, and a naive regex reads that as a
 * real tag. Stripping comments globally first is not safe either — a minified lib
 * body may contain a `<!--` inside a string, and eating from there to the next
 * `-->` would silently truncate the library.
 */
function scriptBodies(html: string): { attrs: string; body: string }[] {
  const found: { attrs: string; body: string }[] = [];
  const open = /^<script([^>]*)>/i;

  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    const match = html.slice(i, i + 200).match(open);
    if (match) {
      const bodyAt = i + match[0].length;
      const close = html.indexOf('</script>', bodyAt);
      const end = close === -1 ? html.length : close;
      found.push({ attrs: match[1] ?? '', body: html.slice(bodyAt, end) });
      i = end + '</script>'.length;
      continue;
    }

    i++;
  }

  return found;
}

/**
 * PARSE EVERY SCRIPT THIS FILE EMITS. The most valuable check here, because it is
 * the only one that covers the assembled result rather than its ingredients.
 *
 * It exists because of a real bug on the first two-artifact build: reader.bridge.html
 * described its own comment syntax and, in doing so, wrote a block-comment terminator
 * inside its header. That closed the comment early, the following prose parsed as
 * code, and BOTH artifacts shipped a syntactically broken IIFE — which presents on
 * device as a WebView that never posts `ready`, i.e. a blank page and a
 * READY_TIMEOUT ten seconds later. Nothing else in this script could see it: every
 * marker was substituted, every fingerprint was present, every size was plausible.
 *
 * Covers the injected libs too, which is how a corrupted `</script` escape would
 * surface. The text/plain worker is included deliberately: the browser does not
 * execute it, but wireWorker() turns it into a Worker, so it must still be valid JS.
 *
 * Compile only — nothing is executed, so browser globals in these bodies are fine.
 */
function assertScriptsParse(html: string, artifact: Artifact): void {
  const blocks = scriptBodies(html);
  if (blocks.length === 0) {
    throw new Error(`${artifact.name}: no <script> blocks found in output.`);
  }

  for (const { attrs, body } of blocks) {
    const lib = /data-lib="([^"]+)"/.exec(attrs)?.[1];
    const label = lib ?? (/text\/plain/i.test(attrs) ? 'pdf.js worker (text/plain)' : 'inline IIFE');

    try {
      new vm.Script(body, { filename: `${artifact.output} [${label}]` });
    } catch (error) {
      throw new Error(
        `${artifact.name}: the "${label}" script in the output does not parse: ` +
          `${error instanceof Error ? error.message : String(error)}\n` +
          `An inlined source corrupted it. For a compiled entry this should be unreachable — ` +
          `esbuild emits valid JS or fails — so suspect the </script escape or the template.`,
      );
    }
  }
}

function assertBuild(html: string, artifact: Artifact): void {
  // 1. No marker survived — a typo'd marker would otherwise ship an HTML file
  //    with a library silently missing.
  const leftover = html.match(/<!-- @inject:[a-z.]+ -->/i);
  if (leftover) {
    throw new Error(`${artifact.name}: un-substituted marker left in output: ${leftover[0]}`);
  }

  // 2. The libs are actually present, not just their tags. These strings come
  //    from each dist's own UMD header.
  for (const { needle, hint } of artifact.fingerprints) {
    if (!html.includes(needle)) {
      throw new Error(`${artifact.name}: "${needle}" not found in output. ${hint}`);
    }
  }

  // 3. The compiled entry landed, checked by behaviour rather than by marker — twice, because the
  //    two failures look identical from outside (a blank page and a READY_TIMEOUT) and have
  //    different causes. No postMessage means the bridge half is missing, so every message this
  //    document would ever send is gone. No window.TFReader means the API half is missing, so every
  //    command answers NOT_READY.
  if (!html.includes('window.ReactNativeWebView.postMessage')) {
    throw new Error(
      `${artifact.name}: no postMessage call in the output — the compiled entry did not inline. ` +
        `Check the @inject:entry marker.`,
    );
  }
  if (!html.includes('window.TFReader')) {
    throw new Error(
      `${artifact.name}: no window.TFReader assignment in the output. The entry compiled but never ` +
        `published its API — suspect esbuild tree-shaking a side-effect-only entry.`,
    );
  }

  // 4. Everything this file emits actually parses. See the function's own comment
  //    for the bug that put it here.
  assertScriptsParse(html, artifact);

  // 5. No remote sub-resource in the OUTPUT. assertNoNetworkReferences already
  //    scanned every first-party source more thoroughly than this can; this is the
  //    backstop for a lib dist that ships a CDN <script src>, which no source-level
  //    check would see.
  if (/<script[^>]+src\s*=\s*["']https?:/i.test(html)) {
    throw new Error(`${artifact.name}: output references a remote script.`);
  }
}

function main(): void {
  for (const artifact of ARTIFACTS) {
    buildArtifact(artifact);
  }
}

main();
