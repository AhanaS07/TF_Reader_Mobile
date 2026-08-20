// Owner: Reader (Ahana).
//
// >>> TEMPORARY SCAFFOLDING — DELETE WITH devContentSeed.ts. <<<
//
// Generates real search indexes for the bundled sample books — ONE PER FORMAT — so in-book
// search has something to find while it is being developed. Nothing ships an index for a
// dev-seeded book yet (devContentSeed.ts stands in for Download's real pass and does not
// build one), so without this every search in the app correctly returns [] and the UI
// cannot be exercised on a device at all.
//
// THE PDF INDEX WAS THE MISSING HALF. Search's PDF extractor has existed and been proven by
// searchPdf.test.ts for some time, but no PDF book on the device carried an index, so a PDF
// search returned [] forever and looked like an unimplemented feature. It was not: it was a
// missing fixture. The EPUB index could not be reused because queryBookIndex throws outright
// on a bookId mismatch, so attaching the EPUB's index to a PDF book would have turned every
// search into an error rather than an empty list.
//
// SEVEN THINGS GO TOGETHER WHEN THE REAL DOWNLOAD PASS LANDS. Deleting only some of
// them leaves a dangling script, a stale asset, or a test that fails on a file that
// no longer exists:
//
//   1. this file
//   2. assets/reader/sample-search-index.json          (its EPUB output)
//   3. assets/reader/sample-pdf-search-index.json      (its PDF output)
//   4. the "reader:build-sample-index" script in package.json
//   5. the index attachments in devContentSeed.ts      (go with that whole file)
//   6. src/features/reader/devSearchIndex.test.ts      (guards 2 and 3 against 5)
//   7. the Temporary scaffolding entry in CLAUDE.md
//
// None of src/features/reader/SearchPanel.tsx, useBookSearch.ts or ReaderScreen.tsx
// is on that list. The search UI does not know these fixtures exist, and removing all
// of them must leave it compiling and green — on-device searches simply go back to
// returning [] until a real index ships. If deleting a fixture breaks the UI or a
// test, the boundary has leaked and THAT is the bug.
//
// NODE-ONLY, and this is why it is a script rather than app code: it imports Search's
// extractor, which pulls in fs, jszip, jsdom and epubjs. Importing any of that from
// the RN bundle would break Metro. Run it with `npm run reader:build-sample-index`.
//
// The CFIs are GENERATED, not hand-written, deliberately: they have to resolve
// against the live epub.js rendition, and a hand-written `epubcfi(...)` that merely
// looks plausible would fail silently at exactly the point the feature is being
// demonstrated. Search's extractor already generates them the way ingestion will.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createPrototypeBuildIndex } from '@/features/search/buildIndex';
import { epubSampleExtractor, pdfSampleExtractor } from '@/features/search/extractor';
import type { Extractor } from '@/features/search/extractor';

/**
 * Each fixture's bookId MUST match its `DEV_SAMPLE_*_BOOK_ID` in devContentSeed.ts.
 *
 * queryBookIndex throws outright when the index's bookId is not the one asked for — a guard against
 * handing over the wrong book's ciphertext — so a mismatch here turns every search in the app into an
 * error rather than an empty list. devSearchIndex.test.ts pins both against the real constants.
 */
const TARGETS: readonly { bookId: string; extractor: Extractor; output: string }[] = [
  {
    bookId: 'dev-sample-epub',
    extractor: epubSampleExtractor,
    output: path.join('assets', 'reader', 'sample-search-index.json'),
  },
  {
    bookId: 'dev-sample-pdf',
    extractor: pdfSampleExtractor,
    output: path.join('assets', 'reader', 'sample-pdf-search-index.json'),
  },
];

async function main(): Promise<void> {
  for (const { bookId, extractor, output } of TARGETS) {
    const buildIndex = createPrototypeBuildIndex(extractor);
    const index = await buildIndex(bookId);

    // Compact, not pretty-printed. These are bundled assets that get read, encrypted and shipped
    // inside the app — indentation doubles them for no reader's benefit, and nobody diffs them by eye
    // (they are regenerated, never edited).
    writeFileSync(output, `${JSON.stringify(index)}\n`);

    const words = Object.keys(index.index).length;
    const postings = Object.values(index.index).reduce((total, list) => total + list.length, 0);
    console.log(`Wrote ${output}: ${words} words, ${postings} postings, format ${index.format}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
