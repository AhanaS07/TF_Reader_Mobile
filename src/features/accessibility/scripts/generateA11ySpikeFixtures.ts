// Owner: Accessibility (Hruthik).
//
// Generates the two synthetic EPUBs WEBVIEW_A11Y_SPIKE.md's §2 needs - "Sample A, well-formed" and
// "Sample B, poor quality" - into samples/fixtures/ (gitignored scratch fixtures, same directory the
// large perf fixtures already live in). NOT assets/reader/: these exist only to drive one on-device
// screen-reader spike, not as part of the app's shipped/bundled fixture set.
//
// Run: npm run a11y:build-spike-fixtures
//
// Reuses generateSampleEpub.ts's JSZip/OCF packaging pattern (mimetype first and STORED, EPUB3 nav +
// EPUB2 NCX, a self-check that reopens the archive) rather than reinventing it - see that file for why
// each OCF requirement matters. Both books are the same length/shape on purpose, so heading-nav,
// pagination, link, and image behaviour are comparable side by side; what differs is ONLY whether the
// semantic markup a screen reader depends on (h1/h2, p, a href, alt) is actually present. Sample B's
// breakage is deliberately in chapter *content* only - the OPF/spine/nav stay valid so it still opens,
// per WEBVIEW_A11Y_FINDINGS.md's framing of it as "what happens when the book fights back," not as an
// unopenable file.
//
// Node globals (fs/path/__dirname) are legitimate here for the same reason as in
// generateSampleEpub.ts and buildReaderHtml.ts - this runs under Node, never on device.

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'samples', 'fixtures');

// A 1x1 transparent PNG. Content is irrelevant to this spike - only whether `alt` is present,
// descriptive, empty (decorative), or missing/junk is under test, never what the image shows.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

interface ChapterSpec {
  id: string;
  file: string;
  navTitle: string;
  xhtml: string;
}

interface ImageSpec {
  name: string;
  bytes: Buffer;
  mediaType: string;
}

interface BookSpec {
  bookId: string;
  title: string;
  outFile: string;
  chapters: ChapterSpec[];
  images: ImageSpec[];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Same "spill over several screens" trick as generateSampleEpub.ts's body() - otherwise "next"
// jumps straight to the next chapter and pagination/page-change announcement prove nothing.
function fillerLines(topic: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `${topic} — paragraph ${i + 1}. This filler exists so the chapter is longer than one screen, ` +
      `which is what makes paginated flow and page-change announcement observable. The words carry ` +
      `no meaning and no licence.`,
  );
}

const CHAPTER_TOPICS = ['Opening the Book', 'Turning the Page', 'Finding a Chapter'];

// ------------------------------------------------------------------ Sample A: well-formed

function wellFormedChapterXhtml(index: number): string {
  const title = `Chapter ${index + 1}: ${CHAPTER_TOPICS[index]}`;
  const body = fillerLines(CHAPTER_TOPICS[index], 10)
    .map((p) => `    <p>${escapeXml(p)}</p>`)
    .join('\n');

  // Chapter 1 carries the real cross-reference and the meaningful image, so heading-nav, link, and
  // image checks all land on the first sample instead of requiring three chapter-changes just to
  // reach them. Chapter 2 carries the decorative image, matching the spike's own "decorative images
  // ignored" row.
  const extras: string[] = [];
  if (index === 0) {
    extras.push(
      '    <h2>A Subsection</h2>',
      '    <p>This subsection exists so heading navigation has more than one level to jump between.</p>',
      `    <p>See <a href="ch2.xhtml">Chapter Two: ${escapeXml(CHAPTER_TOPICS[1])}</a> for what happens ` +
        'next - a real, internal cross-reference, not styled text standing in for one.</p>',
      '    <img src="diagram.png" alt="A simple two-box flow diagram showing the reader moving from Chapter One to Chapter Two" />',
    );
  }
  if (index === 1) {
    extras.push('    <img src="rule.png" alt="" />');
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <h1>${escapeXml(title)}</h1>
${body}
${extras.join('\n')}
  </body>
</html>
`;
}

// ------------------------------------------------------------------ Sample B: poor quality

function poorChapterXhtml(index: number): string {
  const title = `Chapter ${index + 1}: ${CHAPTER_TOPICS[index]}`;
  // Real-world "bad EPUB" pattern: prose as one div of <br/>-separated lines instead of real <p>
  // elements - still visually paragraph-shaped, semantically nothing.
  const body = fillerLines(CHAPTER_TOPICS[index], 10).map(escapeXml).join('<br/>\n    ');

  const extras: string[] = [];
  if (index === 0) {
    extras.push(
      '    <div class="heading-style">A Subsection</div>',
      '    <div>This subsection exists so heading navigation has more than one level to jump between.</div>',
      `    <div>See <span class="fake-link">Chapter Two: ${escapeXml(CHAPTER_TOPICS[1])}</span> for what ` +
        'happens next - styled to look like a link, with no href and no interactive semantics at all.</div>',
      '    <img src="diagram.png" alt="IMG_00231.jpg" />',
    );
  }
  if (index === 1) {
    // No alt attribute at all - arguably worse than alt="" for a meaningful image, since some
    // screen readers fall back to announcing the filename instead of staying silent.
    extras.push('    <img src="rule.png" />');
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <div class="heading-style">${escapeXml(title)}</div>
    <div>
    ${body}
    </div>
${extras.join('\n')}
  </body>
</html>
`;
}

function buildChapters(xhtmlFor: (index: number) => string): ChapterSpec[] {
  return CHAPTER_TOPICS.map((topic, index) => ({
    id: `ch${index + 1}`,
    file: `ch${index + 1}.xhtml`,
    navTitle: `Chapter ${index + 1}: ${topic}`,
    xhtml: xhtmlFor(index),
  }));
}

const IMAGES: ImageSpec[] = [
  { name: 'diagram.png', bytes: PNG_BYTES, mediaType: 'image/png' },
  { name: 'rule.png', bytes: PNG_BYTES, mediaType: 'image/png' },
];

const SAMPLE_A: BookSpec = {
  bookId: 'urn:uuid:tf-a11y-spike-sample-a-wellformed',
  title: 'A11y Spike Sample A — Well-Formed',
  outFile: path.join(FIXTURES_DIR, 'a11y-spike-sample-a-wellformed.epub'),
  chapters: buildChapters(wellFormedChapterXhtml),
  images: IMAGES,
};

const SAMPLE_B: BookSpec = {
  bookId: 'urn:uuid:tf-a11y-spike-sample-b-poor',
  title: 'A11y Spike Sample B — Poor Quality',
  outFile: path.join(FIXTURES_DIR, 'a11y-spike-sample-b-poor.epub'),
  chapters: buildChapters(poorChapterXhtml),
  images: IMAGES,
};

// ------------------------------------------------------------------ OCF packaging (shared)

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function contentOpf(book: BookSpec): string {
  const chapterItems = book.chapters
    .map((c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const imageItems = book.images
    .map((img, i) => `    <item id="img${i}" href="${img.name}" media-type="${img.mediaType}"/>`)
    .join('\n');
  const spine = book.chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n');

  // Ships both nav forms, same reasoning as generateSampleEpub.ts: whichever one epub.js reads,
  // this removes "which form does it use" as a variable in the spike's results.
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${book.bookId}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>TF Reader a11y spike fixture generator</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${chapterItems}
${imageItems}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;
}

function navXhtml(book: BookSpec): string {
  const items = book.chapters
    .map((c) => `        <li><a href="${c.file}">${escapeXml(c.navTitle)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function tocNcx(book: BookSpec): string {
  const points = book.chapters
    .map(
      (c, i) => `    <navPoint id="np-${c.id}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.navTitle)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${book.bookId}"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/**
 * Re-opens what was just built and checks it structurally, same generator-is-its-own-test spirit as
 * generateSampleEpub.ts's assertReadableEpub. A malformed EPUB would otherwise present on device as
 * an OPEN_FAILED with a message from deep inside epub.js, days into the spike session.
 */
async function assertReadableEpub(bytes: Buffer, book: BookSpec): Promise<void> {
  if (bytes.subarray(0, 2).toString('binary') !== 'PK') {
    throw new Error(`${book.outFile}: output is not a zip archive.`);
  }
  // "mimetype" must sit at byte 30 - immediately after the first entry's 30-byte local file header -
  // and be stored uncompressed. This is what actually proves the OCF requirement, not just trusting
  // JSZip's options.
  if (bytes.subarray(30, 38).toString('binary') !== 'mimetype') {
    throw new Error(`${book.outFile}: \`mimetype\` is not the first archive entry - OCF violation.`);
  }
  if (bytes.subarray(38, 58).toString('binary') !== 'application/epub+zip') {
    throw new Error(`${book.outFile}: \`mimetype\` is not stored uncompressed - OCF violation.`);
  }

  const reopened = await JSZip.loadAsync(bytes);
  const required = [
    'META-INF/container.xml',
    'OEBPS/content.opf',
    'OEBPS/nav.xhtml',
    'OEBPS/toc.ncx',
    ...book.chapters.map((c) => `OEBPS/${c.file}`),
    ...book.images.map((img) => `OEBPS/${img.name}`),
  ];
  for (const entry of required) {
    if (!reopened.file(entry)) {
      throw new Error(`${book.outFile}: missing required entry: ${entry}`);
    }
  }

  const opf = await reopened.file('OEBPS/content.opf')?.async('string');
  if (!opf?.includes('properties="nav"')) {
    throw new Error(`${book.outFile}: OPF manifest is missing the EPUB3 nav document.`);
  }
}

async function buildBook(book: BookSpec): Promise<void> {
  const zip = new JSZip();

  // ORDER AND COMPRESSION ARE PART OF THE SPEC, not stylistic - see assertReadableEpub. JSZip
  // preserves insertion order, so adding mimetype first is what satisfies the OCF requirement.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml());
  zip.file('OEBPS/content.opf', contentOpf(book));
  zip.file('OEBPS/nav.xhtml', navXhtml(book));
  zip.file('OEBPS/toc.ncx', tocNcx(book));
  for (const chapter of book.chapters) {
    zip.file(`OEBPS/${chapter.file}`, chapter.xhtml);
  }
  for (const image of book.images) {
    zip.file(`OEBPS/${image.name}`, image.bytes);
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assertReadableEpub(bytes, book);

  fs.mkdirSync(path.dirname(book.outFile), { recursive: true });
  fs.writeFileSync(book.outFile, bytes);

  console.log(
    `Wrote ${path.relative(REPO_ROOT, book.outFile)} (${bytes.length} bytes, ${book.chapters.length} chapters)`,
  );
}

async function main(): Promise<void> {
  await buildBook(SAMPLE_A);
  await buildBook(SAMPLE_B);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
