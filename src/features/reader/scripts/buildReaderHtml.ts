// Owner: Reader (Ahana).
//
// Builds the ONE self-contained HTML file the reader WebView loads:
//
//   src/features/reader/webview/reader.template.html   (source, edit this)
//   + node_modules/jszip/dist/jszip.min.js             (inlined)
//   + node_modules/epubjs/dist/epub.min.js             (inlined)
//   = assets/reader/reader.html                        (generated, committed)
//
// Run: npm run reader:build-html
// (which is `npx tsx src/features/reader/scripts/buildReaderHtml.ts` — tsx, not
// ts-node, matching the encryption scripts' precedent. tsx is not a devDep; npx
// fetches it on demand, same as Abhinav's generateSampleBook.ts.)
//
// WHY INLINE INSTEAD OF SHIPPING THREE FILES: Metro classifies `.js` as a SOURCE
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
// This script uses Node globals (fs/path/__dirname). That is legitimate here for
// the same reason it is in src/features/encryption/scripts/ — it runs under
// Node, never on device — and is why tsconfig carries "node" in `types`.
// NOTHING under src/features/reader/ OUTSIDE this scripts/ folder may import
// Node built-ins; the rest of the feature is React Native code.

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const TEMPLATE = path.join(
  REPO_ROOT,
  'src',
  'features',
  'reader',
  'webview',
  'reader.template.html',
);
const JSZIP = path.join(REPO_ROOT, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
const EPUBJS = path.join(REPO_ROOT, 'node_modules', 'epubjs', 'dist', 'epub.min.js');
const OUTPUT = path.join(REPO_ROOT, 'assets', 'reader', 'reader.html');

// Markers in the template. Order in the OUTPUT is set by their order in the
// template (JSZip first) — this map is only "which text gets replaced by what".
const INJECTIONS: readonly { marker: string; source: string; label: string }[] = [
  { marker: '<!-- @inject:jszip -->', source: JSZIP, label: 'JSZip' },
  { marker: '<!-- @inject:epubjs -->', source: EPUBJS, label: 'epub.js' },
];

function read(file: string, what: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${what}: ${file}\nRun \`npm install\` — epubjs and jszip are devDependencies.`,
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Wrap a library's source in a <script> tag.
 *
 * `</script>` appearing inside a JS string literal would terminate the tag early
 * and corrupt the page — the classic inline-script escaping bug. Neither minified
 * lib contains one today (asserted below rather than assumed), but the escape is
 * applied anyway so a future version bump cannot silently produce a broken HTML
 * file that only fails at runtime on a device.
 */
function scriptTag(source: string, label: string): string {
  const escaped = source.replace(/<\/script/gi, '<\\/script');
  return `<script data-lib="${label}">\n${escaped}\n</script>`;
}

function main(): void {
  const template = read(TEMPLATE, 'reader template');

  let html = template;

  for (const { marker, source, label } of INJECTIONS) {
    if (!html.includes(marker)) {
      throw new Error(
        `Template is missing the ${marker} marker. buildReaderHtml.ts and ` +
          `reader.template.html must agree on marker names.`,
      );
    }
    const code = read(source, `${label} dist`);

    // The replacement MUST go through a function, not a string. With a string
    // replacement, `$&`, `$'`, "$`" and `$n` are substitution patterns — and
    // epub.min.js genuinely contains a `$&`, which expanded to the matched
    // marker text and spliced `<!-- @inject:epubjs -->` into the middle of the
    // library while also re-introducing the marker into the output. That
    // corrupts epub.js in a way that only shows up as a broken WebView on a
    // device. A replacer function is treated as a literal and disables all of
    // it. (Caught by assertBuild's leftover-marker check on the first run —
    // keep that check.)
    html = html.replace(marker, () => scriptTag(code, label));
  }

  // Structural self-checks before writing — this script is a test of its own
  // output, in the same spirit as generateSampleBook.ts round-tripping its
  // ciphertext. A broken reader.html otherwise only shows up as a blank WebView
  // on a device, which is a much worse place to debug it.
  assertBuild(html);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html, 'utf8');

  const kb = (n: number): string => `${Math.round(n / 1024)}KB`;
  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT)} (${kb(Buffer.byteLength(html))})`);
  console.log(`  JSZip   ${kb(fs.statSync(JSZIP).size)}`);
  console.log(`  epub.js ${kb(fs.statSync(EPUBJS).size)}`);
}

function assertBuild(html: string): void {
  // 1. No marker survived — a typo'd marker would otherwise ship an HTML file
  //    with a library silently missing.
  const leftover = html.match(/<!-- @inject:[a-z.]+ -->/i);
  if (leftover) {
    throw new Error(`Un-substituted marker left in output: ${leftover[0]}`);
  }

  // 2. Load order: JSZip must be defined before epub.js reads window.JSZip.
  const jszipAt = html.indexOf('data-lib="JSZip"');
  const epubAt = html.indexOf('data-lib="epub.js"');
  if (jszipAt === -1 || epubAt === -1) {
    throw new Error('Expected both library <script> tags in the output.');
  }
  if (jszipAt > epubAt) {
    throw new Error(
      'JSZip is inlined AFTER epub.js. epub.js reads window.JSZip at definition ' +
        'time, so this would define ePub with JSZip undefined and break every ' +
        'archived EPUB. Fix the marker order in reader.template.html.',
    );
  }

  // 3. The libs are actually present, not just their tags. These strings come
  //    from each dist's own UMD header.
  if (!html.includes('JSZip v3')) {
    throw new Error('JSZip banner not found in output — inline produced nothing.');
  }
  if (!html.includes('t.ePub=e(t.JSZip)')) {
    throw new Error(
      'epub.js UMD footer not found in output. If epubjs was upgraded and no ' +
        'longer takes JSZip as an external, re-verify whether jszip is still ' +
        'needed at all before changing this assertion.',
    );
  }

  // 4. Nothing may reference the network. The entire point of this file is that
  //    it is self-contained and offline — a CDN <script src> or a fetch() to a
  //    remote host slipping in would defeat the requirement silently. Checked
  //    against the template's own markup only; minified lib bodies contain
  //    harmless "http" substrings (licence URLs, XML namespaces) and are not
  //    scanned.
  const templateMarkup = html.slice(0, jszipAt) + html.slice(html.lastIndexOf('</script>'));
  if (/src\s*=\s*["']https?:/i.test(templateMarkup)) {
    throw new Error('Output references a remote script. The reader must be fully offline.');
  }
}

main();
