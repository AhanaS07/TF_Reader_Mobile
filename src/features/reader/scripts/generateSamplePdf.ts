// Owner: Reader (Ahana).
//
// Generates assets/reader/sample-plaintext.pdf — a tiny, multi-page PDF so the PDF
// renderer can actually be exercised on a device.
//
// Run: npm run reader:build-sample-pdf
//
// WHY THIS EXISTS: there is no .pdf anywhere in this repo, and there must never be a
// real one — T&F content is licensed and must not be committed. Without a generated
// stand-in, the entire PDF branch (reader-pdf.html, pdf.js, the worker, openPdf) is
// unreachable outside unit tests, so "does a PDF render" could only be answered by
// pushing an untracked file into the simulator container by hand. Same reasoning as
// generateSampleEpub.ts, and it is TEMPORARY for the same reason: it goes away with
// devContentSeed.ts (see CLAUDE.md's scaffolding table).
//
// WHY IT IS HAND-WRITTEN AND NOT BUILT WITH A LIBRARY: a valid PDF that draws text on
// three pages is a few hundred bytes of objects and an xref table. Adding a PDF
// WRITER as a dependency to produce it would be more moving parts than the format it
// is emitting, and every writer worth using stamps a CreationDate — see below.
//
// >>> BYTE-REPRODUCIBLE ON PURPOSE. DO NOT ADD A DATE. <<<
// Nothing here varies between runs: no /CreationDate, no /ModDate, no /ID, no
// timestamps of any kind. That is what lets CI regenerate this file and `git diff
// --exit-code` it, exactly like reader.html — and it is precisely what
// generateSampleEpub.ts CANNOT do, because JSZip stamps every entry with the
// generation time. If you add anything time-varying here, the CI freshness check for
// this file starts failing on every run and the honest fix is to remove it from CI,
// not to loosen the check.
//
// This script uses Node globals. Legitimate here for the same reason as its siblings:
// it runs under Node, never on device.

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUTPUT = path.join(REPO_ROOT, 'assets', 'reader', 'sample-plaintext.pdf');

/** US Letter, in PDF points (72 per inch). */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const PAGE_COUNT = 3;

/**
 * What each page says.
 *
 * Distinct per page, and deliberately so: identical pages make a paging bug
 * invisible. "Page 2 of 3" on screen after one tap of Next is the whole manual test.
 *
 * PDF string literals are wrapped in parentheses, so `(`, `)` and `\` would need
 * escaping. Nothing here uses them — keep it that way rather than adding an escaper
 * for a fixture.
 */
function pageText(pageNumber: number): string[] {
  return [
    `TF Reader sample PDF - page ${pageNumber} of ${PAGE_COUNT}`,
    '',
    'This file is GENERATED. Do not hand-edit it, and do not replace it',
    'with real content: it stands in for a licensed book so the pdf.js',
    'path can be exercised offline.',
    '',
    `Use Next and Previous to page through all ${PAGE_COUNT} pages.`,
  ];
}

/**
 * A page's content stream: a text block, plus a coloured bar.
 *
 * The bar earns its place — it is drawn with graphics operators rather than a font, so
 * a page that shows the bar but no text tells you the FONT resource is wrong rather
 * than that rendering failed altogether. That distinction is otherwise a guess.
 */
function contentStream(pageNumber: number): string {
  const lines = pageText(pageNumber);
  const startY = PAGE_HEIGHT - 96;

  const text = lines
    .map((line, i) => (line === '' ? '' : `1 0 0 1 72 ${startY - i * 22} Tm (${line}) Tj`))
    .filter((op) => op !== '')
    .join('\n');

  return [
    // A bar whose width tracks the page number, so "did the page change" is legible
    // at a glance and even without text.
    `0.83 0.18 0.18 rg`,
    `72 ${PAGE_HEIGHT - 160} ${120 * pageNumber} 18 re f`,
    `0 g`,
    `BT`,
    `/F1 13 Tf`,
    text,
    `ET`,
  ].join('\n');
}

/** `1 0 obj ... endobj`, as bytes, with the trailing newline PDF readers expect. */
function indirectObject(id: number, body: string): string {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function buildPdf(): Buffer {
  // Object numbering, fixed up front so /Parent and /Contents references resolve:
  //   1        Catalog
  //   2        Pages
  //   3        Font (Helvetica, one of the base-14 — see the note below)
  //   4, 6, 8  Page objects
  //   5, 7, 9  the matching content streams
  const CATALOG = 1;
  const PAGES = 2;
  const FONT = 3;
  const pageObjectId = (i: number): number => 4 + i * 2;
  const contentObjectId = (i: number): number => 5 + i * 2;

  const objects: string[] = [];

  objects[CATALOG] = indirectObject(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);

  const kids = Array.from({ length: PAGE_COUNT }, (_, i) => `${pageObjectId(i)} 0 R`).join(' ');
  objects[PAGES] = indirectObject(
    PAGES,
    `<< /Type /Pages /Kids [${kids}] /Count ${PAGE_COUNT} >>`,
  );

  // HELVETICA, deliberately: it is one of the PDF base-14 fonts, so it carries no
  // embedded font programme. That makes this fixture the exact case the reader's
  // `useSystemFonts: true` handles — reader-pdf.template.html ships no
  // standardFontDataUrl, because that would be a sub-resource fetch. So if this
  // fixture renders text on a device, the substitution path works; embedding a font
  // here would hide the one font risk worth testing.
  objects[FONT] = indirectObject(
    FONT,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  );

  for (let i = 0; i < PAGE_COUNT; i++) {
    const stream = contentStream(i + 1);
    objects[pageObjectId(i)] = indirectObject(
      pageObjectId(i),
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentObjectId(i)} 0 R >>`,
    );

    // /Length must be the stream's BYTE length, not its character count. They differ
    // the moment anything non-ASCII appears, and a wrong /Length is the classic
    // "renders in one viewer, blank in another" corruption.
    objects[contentObjectId(i)] = indirectObject(
      contentObjectId(i),
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }

  // Assemble, recording each object's byte offset for the xref table. The header's
  // second line is a comment with high-bit bytes, which is what marks the file as
  // binary for transfer tools that would otherwise mangle line endings.
  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (text: string): void => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    offset += buffer.length;
  };

  push('%PDF-1.4\n');
  push('%\xE2\xE3\xCF\xD3\n');

  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = offset;
    push(objects[id]);
  }

  const xrefAt = offset;
  const size = objects.length; // ids 1..n plus the mandatory free entry 0

  // EVERY xref entry IS EXACTLY 20 BYTES. Ten-digit offset, space, five-digit
  // generation, space, type letter, then a two-byte terminator — here a space and a
  // newline. Readers seek by multiplying the index by 20, so a single missing pad
  // byte silently shifts every later lookup.
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);

  // No /ID and no /Info: both are optional, and both are where writers put
  // time-varying or random data. See the reproducibility note at the top.
  push(`trailer\n<< /Size ${size} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

/**
 * Structural self-checks. This script is a test of its own output, in the same spirit
 * as generateSampleEpub.ts round-tripping its zip — a malformed fixture otherwise
 * shows up as a blank WebView on a device, which is a far worse place to debug it.
 */
function assertStructure(pdf: Buffer): void {
  const text = pdf.toString('latin1');

  if (!text.startsWith('%PDF-')) {
    throw new Error('Output does not begin with the %PDF- header.');
  }
  if (!text.trimEnd().endsWith('%%EOF')) {
    throw new Error('Output does not end with %%EOF.');
  }

  // The magic bytes the reader's own routing relies on being distinguishable from a
  // ZIP's "PK\x03\x04" — an EPUB and a PDF must never be confusable by inspection.
  if (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46) {
    throw new Error('Output does not start with the %PDF magic bytes.');
  }

  const declaredCount = /\/Count (\d+)/.exec(text);
  if (!declaredCount || Number(declaredCount[1]) !== PAGE_COUNT) {
    throw new Error(`Expected /Count ${PAGE_COUNT} in the page tree.`);
  }

  // startxref must point AT the xref keyword. Off-by-one here is the single most
  // common hand-written-PDF bug and most viewers hide it by rebuilding the table.
  const startxref = /startxref\n(\d+)\n/.exec(text);
  if (!startxref) throw new Error('No startxref in output.');
  if (!text.startsWith('xref', Number(startxref[1]))) {
    throw new Error(
      `startxref points at byte ${startxref[1]}, which is not the xref table. ` +
        `The offsets were computed wrong.`,
    );
  }

  if (/\/CreationDate|\/ModDate|\/ID\s*\[/.test(text)) {
    throw new Error(
      'Output contains a date or file ID, so it is no longer byte-reproducible. ' +
        'See the reproducibility note at the top of this script.',
    );
  }
}

/**
 * Parse the result with the SAME pdf.js the reader inlines.
 *
 * Structural checks above prove the bytes are shaped like a PDF; this proves the
 * renderer accepts them. It is the closest thing to the device path available in
 * Node, and it uses the pinned devDependency rather than a second implementation, so
 * a pdfjs-dist bump that stops accepting this fixture fails HERE rather than as a
 * blank page on a simulator.
 *
 * EXPECTED NOISE: pdf.js prints two warnings under Node about being unable to polyfill
 * `DOMMatrix` and `Path2D` because the optional `canvas` package is absent. They are
 * harmless and must NOT be "fixed" by installing `canvas` — a native dependency added
 * to build a 2KB fixture. Both are needed only to RASTERISE, and nothing here
 * rasterises: this parses and extracts text. Rasterising happens on the device, where
 * a real canvas exists.
 */
async function assertPdfJsCanReadIt(pdf: Buffer): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports -- pdfjs-dist v3's
     legacy build ships CommonJS whose types do not resolve under
     moduleResolution:bundler, and this is a Node-only build script. */
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

  const doc = await pdfjs.getDocument({
    // A COPY, because pdf.js transfers the buffer it is given to its worker and
    // detaches it — passing `pdf` itself would leave the caller holding an empty
    // Buffer and the write below would emit nothing.
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;

  if (doc.numPages !== PAGE_COUNT) {
    throw new Error(`pdf.js read ${doc.numPages} pages, expected ${PAGE_COUNT}.`);
  }

  // Text extraction, not just page count: it proves the font resource and the content
  // stream agree, which /Count cannot.
  for (let n = 1; n <= PAGE_COUNT; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const text = content.items.map((item: { str?: string }) => item.str ?? '').join('');
    if (!text.includes(`page ${n} of ${PAGE_COUNT}`)) {
      throw new Error(`Page ${n} did not render its own page number. Extracted: ${text}`);
    }
  }

  await doc.destroy();
}

async function main(): Promise<void> {
  const pdf = buildPdf();

  assertStructure(pdf);
  await assertPdfJsCanReadIt(pdf);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, pdf);

  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUTPUT)} ` +
      `(${pdf.length} bytes, ${PAGE_COUNT} pages, parsed by pdf.js)`,
  );
}

void main();
