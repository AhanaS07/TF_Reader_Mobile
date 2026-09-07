// Owner: Reader (Ahana).
//
// Generates assets/reader/sample-plaintext.epub — the tiny PLAINTEXT fixture the
// reader baseline renders end-to-end.
//
// Run: npm run reader:build-sample
//
// WHY GENERATED RATHER THAN A CHECKED-IN BINARY FROM THE INTERNET:
//   • Provenance. Nothing here is copyrighted content; the prose is filler
//     written for this fixture. T4_Readme's rule is "never commit real content".
//   • Size. A hand-built 3-chapter EPUB is a few KB; the smallest real book is
//     hundreds.
//   • Reviewability. A generator diffs as text. A binary does not.
//   • It reuses jszip, which is ALREADY a devDependency because epub.js needs it
//     inlined into the WebView — no new dependency for this.
//
// PLAINTEXT ONLY. This is deliberately NOT encrypted and shares nothing with
// Abhinav's samples/sample-book.epub.enc. Encryption arrives later, behind
// ContentProvider.getBook(); see the handoff marker in readerAssets.ts.
//
// Node globals (fs/path/__dirname) are legitimate here for the same reason as in
// buildReaderHtml.ts and src/features/encryption/scripts/ — this runs under Node,
// never on device.

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUTPUT = path.join(REPO_ROOT, 'assets', 'reader', 'sample-plaintext.epub');

const BOOK_ID = 'urn:uuid:tf-reader-sample-plaintext-0001';
const TITLE = 'The Plaintext Baseline';

interface Chapter {
  id: string;
  file: string;
  title: string;
  paragraphs: string[];
}

// Enough prose per chapter that the chapter spills over several screens —
// otherwise "next" jumps straight to the next chapter and the pagination half of
// the done-test proves nothing.
function body(topic: string, lines: number): string[] {
  return Array.from(
    { length: lines },
    (_, i) =>
      `${topic} — paragraph ${i + 1}. This filler exists so the chapter is longer than one ` +
      `screen, which is what makes paginated flow observable: epub.js must break this text ` +
      `across several pages, and next/prev must step through them one at a time rather than ` +
      `jumping to the next chapter. The words themselves carry no meaning and no licence.`,
  );
}

const CHAPTERS: readonly Chapter[] = [
  {
    id: 'ch1',
    file: 'ch1.xhtml',
    title: 'Chapter One: Opening the Book',
    paragraphs: body('Opening the book', 12),
  },
  {
    id: 'ch2',
    file: 'ch2.xhtml',
    title: 'Chapter Two: Turning the Page',
    paragraphs: body('Turning the page', 12),
  },
  {
    id: 'ch3',
    file: 'ch3.xhtml',
    title: 'Chapter Three: Finding a Chapter',
    paragraphs: body('Finding a chapter', 12),
  },
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chapterXhtml(chapter: Chapter): string {
  const paragraphs = chapter.paragraphs.map((p) => `    <p>${escapeXml(p)}</p>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head>
    <title>${escapeXml(chapter.title)}</title>
  </head>
  <body>
    <h1>${escapeXml(chapter.title)}</h1>
${paragraphs}
  </body>
</html>
`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function contentOpf(): string {
  const manifest = CHAPTERS.map(
    (c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`,
  ).join('\n');
  const spine = CHAPTERS.map((c) => `    <itemref idref="${c.id}"/>`).join('\n');

  // Ships BOTH navigation forms on purpose: the EPUB3 nav document
  // (properties="nav") and the EPUB2 NCX referenced by spine@toc. epub.js will
  // read whichever it finds, and carrying both removes "which one does epub.js
  // actually use" as a possible cause if the TOC comes back empty on device.
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${BOOK_ID}</dc:identifier>
    <dc:title>${escapeXml(TITLE)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>TF Reader fixture generator</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;
}

function navXhtml(): string {
  const items = CHAPTERS.map(
    (c) => `        <li><a href="${c.file}">${escapeXml(c.title)}</a></li>`,
  ).join('\n');
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

function tocNcx(): string {
  const points = CHAPTERS.map(
    (c, i) => `    <navPoint id="np-${c.id}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${BOOK_ID}"/>
  </head>
  <docTitle><text>${escapeXml(TITLE)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

async function main(): Promise<void> {
  const zip = new JSZip();

  // ORDER AND COMPRESSION ARE PART OF THE SPEC, not stylistic:
  // OCF requires `mimetype` to be the FIRST entry and STORED (uncompressed), so
  // a reader can identify the format by byte offset without unzipping. JSZip
  // preserves insertion order, so adding it first here is what satisfies that.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml());
  zip.file('OEBPS/content.opf', contentOpf());
  zip.file('OEBPS/nav.xhtml', navXhtml());
  zip.file('OEBPS/toc.ncx', tocNcx());
  for (const chapter of CHAPTERS) {
    zip.file(`OEBPS/${chapter.file}`, chapterXhtml(chapter));
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  await assertReadableEpub(bytes);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, bytes);

  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUTPUT)} (${bytes.length} bytes, ${CHAPTERS.length} chapters)`,
  );
}

/**
 * Re-open what we just built and check it structurally, in the same
 * generator-is-its-own-test spirit as generateSampleBook.ts round-tripping its
 * ciphertext. A malformed EPUB would otherwise present on device as an
 * OPEN_FAILED with a message from deep inside epub.js.
 */
async function assertReadableEpub(bytes: Buffer): Promise<void> {
  if (bytes.subarray(0, 2).toString('binary') !== 'PK') {
    throw new Error('Output is not a zip archive.');
  }

  // "mimetype" must sit at byte 30 — immediately after the 30-byte local file
  // header of the first entry. This is the check that actually proves the STORED
  // + first-entry requirement above, rather than trusting JSZip's options.
  if (bytes.subarray(30, 38).toString('binary') !== 'mimetype') {
    throw new Error('`mimetype` is not the first archive entry — OCF violation.');
  }
  if (bytes.subarray(38, 58).toString('binary') !== 'application/epub+zip') {
    throw new Error('`mimetype` is not stored uncompressed — OCF violation.');
  }

  const reopened = await JSZip.loadAsync(bytes);
  const required = [
    'META-INF/container.xml',
    'OEBPS/content.opf',
    'OEBPS/nav.xhtml',
    'OEBPS/toc.ncx',
    ...CHAPTERS.map((c) => `OEBPS/${c.file}`),
  ];
  for (const entry of required) {
    if (!reopened.file(entry)) {
      throw new Error(`Missing required entry: ${entry}`);
    }
  }

  const opf = await reopened.file('OEBPS/content.opf')?.async('string');
  if (!opf?.includes('properties="nav"')) {
    throw new Error('OPF manifest is missing the EPUB3 nav document.');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
